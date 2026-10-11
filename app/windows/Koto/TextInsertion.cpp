#include "pch.h"
#include "TextInsertion.h"

#include <atomic>
#include <chrono>
#include <stdexcept>
#include <thread>
#include <vector>

namespace Koto {

namespace {
std::atomic<HWND> g_target{nullptr};

constexpr int kClipboardAttempts = 20;
constexpr auto kClipboardRetryDelay = std::chrono::milliseconds(25);
// Long enough for slow apps (Electron, remote desktops) to read the clipboard after Ctrl + V.
constexpr auto kRestoreDelay = std::chrono::milliseconds(600);
constexpr auto kModifierReleaseTimeout = std::chrono::milliseconds(1500);
constexpr size_t kMaximumSavedClipboardBytes = 64 * 1024 * 1024;

struct ClipboardEntry {
  UINT format;
  std::vector<BYTE> data;
};

// Another app may hold the clipboard briefly; retry rather than fail.
class ClipboardLock {
 public:
  ClipboardLock() {
    for (int attempt = 0; attempt < kClipboardAttempts; ++attempt) {
      if (OpenClipboard(nullptr)) {
        m_isOpen = true;
        return;
      }
      std::this_thread::sleep_for(kClipboardRetryDelay);
    }
  }
  ~ClipboardLock() {
    if (m_isOpen) {
      CloseClipboard();
    }
  }
  bool IsOpen() const noexcept { return m_isOpen; }

 private:
  bool m_isOpen{false};
};

// Formats backed by GDI handles rather than global memory. Windows synthesises them from CF_DIB and others.
bool IsHandleFormat(UINT format) noexcept {
  switch (format) {
    case CF_BITMAP:
    case CF_DSPBITMAP:
    case CF_ENHMETAFILE:
    case CF_DSPENHMETAFILE:
    case CF_METAFILEPICT:
    case CF_DSPMETAFILEPICT:
    case CF_PALETTE:
    case CF_OWNERDISPLAY:
      return true;
    default:
      return false;
  }
}

// Snapshot of every format on the clipboard (text, rich text, images, files), so pasting does not destroy it.
std::vector<ClipboardEntry> SaveClipboard(bool &isComplete) {
  std::vector<ClipboardEntry> entries;
  isComplete = true;
  size_t total = 0;
  for (UINT format = EnumClipboardFormats(0); format != 0; format = EnumClipboardFormats(format)) {
    if (IsHandleFormat(format)) {
      continue;
    }
    HANDLE handle = GetClipboardData(format);
    if (!handle) {
      continue;
    }
    SIZE_T const size = GlobalSize(handle);
    void const *source = GlobalLock(handle);
    if (!source) {
      continue;
    }
    if (total + size > kMaximumSavedClipboardBytes) {
      isComplete = false;
      GlobalUnlock(handle);
      break;
    }
    ClipboardEntry entry{format, std::vector<BYTE>(size)};
    memcpy(entry.data.data(), source, size);
    GlobalUnlock(handle);
    total += size;
    entries.push_back(std::move(entry));
  }
  return entries;
}

void RestoreClipboard(std::vector<ClipboardEntry> const &entries) {
  EmptyClipboard();
  // Keeps the restored copy out of Win + V history, which already holds the original.
  static UINT const excludeFromHistory = RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing");
  for (auto const &entry : entries) {
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, entry.data.size());
    if (!memory) {
      continue;
    }
    memcpy(GlobalLock(memory), entry.data.data(), entry.data.size());
    GlobalUnlock(memory);
    if (!SetClipboardData(entry.format, memory)) {
      GlobalFree(memory);
    }
  }
  if (HGLOBAL marker = GlobalAlloc(GMEM_MOVEABLE, sizeof(DWORD))) {
    *static_cast<DWORD *>(GlobalLock(marker)) = 0;
    GlobalUnlock(marker);
    if (!SetClipboardData(excludeFromHistory, marker)) {
      GlobalFree(marker);
    }
  }
}

// Win32 edit controls (Notepad, many dialogs) only break lines on CRLF.
std::wstring WithWindowsLineEndings(std::wstring const &text) {
  std::wstring result;
  result.reserve(text.size() + text.size() / 16);
  for (size_t index = 0; index < text.size(); ++index) {
    if (text[index] == L'\n' && (index == 0 || text[index - 1] != L'\r')) {
      result.push_back(L'\r');
    }
    result.push_back(text[index]);
  }
  return result;
}

void PutText(std::wstring const &rawText) {
  std::wstring const text = WithWindowsLineEndings(rawText);
  size_t const bytes = (text.size() + 1) * sizeof(wchar_t);
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
  if (!memory) {
    throw std::runtime_error("Out of memory.");
  }
  memcpy(GlobalLock(memory), text.c_str(), bytes);
  GlobalUnlock(memory);
  EmptyClipboard();
  if (!SetClipboardData(CF_UNICODETEXT, memory)) {
    GlobalFree(memory);
    throw std::runtime_error("The clipboard rejected the text.");
  }
}

bool IsProcessElevated(HANDLE process) noexcept {
  HANDLE token = nullptr;
  if (!OpenProcessToken(process, TOKEN_QUERY, &token)) {
    return false;
  }
  TOKEN_ELEVATION elevation{};
  DWORD size = 0;
  bool const isElevated = GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size) && elevation.TokenIsElevated;
  CloseHandle(token);
  return isElevated;
}

// Windows ignores simulated input sent from a normal app to an elevated one.
bool IsBlockedByElevation(HWND window) noexcept {
  if (IsProcessElevated(GetCurrentProcess())) {
    return false;
  }
  DWORD processId = 0;
  GetWindowThreadProcessId(window, &processId);
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (!process) {
    return true;
  }
  bool const isElevated = IsProcessElevated(process);
  CloseHandle(process);
  return isElevated;
}

bool IsKeyHeld(int vk) noexcept {
  return (GetAsyncKeyState(vk) & 0x8000) != 0;
}

// Ctrl + V while Win, Alt or Shift is still held would become a different shortcut (Win + V opens clipboard history).
void WaitForModifiersReleased() noexcept {
  auto const deadline = std::chrono::steady_clock::now() + kModifierReleaseTimeout;
  int const modifiers[] = {VK_LWIN, VK_RWIN, VK_MENU, VK_SHIFT, VK_CONTROL};
  auto anyHeld = [&] {
    for (int vk : modifiers) {
      if (IsKeyHeld(vk)) {
        return true;
      }
    }
    return false;
  };
  while (anyHeld() && std::chrono::steady_clock::now() < deadline) {
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
  // Still held after the timeout: release them for the target app.
  std::vector<INPUT> releases;
  for (int vk : modifiers) {
    if (IsKeyHeld(vk)) {
      INPUT input{};
      input.type = INPUT_KEYBOARD;
      input.ki.wVk = static_cast<WORD>(vk);
      input.ki.dwFlags = KEYEVENTF_KEYUP;
      releases.push_back(input);
    }
  }
  if (!releases.empty()) {
    SendInput(static_cast<UINT>(releases.size()), releases.data(), sizeof(INPUT));
  }
}

bool SendPasteShortcut() noexcept {
  INPUT inputs[4]{};
  inputs[0].type = INPUT_KEYBOARD;
  inputs[0].ki.wVk = VK_CONTROL;
  inputs[1].type = INPUT_KEYBOARD;
  inputs[1].ki.wVk = 'V';
  inputs[2].type = INPUT_KEYBOARD;
  inputs[2].ki.wVk = 'V';
  inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
  inputs[3].type = INPUT_KEYBOARD;
  inputs[3].ki.wVk = VK_CONTROL;
  inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;
  return SendInput(4, inputs, sizeof(INPUT)) == 4;
}

HWND TopLevel(HWND window) noexcept {
  return window ? GetAncestor(window, GA_ROOT) : nullptr;
}
} // namespace

void TextInsertion::RememberTarget() noexcept {
  g_target = TopLevel(GetForegroundWindow());
}

void TextInsertion::RestoreFocusToTarget() noexcept {
  HWND const target = g_target.load();
  if (target && IsWindow(target)) {
    SetForegroundWindow(target);
  }
}

void TextInsertion::Copy(std::wstring const &text) {
  ClipboardLock lock;
  if (!lock.IsOpen()) {
    throw std::runtime_error("The clipboard is in use by another app.");
  }
  PutText(text);
}

InsertionOutcome TextInsertion::Insert(std::wstring const &text) {
  HWND const target = g_target.load();
  HWND const current = TopLevel(GetForegroundWindow());
  bool const isSafeToPaste = current && current == target && IsWindow(current) && !IsBlockedByElevation(current);

  std::vector<ClipboardEntry> saved;
  bool isSnapshotComplete = false;
  DWORD sequenceAfterSet = 0;
  {
    ClipboardLock lock;
    if (!lock.IsOpen()) {
      throw std::runtime_error("The clipboard is in use by another app.");
    }
    if (isSafeToPaste) {
      saved = SaveClipboard(isSnapshotComplete);
    }
    PutText(text);
  }
  sequenceAfterSet = GetClipboardSequenceNumber();

  if (!isSafeToPaste) {
    return InsertionOutcome::Copied;
  }

  WaitForModifiersReleased();
  if (!SendPasteShortcut()) {
    return InsertionOutcome::Copied;
  }

  std::this_thread::sleep_for(kRestoreDelay);
  // Restore only if nothing else changed the clipboard meanwhile, and only when the
  // snapshot was complete. If there was nothing to restore, the text stays as a backup.
  if (isSnapshotComplete && !saved.empty() && GetClipboardSequenceNumber() == sequenceAfterSet) {
    ClipboardLock lock;
    if (lock.IsOpen()) {
      RestoreClipboard(saved);
    }
  }
  return InsertionOutcome::Pasted;
}

} // namespace Koto

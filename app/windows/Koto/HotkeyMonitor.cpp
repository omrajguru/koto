#include "pch.h"
#include "HotkeyMonitor.h"

namespace Koto {

namespace {
// Unassigned virtual key. Injecting it between Win down and Win up stops the Start menu opening.
constexpr WORD kMaskKey = 0xE8;

bool IsControlKey(DWORD vk) noexcept {
  return vk == VK_LCONTROL || vk == VK_RCONTROL || vk == VK_CONTROL;
}

bool IsWindowsKey(DWORD vk) noexcept {
  return vk == VK_LWIN || vk == VK_RWIN;
}

bool IsOtherModifier(DWORD vk) noexcept {
  return vk == VK_LSHIFT || vk == VK_RSHIFT || vk == VK_SHIFT || vk == VK_LMENU || vk == VK_RMENU || vk == VK_MENU;
}

void SendMaskKey() noexcept {
  INPUT inputs[2]{};
  inputs[0].type = INPUT_KEYBOARD;
  inputs[0].ki.wVk = kMaskKey;
  inputs[1].type = INPUT_KEYBOARD;
  inputs[1].ki.wVk = kMaskKey;
  inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
  SendInput(2, inputs, sizeof(INPUT));
}
} // namespace

HotkeyMonitor &HotkeyMonitor::Instance() noexcept {
  static HotkeyMonitor instance;
  return instance;
}

void HotkeyMonitor::Start(Listener listener) noexcept {
  if (m_thread.joinable()) {
    return;
  }
  m_listener = std::move(listener);
  m_thread = std::thread([this] { Run(); });
}

void HotkeyMonitor::Stop() noexcept {
  if (!m_thread.joinable()) {
    return;
  }
  PostThreadMessageW(m_threadId.load(), WM_QUIT, 0, 0);
  m_thread.join();
}

void HotkeyMonitor::Run() noexcept {
  m_threadId = GetCurrentThreadId();
  // Low-level hooks are called on the installing thread, which must pump messages.
  m_hook = SetWindowsHookExW(WH_KEYBOARD_LL, KeyboardProc, GetModuleHandleW(nullptr), 0);
  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  if (m_hook) {
    UnhookWindowsHookEx(m_hook);
    m_hook = nullptr;
  }
}

LRESULT CALLBACK HotkeyMonitor::KeyboardProc(int code, WPARAM wParam, LPARAM lParam) noexcept {
  if (code == HC_ACTION) {
    auto const &key = *reinterpret_cast<KBDLLHOOKSTRUCT *>(lParam);
    // Ignore our own injected keys (the mask key and pasted shortcuts).
    if (!(key.flags & LLKHF_INJECTED)) {
      bool const isDown = wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN;
      Instance().HandleKey(key, isDown);
    }
  }
  return CallNextHookEx(nullptr, code, wParam, lParam);
}

void HotkeyMonitor::HandleKey(KBDLLHOOKSTRUCT const &key, bool isDown) noexcept {
  DWORD const vk = key.vkCode;

  if (IsControlKey(vk)) {
    m_isControlDown = isDown;
  } else if (IsWindowsKey(vk)) {
    m_isWindowsDown = isDown;
  } else if (isDown) {
    if (vk == VK_ESCAPE) {
      m_isSuppressedUntilRelease = m_isComboActive;
      m_isComboActive = false;
      Emit("cancelled");
    } else if (m_isComboActive && !IsOtherModifier(vk)) {
      // Another shortcut such as Ctrl + Win + D. Let it through and abandon dictation.
      m_isComboActive = false;
      m_isSuppressedUntilRelease = true;
      Emit("cancelled");
    }
    return;
  } else {
    return;
  }

  bool const isComboHeld = m_isControlDown && m_isWindowsDown;
  if (!isComboHeld) {
    m_isSuppressedUntilRelease = false;
  }
  // Ctrl auto-repeats while held, so without this a cancelled combo would start again.
  if (isComboHeld && !m_isComboActive && isDown && !m_isSuppressedUntilRelease) {
    m_isComboActive = true;
    // Win opens Start when released with no key in between. The injected key
    // lands after this Win/Ctrl event and before the eventual Win release.
    SendMaskKey();
    Emit("pressed");
  } else if (!isComboHeld && m_isComboActive) {
    m_isComboActive = false;
    Emit("released");
  }
}

void HotkeyMonitor::Emit(char const *event) noexcept {
  if (m_listener) {
    m_listener(event);
  }
}

} // namespace Koto

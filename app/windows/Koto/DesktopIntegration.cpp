#include "pch.h"
#include "DesktopIntegration.h"

#include "AppUpdater.h"
#include "AudioRecorder.h"
#include "BundleManager.h"
#include "HotkeyMonitor.h"
#include "LocalStorage.h"
#include "Microphones.h"
#include "OrbOverlay.h"
#include "TextInsertion.h"
#include "WritingStyleMenu.h"

#include <shellapi.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <exception>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace Koto {

namespace {
using winrt::Microsoft::ReactNative::ReactPromise;

constexpr char kBase64Alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::wstring Widen(std::string const &value) {
  if (value.empty()) {
    return {};
  }
  int const length = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
  std::wstring result(length, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length);
  return result;
}

std::string Narrow(std::wstring const &value) {
  if (value.empty()) {
    return {};
  }
  int const length =
      WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(length, '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length, nullptr, nullptr);
  return result;
}

std::string EncodeSamples(std::vector<int16_t> const &samples) {
  auto const *bytes = reinterpret_cast<unsigned char const *>(samples.data());
  size_t const size = samples.size() * sizeof(int16_t);
  std::string encoded;
  encoded.reserve(((size + 2) / 3) * 4);
  for (size_t index = 0; index < size; index += 3) {
    uint32_t triple = bytes[index] << 16;
    if (index + 1 < size) triple |= bytes[index + 1] << 8;
    if (index + 2 < size) triple |= bytes[index + 2];
    encoded.push_back(kBase64Alphabet[(triple >> 18) & 63]);
    encoded.push_back(kBase64Alphabet[(triple >> 12) & 63]);
    encoded.push_back(index + 1 < size ? kBase64Alphabet[(triple >> 6) & 63] : '=');
    encoded.push_back(index + 2 < size ? kBase64Alphabet[triple & 63] : '=');
  }
  return encoded;
}

std::string MessageOf(std::exception_ptr error) {
  try {
    std::rethrow_exception(error);
  } catch (winrt::hresult_error const &failure) {
    return Narrow(std::wstring(failure.message()));
  } catch (std::exception const &failure) {
    return failure.what();
  } catch (...) {
    return "Unexpected error.";
  }
}

// Runs blocking work (file I/O, clipboard waits, WinRT .get()) off the JavaScript thread.
template <typename T, typename Work>
void Resolve(ReactPromise<T> &&promise, Work &&work) {
  std::thread([promise = std::move(promise), work = std::forward<Work>(work)]() mutable {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    try {
      if constexpr (std::is_void_v<T>) {
        work();
        promise.Resolve();
      } else {
        promise.Resolve(work());
      }
    } catch (...) {
      promise.Reject(MessageOf(std::current_exception()).c_str());
    }
    winrt::uninit_apartment();
  }).detach();
}

// The native threads outlive a JavaScript reload, which creates a new module
// instance. Callbacks go through this pointer so they always reach the live one.
std::atomic<DesktopIntegration *> g_current{nullptr};

void EmitHotkey(std::string const &event) {
  if (auto *module = g_current.load(); module && module->onHotkey) {
    module->onHotkey(event);
  }
}

void EmitFrame(std::vector<int16_t> const &frame) {
  if (auto *module = g_current.load(); module && module->onAudioFrame) {
    module->onAudioFrame(EncodeSamples(frame));
  }
}

// Early capture. The microphone starts the moment the hotkey goes down, here in native
// code, instead of after the press has travelled to JavaScript and back: that round trip
// cut off the first word. Frames are held until JavaScript claims the recording with
// startRecording, then delivered in order. A recording nobody claims is stopped and deleted.
constexpr size_t kMaximumHeldFrames = 100; // About 10 s of audio.
constexpr auto kClaimWait = std::chrono::seconds(3);
constexpr auto kAbandonAfter = std::chrono::seconds(6);

std::mutex g_earlyMutex;
std::condition_variable g_earlyStarted;
bool g_isEarlyUnclaimed = false;
bool g_hasEarlyStartResult = false;
std::wstring g_earlyPath;
std::vector<std::vector<int16_t>> g_heldFrames;
uint64_t g_earlyGeneration = 0;
// The early recording JavaScript took over; 0 when none.
uint64_t g_claimedGeneration = 0;
// Lets the recorder that replaces a timed-out early start close its file before it is deleted.
constexpr auto kReplacedFileGrace = std::chrono::seconds(3);

// `earlyGeneration` is 0 for a recording JavaScript started itself.
AudioRecorder::Callbacks MakeRecordingCallbacks(uint64_t earlyGeneration = 0) {
  AudioRecorder::Callbacks callbacks;
  callbacks.onFrame = [earlyGeneration](std::vector<int16_t> const &frame) {
    // Emitting under the lock keeps live frames behind the held ones being delivered.
    std::lock_guard lock(g_earlyMutex);
    if (earlyGeneration != 0 && earlyGeneration != g_claimedGeneration) {
      // Not claimed yet: hold. Given up on (claiming timed out): drop, so its audio never
      // mixes with the recording that replaced it.
      if (earlyGeneration == g_earlyGeneration && g_isEarlyUnclaimed && g_heldFrames.size() < kMaximumHeldFrames) {
        g_heldFrames.push_back(frame);
      }
      return;
    }
    EmitFrame(frame);
  };
  callbacks.onError = [](std::string const &message) {
    if (auto *module = g_current.load(); module && module->onRecordingError) {
      module->onRecordingError(message);
    }
  };
  return callbacks;
}

// Called on the keyboard hook's thread, which must never wait: the work happens elsewhere.
void StartEarlyCapture() {
  uint64_t generation = 0;
  {
    std::lock_guard lock(g_earlyMutex);
    // A recording already running (hands-free, or a tap waiting for its second press) is
    // ended by this press in JavaScript, not replaced.
    if (g_isEarlyUnclaimed || AudioRecorder::Instance().IsRecording()) {
      return;
    }
    g_isEarlyUnclaimed = true;
    g_hasEarlyStartResult = false;
    g_earlyPath.clear();
    g_heldFrames.clear();
    generation = ++g_earlyGeneration;
  }
  std::thread([generation] {
    std::wstring path;
    try {
      path = AudioRecorder::Instance().Start(LocalStorage::RecordingsDirectory(), MakeRecordingCallbacks(generation));
    } catch (...) {
      // JavaScript starts the microphone itself and reports the error.
    }
    bool isGivenUp = false;
    {
      std::lock_guard lock(g_earlyMutex);
      isGivenUp = generation != g_earlyGeneration;
      if (!isGivenUp) {
        g_hasEarlyStartResult = true;
        g_earlyPath = path;
        if (path.empty()) {
          g_isEarlyUnclaimed = false;
        }
      }
    }
    g_earlyStarted.notify_all();
    if (path.empty()) {
      return;
    }
    if (isGivenUp) {
      // Claiming timed out while the microphone was starting, and JavaScript started its own
      // recording, which stops this one. Only this recording's file is removed.
      std::this_thread::sleep_for(kReplacedFileGrace);
      // Normally already stopped by the replacement; if not, it must not keep the microphone on.
      AudioRecorder::Instance().StopIfRecording(path);
      DeleteFileW(path.c_str());
      return;
    }
    std::this_thread::sleep_for(kAbandonAfter);
    bool isAbandoned = false;
    {
      std::lock_guard lock(g_earlyMutex);
      isAbandoned = generation == g_earlyGeneration && g_isEarlyUnclaimed;
      if (isAbandoned) {
        g_isEarlyUnclaimed = false;
        ++g_earlyGeneration;
        g_heldFrames.clear();
      }
    }
    if (isAbandoned) {
      // Stop only if the recorder is still on this recording, never on one that replaced it.
      // The file goes either way: it may already have stopped on its own (microphone
      // unplugged) or been stopped by a newer recording. An open file simply is not deleted.
      AudioRecorder::Instance().StopIfRecording(path);
      DeleteFileW(path.c_str());
    }
  }).detach();
}

// The early recording's path, after delivering its held frames, or empty when there is none.
std::wstring ClaimEarlyCapture() {
  std::unique_lock lock(g_earlyMutex);
  if (!g_isEarlyUnclaimed) {
    return {};
  }
  g_earlyStarted.wait_for(lock, kClaimWait, [] { return g_hasEarlyStartResult || !g_isEarlyUnclaimed; });
  if (!g_isEarlyUnclaimed || g_earlyPath.empty()) {
    if (g_isEarlyUnclaimed) {
      // Still starting after the wait: give it up, so its timer and frames leave alone the
      // recording JavaScript is about to start instead.
      g_isEarlyUnclaimed = false;
      ++g_earlyGeneration;
      g_heldFrames.clear();
    }
    return {};
  }
  g_isEarlyUnclaimed = false;
  g_claimedGeneration = g_earlyGeneration;
  for (auto const &frame : g_heldFrames) {
    EmitFrame(frame);
  }
  g_heldFrames.clear();
  return g_earlyPath;
}

OrbOverlay::State ParseOverlayState(std::string const &state) {
  if (state == "listening") return OrbOverlay::State::Listening;
  if (state == "handsFree") return OrbOverlay::State::HandsFree;
  if (state == "processing") return OrbOverlay::State::Processing;
  if (state == "notice") return OrbOverlay::State::Notice;
  if (state == "error") return OrbOverlay::State::Error;
  return OrbOverlay::State::Hidden;
}
} // namespace

void DesktopIntegration::Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
  m_context = context;
  g_current = this;
  OrbOverlay::Instance().Start([] { return AudioRecorder::Instance().Level(); }, [] { EmitHotkey("toggle"); });
  WritingStyleMenu::SetListener([](std::string const &style) {
    if (auto *module = g_current.load(); module && module->onWritingStyleChange) {
      module->onWritingStyleChange(style);
    }
  });
  Microphones::SetListener([](std::wstring const &id) {
    if (auto *module = g_current.load(); module && module->onMicrophoneChange) {
      module->onMicrophoneChange(Narrow(id));
    }
  });
  // Registered once per process; JavaScript reloads reach the new module through g_current.
  static std::once_flag watching;
  std::call_once(watching, [] {
    Microphones::WatchForChanges([] {
      if (auto *module = g_current.load(); module && module->onMicrophonesChanged) {
        module->onMicrophonesChanged("");
      }
    });
  });
}

void DesktopIntegration::startHotkeyListener() noexcept {
  HotkeyMonitor::Instance().Start([](std::string const &event) {
    if (event == "pressed") {
      TextInsertion::RememberTarget();
      StartEarlyCapture();
    }
    EmitHotkey(event);
  });
}

void DesktopIntegration::stopHotkeyListener() noexcept {
  HotkeyMonitor::Instance().Stop();
}

void DesktopIntegration::startRecording(ReactPromise<std::string> &&result) noexcept {
  // Covers the orb click and the case where focus changed before the hotkey event arrived.
  if (!AudioRecorder::Instance().IsRecording()) {
    TextInsertion::RememberTarget();
  }
  Resolve(std::move(result), [] {
    // Usually the hotkey already started the microphone; take over that recording.
    if (std::wstring const early = ClaimEarlyCapture(); !early.empty()) {
      return Narrow(early);
    }
    return Narrow(AudioRecorder::Instance().Start(LocalStorage::RecordingsDirectory(), MakeRecordingCallbacks()));
  });
}

void DesktopIntegration::stopRecording(ReactPromise<std::string> &&result) noexcept {
  Resolve(std::move(result), [] { return Narrow(AudioRecorder::Instance().Stop()); });
}

void DesktopIntegration::readAudioFile(std::string path, ReactPromise<std::string> &&result) noexcept {
  // Recordings from before voice notes moved to Documents are found by name in the new folder.
  Resolve(std::move(result), [path] { return LocalStorage::ReadBinaryBase64(LocalStorage::ResolveRecordingPath(Widen(path))); });
}

void DesktopIntegration::deleteAudioFile(std::string path, ReactPromise<void> &&result) noexcept {
  Resolve(std::move(result), [path] { LocalStorage::DeleteRecording(Widen(path)); });
}

void DesktopIntegration::getVoiceNotesFolder(ReactPromise<std::string> &&result) noexcept {
  Resolve(std::move(result), [] { return Narrow(LocalStorage::RecordingsDirectory()); });
}

void DesktopIntegration::openVoiceNotesFolder() noexcept {
  std::wstring const folder = LocalStorage::RecordingsDirectory();
  ShellExecuteW(nullptr, L"open", folder.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

void DesktopIntegration::setOverlayState(std::string state, std::string message) noexcept {
  OrbOverlay::Instance().SetState(ParseOverlayState(state), Widen(message));
}

void DesktopIntegration::insertText(std::string text, ReactPromise<std::string> &&result) noexcept {
  Resolve(std::move(result), [text] {
    return std::string(TextInsertion::Insert(Widen(text)) == InsertionOutcome::Pasted ? "pasted" : "copied");
  });
}

void DesktopIntegration::copyText(std::string text, ReactPromise<void> &&result) noexcept {
  Resolve(std::move(result), [text] { TextInsertion::Copy(Widen(text)); });
}

void DesktopIntegration::readSecret(std::string key, ReactPromise<std::string> &&result) noexcept {
  Resolve(std::move(result), [key] { return LocalStorage::ReadSecret(key); });
}

void DesktopIntegration::writeSecret(std::string key, std::string value, ReactPromise<void> &&result) noexcept {
  Resolve(std::move(result), [key, value] { LocalStorage::WriteSecret(key, value); });
}

void DesktopIntegration::deleteSecret(std::string key, ReactPromise<void> &&result) noexcept {
  Resolve(std::move(result), [key] { LocalStorage::DeleteSecret(key); });
}

void DesktopIntegration::readDocument(std::string name, ReactPromise<std::string> &&result) noexcept {
  Resolve(std::move(result), [name] { return LocalStorage::ReadDocument(name); });
}

void DesktopIntegration::writeDocument(std::string name, std::string contents, ReactPromise<void> &&result) noexcept {
  Resolve(std::move(result), [name, contents] { LocalStorage::WriteDocument(name, contents); });
}

void DesktopIntegration::setLaunchAtLogin(bool isEnabled, ReactPromise<void> &&result) noexcept {
  Resolve(std::move(result), [isEnabled] { LocalStorage::SetLaunchAtLogin(isEnabled); });
}

void DesktopIntegration::getLaunchAtLogin(ReactPromise<bool> &&result) noexcept {
  Resolve(std::move(result), [] { return LocalStorage::GetLaunchAtLogin(); });
}

void DesktopIntegration::setWritingStyle(std::string style) noexcept {
  WritingStyleMenu::SetCurrent(style);
}

void DesktopIntegration::listMicrophones(ReactPromise<std::string> &&result) noexcept {
  Resolve(std::move(result), [] {
    // JSON by hand: ids and names are escaped for quotes, backslashes and control characters.
    auto escape = [](std::string const &value) {
      std::string escaped;
      for (char character : value) {
        if (character == '"' || character == '\\') {
          escaped += '\\';
          escaped += character;
        } else if (static_cast<unsigned char>(character) < 0x20) {
          char code[8];
          sprintf_s(code, "\\u%04x", static_cast<unsigned int>(static_cast<unsigned char>(character)));
          escaped += code;
        } else {
          escaped += character;
        }
      }
      return escaped;
    };
    std::string json = "[";
    for (auto const &microphone : Microphones::List()) {
      if (json.size() > 1) {
        json += ",";
      }
      json += "{\"id\":\"" + escape(Narrow(microphone.id)) + "\",\"name\":\"" + escape(Narrow(microphone.name)) +
          "\",\"isDefault\":" + (microphone.isDefault ? "true" : "false") + "}";
    }
    return json + "]";
  });
}

void DesktopIntegration::setMicrophone(std::string id) noexcept {
  Microphones::SetPreferred(Widen(id));
}

void DesktopIntegration::installBundle(
    std::string downloadUrl,
    std::string sha256,
    std::string version,
    ReactPromise<void> &&result) noexcept {
  Resolve(std::move(result), [downloadUrl, sha256, version] {
    std::string const nativeVersion = AppUpdater::PackageVersion();
    if (nativeVersion.empty()) {
      throw std::runtime_error("This development build does not take instant updates.");
    }
    BundleManager::Install(Widen(downloadUrl), sha256, version, nativeVersion);
  });
}

void DesktopIntegration::reloadWithInstalledBundle() noexcept {
  if (auto &reload = WindowHost::ReloadWithInstalledBundle()) {
    reload();
  }
}

void DesktopIntegration::confirmBundleHealthy() noexcept {
  BundleManager::ConfirmHealthy();
}

void DesktopIntegration::getAppInfo(ReactPromise<std::string> &&result) noexcept {
  Resolve(std::move(result), [] { return AppUpdater::AppInfoJson(); });
}

void DesktopIntegration::installUpdate(std::string downloadUrl, ReactPromise<void> &&result) noexcept {
  Resolve(std::move(result), [downloadUrl] { AppUpdater::InstallUpdate(Widen(downloadUrl)); });
}

void DesktopIntegration::showMainWindow() noexcept {
  if (auto &show = WindowHost::ShowMainWindow()) {
    show();
  }
}

} // namespace Koto

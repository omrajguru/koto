#pragma once

#include <atomic>
#include <functional>
#include <string>
#include <thread>

namespace Koto {

// Watches for Ctrl + Win system-wide using a low-level keyboard hook.
//
// Emits:
// - "pressed" when Ctrl and Win are both held with no other key.
// - "released" when either is let go.
// - "cancelled" when Esc is pressed, or another key joins the combination
//   (Ctrl + Win + D, Ctrl + Win + Left and so on keep working as usual).
//
// Keys are never swallowed. When the combination starts, a harmless key is
// injected so releasing Win afterwards does not open the Start menu.
class HotkeyMonitor {
 public:
  using Listener = std::function<void(std::string const &)>;

  static HotkeyMonitor &Instance() noexcept;

  void Start(Listener listener) noexcept;
  void Stop() noexcept;

 private:
  HotkeyMonitor() = default;
  static LRESULT CALLBACK KeyboardProc(int code, WPARAM wParam, LPARAM lParam) noexcept;
  void Run() noexcept;
  void HandleKey(KBDLLHOOKSTRUCT const &key, bool isDown) noexcept;
  void Emit(char const *event) noexcept;

  Listener m_listener;
  std::thread m_thread;
  std::atomic<DWORD> m_threadId{0};
  HHOOK m_hook{nullptr};

  bool m_isControlDown{false};
  bool m_isWindowsDown{false};
  bool m_isComboActive{false};
  bool m_isSuppressedUntilRelease{false};
};

} // namespace Koto

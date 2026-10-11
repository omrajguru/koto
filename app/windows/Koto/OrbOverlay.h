#pragma once

#include <atomic>
#include <functional>
#include <mutex>
#include <string>
#include <thread>

namespace Koto {

// The floating orb shown near the bottom of the screen while dictating.
//
// It never takes focus (so typing and pasting still go to the app being
// dictated into) and transparent pixels pass clicks through. Clicking the orb
// itself calls the toggle handler, which finishes hands-free dictation.
class OrbOverlay {
 public:
  enum class State { Hidden, Listening, HandsFree, Processing, Notice, Error };

  static OrbOverlay &Instance() noexcept;

  void Start(std::function<float()> levelSource, std::function<void()> onToggle) noexcept;
  void SetState(State state, std::wstring message) noexcept;

 private:
  OrbOverlay() = default;
  void Run() noexcept;
  static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) noexcept;
  void ApplyPendingState() noexcept;
  void Render() noexcept;
  void Position() noexcept;

  std::thread m_thread;
  std::atomic<HWND> m_window{nullptr};
  std::function<float()> m_levelSource;
  std::function<void()> m_onToggle;

  std::mutex m_pendingMutex;
  State m_pendingState{State::Hidden};
  std::wstring m_pendingMessage;

  State m_state{State::Hidden};
  State m_drawnState{State::Hidden};
  std::wstring m_message;
  float m_opacity{0.0f};
  float m_level{0.0f};
  double m_phase{0.0};
  UINT m_dpi{96};
  RECT m_orbBounds{};
};

} // namespace Koto

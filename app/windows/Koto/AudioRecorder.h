#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace Koto {

// Captures the microphone chosen in Koto (Microphones::Preferred), or the Windows default
// when none is chosen or it is not connected, through WASAPI as 16 kHz mono PCM16.
//
// Audio is appended to a WAV file as it arrives and the header is rewritten
// every few seconds, so a recording survives the app quitting mid-way.
// Every ~100 ms of audio is also handed to the frame listener.
class AudioRecorder {
 public:
  struct Callbacks {
    std::function<void(std::vector<int16_t> const &)> onFrame;
    // Capture stopped on its own (device removed, access revoked).
    std::function<void(std::string const &)> onError;
  };

  static AudioRecorder &Instance() noexcept;

  // Returns the file path, or throws std::runtime_error with a user-facing message.
  std::wstring Start(std::wstring const &directory, Callbacks callbacks);
  // Blocks until the final frame has been delivered and the file is closed. Returns the file path.
  std::wstring Stop() noexcept;
  bool IsRecording() const noexcept { return m_isRecording.load(); }
  // Stops the recording only if it is still the one writing `path`, checked and stopped
  // under one lock so a recording started meanwhile is never stopped. True if it stopped.
  bool StopIfRecording(std::wstring const &path) noexcept;
  // Smoothed input level, 0 to 1, for the overlay.
  float Level() const noexcept { return m_level.load(); }

 private:
  AudioRecorder() = default;
  void Run(std::wstring path, Callbacks callbacks) noexcept;

  std::thread m_thread;
  std::atomic<bool> m_isRecording{false};
  std::atomic<bool> m_shouldStop{false};
  std::atomic<float> m_level{0.0f};
  std::wstring m_path;
  std::mutex m_lifecycleMutex;
  std::mutex m_startMutex;
  std::condition_variable m_started;
  bool m_hasStartResult{false};
  std::string m_startError;
};

} // namespace Koto

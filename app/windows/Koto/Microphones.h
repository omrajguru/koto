#pragma once

#include <functional>
#include <string>
#include <vector>

namespace Koto::Microphones {

// The microphones Koto can record from, and which one it uses.
//
// The chosen microphone is stored by JavaScript (preferences) and set here at startup. An
// empty id means "follow the Windows default". When the chosen microphone is not connected,
// AudioRecorder falls back to the Windows default for that recording.

struct Microphone {
  std::wstring id; // IMMDevice id, stable across restarts and reconnections.
  std::wstring name; // Friendly name shown in Windows sound settings.
  bool isDefault{false}; // The Windows default recording device right now.
};

// Active (connected and enabled) recording devices. Works on any thread.
std::vector<Microphone> List() noexcept;

// "" = Windows default.
void SetPreferred(std::wstring const &id) noexcept;
std::wstring Preferred() noexcept;

// Menu command ids, after WritingStyleMenu's (0x7000) and before 0x7200.
constexpr unsigned int kFirstCommand = 0x7100;
constexpr unsigned int kMaximumItems = 0x80;

// Called when a microphone is picked from the tray or orb menu, with its id ("" = default).
void SetListener(std::function<void(std::wstring const &)> listener) noexcept;

// Starts listening for microphones being connected, disconnected, enabled, disabled, or
// the Windows default changing, and calls `onChange` (on a system thread) each time.
// Several calls can arrive for one change; listeners should coalesce them. Call once.
void WatchForChanges(std::function<void()> onChange) noexcept;

// "Windows default", then every active microphone, with the preferred one checked. The
// caller destroys it (a parent menu destroys it when it is appended as a submenu).
HMENU CreateMenu() noexcept;

// Returns true and notifies the listener if `command` is one of this menu's items.
bool HandleCommand(unsigned int command) noexcept;

} // namespace Koto::Microphones

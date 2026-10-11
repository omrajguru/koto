#pragma once

#include <string>

namespace Koto {

enum class InsertionOutcome { Pasted, Copied };

// Inserts text into other apps by pasting, which works with any text field
// that accepts Ctrl + V.
class TextInsertion {
 public:
  // Remembers the focused window so the paste can be checked against it later.
  static void RememberTarget() noexcept;
  // Gives focus back to the remembered window, after Koto briefly took it (orb menu).
  static void RestoreFocusToTarget() noexcept;

  // Pastes into the remembered window and restores the previous clipboard.
  // Leaves the text on the clipboard instead (and returns Copied) when:
  // - focus moved to a different window since recording started,
  // - the target runs as administrator (Windows blocks input from normal apps),
  // - keyboard input could not be sent.
  // Throws std::runtime_error when even the clipboard is unavailable.
  static InsertionOutcome Insert(std::wstring const &text);

  // Puts text on the clipboard and leaves it there.
  static void Copy(std::wstring const &text);
};

} // namespace Koto

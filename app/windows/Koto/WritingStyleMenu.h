#pragma once

#include <functional>
#include <string>

namespace Koto::WritingStyleMenu {

// Menu command ids used by the style items, chosen to avoid the tray menu's own ids.
constexpr UINT kFirstCommand = 0x7000;

// neutral | casual | formal, as last set from JavaScript. Shown as the checked item.
void SetCurrent(std::string const &style) noexcept;

// Called when a style is picked from either menu.
void SetListener(std::function<void(std::string const &)> listener) noexcept;

// A popup menu listing the styles with the current one checked. The caller destroys it
// (destroying a parent menu also destroys it when appended as a submenu).
HMENU Create() noexcept;

// Returns true and notifies the listener if `command` is one of the style items.
bool HandleCommand(UINT command) noexcept;

} // namespace Koto::WritingStyleMenu

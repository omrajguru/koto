#include "pch.h"
#include "WritingStyleMenu.h"

#include <array>
#include <atomic>
#include <mutex>

namespace Koto::WritingStyleMenu {

namespace {
struct Style {
  char const *id;
  wchar_t const *label;
};

constexpr std::array<Style, 3> kStyles{{
    {"neutral", L"Neutral"},
    {"casual", L"Casual"},
    {"formal", L"Formal"},
}};

std::atomic<size_t> g_current{0};
std::mutex g_listenerMutex;
std::function<void(std::string const &)> g_listener;
} // namespace

void SetCurrent(std::string const &style) noexcept {
  for (size_t index = 0; index < kStyles.size(); ++index) {
    if (style == kStyles[index].id) {
      g_current = index;
      return;
    }
  }
}

void SetListener(std::function<void(std::string const &)> listener) noexcept {
  std::lock_guard lock(g_listenerMutex);
  g_listener = std::move(listener);
}

HMENU Create() noexcept {
  HMENU menu = CreatePopupMenu();
  for (size_t index = 0; index < kStyles.size(); ++index) {
    UINT const flags = MF_STRING | (index == g_current.load() ? MF_CHECKED : MF_UNCHECKED);
    AppendMenuW(menu, flags, kFirstCommand + static_cast<UINT>(index), kStyles[index].label);
  }
  return menu;
}

bool HandleCommand(UINT command) noexcept {
  if (command < kFirstCommand || command >= kFirstCommand + kStyles.size()) {
    return false;
  }
  size_t const index = command - kFirstCommand;
  g_current = index;
  std::function<void(std::string const &)> listener;
  {
    std::lock_guard lock(g_listenerMutex);
    listener = g_listener;
  }
  if (listener) {
    listener(kStyles[index].id);
  }
  return true;
}

} // namespace Koto::WritingStyleMenu

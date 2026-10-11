#pragma once

#include <optional>
#include <vector>
#include <string>

namespace Koto::BundleManager {

// Instant updates: a newer JavaScript bundle, downloaded and loaded without reinstalling the
// app. Native code never changes this way, so a bundle is only ever used with the exact
// native version it was built for.
//
// Safety: a newly installed bundle starts "on trial" and Koto restarts into it. JavaScript
// confirms it once it has started properly. If Koto starts a second time while the bundle is
// still on trial, that bundle is marked failed and the previous one (or the bundle built
// into the app) is used instead.

struct ActiveBundle {
  std::wstring directory; // Folder containing index.windows.bundle.
  std::string version;
};

// Decides which bundle to load. Returns nothing when the bundle built into the app should be
// used. Call once per process start; it rolls back a bundle that never confirmed a healthy start.
std::optional<ActiveBundle> Resolve(std::string const &nativeVersion) noexcept;

// The bundle version currently in use, or "built-in".
std::string ActiveVersion() noexcept;

// Downloads the bundle, checks its SHA-256, and makes it active on trial. Throws
// std::runtime_error with a readable message on failure; the current bundle is untouched.
void Install(
    std::wstring const &downloadUrl,
    std::string const &sha256,
    std::string const &version,
    std::string const &nativeVersion);

// Called by JavaScript once the running bundle has started properly.
void ConfirmHealthy() noexcept;

// Deletes downloaded bundles other than the given versions.
void RemoveUnusedBundles(std::vector<std::string> const &keep) noexcept;

} // namespace Koto::BundleManager

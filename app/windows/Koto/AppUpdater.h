#pragma once

#include <string>

namespace Koto::AppUpdater {

// The MSIX package version ("1.0.12.0"), or empty when running unpackaged.
std::string PackageVersion() noexcept;

// {"version":"1.0.12.0","architecture":"ARM64","isPackaged":true,"bundleVersion":"built-in"}
std::string AppInfoJson();

// Asks Windows to download and install the MSIX at `downloadUrl`, closing Koto to do so
// and restarting it afterwards. Normally the process ends before this returns. Throws
// std::runtime_error with a readable message if Windows rejects the update.
void InstallUpdate(std::wstring const &downloadUrl);

} // namespace Koto::AppUpdater

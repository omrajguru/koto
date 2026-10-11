#include "pch.h"
#include "AppUpdater.h"

#include "BundleManager.h"

#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Management.Deployment.h>

#include <stdexcept>

namespace Koto::AppUpdater {

namespace {
constexpr char const *kArchitecture =
#if defined(_M_ARM64)
    "ARM64";
#elif defined(_M_X64)
    "x64";
#else
    "x86";
#endif

std::string Narrow(winrt::hstring const &value) {
  return winrt::to_string(value);
}

std::string DescribeFailure(winrt::hresult code, std::string const &detail) {
  switch (static_cast<uint32_t>(code.value)) {
    case 0x800B0109: // CERT_E_UNTRUSTEDROOT
    case 0x800B010A: // CERT_E_CHAINING
      return "Windows does not trust the certificate this update is signed with. Install Koto-signing.cer once, then try again.";
    case 0x80073CFF: // ERROR_INSTALL_POLICY_FAILURE
      return "Windows is set to block apps from outside the Microsoft Store. Allow app sideloading in Settings, then try again.";
    case 0x80073CF3: // ERROR_INSTALL_RESOLVE_DEPENDENCY_FAILED
      return "The update needs a newer Windows App Runtime. Install it from the release page, then try again.";
    case 0x80072EE7: // WININET_E_NAME_NOT_RESOLVED
    case 0x80072EFD: // WININET_E_CANNOT_CONNECT
    case 0x80072EE2: // WININET_E_TIMEOUT
      return "The update could not be downloaded. Check your connection and try again.";
    default: {
      char buffer[32];
      sprintf_s(buffer, "0x%08X", static_cast<uint32_t>(code.value));
      return "Windows could not install the update (" + std::string(buffer) + ")." + (detail.empty() ? "" : " " + detail);
    }
  }
}
} // namespace

std::string PackageVersion() noexcept {
  try {
    auto const packageVersion = winrt::Windows::ApplicationModel::Package::Current().Id().Version();
    return std::to_string(packageVersion.Major) + "." + std::to_string(packageVersion.Minor) + "." +
        std::to_string(packageVersion.Build) + "." + std::to_string(packageVersion.Revision);
  } catch (...) {
    // Running unpackaged (development build): no package identity, so no updates.
    return {};
  }
}

std::string AppInfoJson() {
  std::string const version = PackageVersion();
  bool const isPackaged = !version.empty();
  return std::string("{\"version\":\"") + (isPackaged ? version : "0.0.0.0") + "\",\"architecture\":\"" +
      kArchitecture + "\",\"isPackaged\":" + (isPackaged ? "true" : "false") + ",\"bundleVersion\":\"" +
      BundleManager::ActiveVersion() + "\"}";
}

void InstallUpdate(std::wstring const &downloadUrl) {
  // Windows relaunches registered desktop apps after closing them for an update.
  RegisterApplicationRestart(nullptr, 0);
  try {
    winrt::Windows::Management::Deployment::PackageManager manager;
    // Windows downloads the package itself, which avoids handing it a file path inside
    // Koto's virtualised app data. ForceTargetApplicationShutdown closes Koto to install.
    auto const result = manager
                            .AddPackageAsync(
                                winrt::Windows::Foundation::Uri(downloadUrl),
                                nullptr,
                                winrt::Windows::Management::Deployment::DeploymentOptions::ForceTargetApplicationShutdown)
                            .get();
    if (FAILED(result.ExtendedErrorCode())) {
      UnregisterApplicationRestart();
      throw std::runtime_error(DescribeFailure(result.ExtendedErrorCode(), Narrow(result.ErrorText())));
    }
  } catch (winrt::hresult_error const &error) {
    UnregisterApplicationRestart();
    throw std::runtime_error(DescribeFailure(error.code(), Narrow(error.message())));
  }
}

} // namespace Koto::AppUpdater

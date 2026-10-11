#include "pch.h"
#include "BundleManager.h"

#include "LocalStorage.h"

#include <bcrypt.h>
#include <urlmon.h>

#include <cctype>
#include <fstream>
#include <map>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <vector>

#pragma comment(lib, "urlmon.lib")
#pragma comment(lib, "bcrypt.lib")

namespace Koto::BundleManager {

namespace {
constexpr wchar_t kBundleFileName[] = L"index.windows.bundle";
constexpr char kBuiltIn[] = "built-in";

std::mutex g_stateMutex;
std::string g_activeVersion = kBuiltIn;

// state.txt holds key=value lines:
//   native   native version the bundles below were built for
//   active   bundle version to load ("" = built-in)
//   previous bundle version to fall back to ("" = built-in)
//   trial    1 while the active bundle has not confirmed a healthy start
//   started  1 once a bundle on trial has been given its one start
//   failed   comma-separated versions that failed their trial
using State = std::map<std::string, std::string>;

std::wstring Widen(std::string const &value) {
  return std::wstring(value.begin(), value.end());
}

std::wstring BundlesDirectory() {
  std::wstring directory = LocalStorage::DataDirectory() + L"\\Bundles";
  CreateDirectoryW(directory.c_str(), nullptr);
  return directory;
}

std::wstring StatePath() {
  return BundlesDirectory() + L"\\state.txt";
}

std::wstring BundleFolder(std::string const &version) {
  return BundlesDirectory() + L"\\" + Widen(version);
}

bool IsSafeVersion(std::string const &version) {
  if (version.empty() || version.size() > 40) {
    return false;
  }
  for (char character : version) {
    if (!isalnum(static_cast<unsigned char>(character)) && character != '.' && character != '-') {
      return false;
    }
  }
  return true;
}

State ReadState() {
  State state;
  std::ifstream stream(StatePath());
  std::string line;
  while (std::getline(stream, line)) {
    auto const separator = line.find('=');
    if (separator != std::string::npos) {
      state[line.substr(0, separator)] = line.substr(separator + 1);
    }
  }
  return state;
}

void WriteState(State const &state) {
  std::wstring const path = StatePath();
  std::wstring const temporary = path + L".tmp";
  {
    std::ofstream stream(temporary, std::ios::trunc);
    for (auto const &[key, value] : state) {
      stream << key << '=' << value << '\n';
    }
  }
  MoveFileExW(temporary.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
}

bool HasBundle(std::string const &version) {
  return IsSafeVersion(version) &&
      GetFileAttributesW((BundleFolder(version) + L"\\" + kBundleFileName).c_str()) != INVALID_FILE_ATTRIBUTES;
}

std::string Sha256OfFile(std::wstring const &path) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) {
    throw std::runtime_error("The downloaded update could not be read.");
  }
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0 ||
      BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0) != 0) {
    if (algorithm) {
      BCryptCloseAlgorithmProvider(algorithm, 0);
    }
    throw std::runtime_error("Could not check the update.");
  }
  std::vector<char> buffer(1 << 16);
  while (stream) {
    stream.read(buffer.data(), buffer.size());
    auto const count = static_cast<ULONG>(stream.gcount());
    if (count > 0) {
      BCryptHashData(hash, reinterpret_cast<PUCHAR>(buffer.data()), count, 0);
    }
  }
  UCHAR digest[32];
  BCryptFinishHash(hash, digest, sizeof(digest), 0);
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  std::ostringstream hex;
  for (UCHAR byte : digest) {
    char pair[3];
    sprintf_s(pair, "%02x", byte);
    hex << pair;
  }
  return hex.str();
}
} // namespace

std::optional<ActiveBundle> Resolve(std::string const &nativeVersion) noexcept {
  try {
    std::lock_guard lock(g_stateMutex);
    State state = ReadState();
    // Bundles built for another native version (the app was updated or downgraded) are stale.
    if (state["native"] != nativeVersion) {
      g_activeVersion = kBuiltIn;
      return std::nullopt;
    }
    // A bundle on trial gets one start (the restart right after installing). Still on trial at
    // the start after that means it never confirmed a healthy start: roll back.
    if (state["trial"] == "1" && !state["active"].empty() && state["started"] != "1") {
      state["started"] = "1";
      WriteState(state);
    } else if (state["trial"] == "1" && !state["active"].empty()) {
      state["failed"] += (state["failed"].empty() ? "" : ",") + state["active"];
      state["active"] = HasBundle(state["previous"]) ? state["previous"] : "";
      state["previous"] = "";
      state["trial"] = "0";
      state["started"] = "0";
      WriteState(state);
    }
    std::string const active = state["active"];
    if (!HasBundle(active)) {
      g_activeVersion = kBuiltIn;
      return std::nullopt;
    }
    g_activeVersion = active;
    return ActiveBundle{BundleFolder(active), active};
  } catch (...) {
    g_activeVersion = kBuiltIn;
    return std::nullopt;
  }
}

std::string ActiveVersion() noexcept {
  std::lock_guard lock(g_stateMutex);
  return g_activeVersion;
}

void Install(
    std::wstring const &downloadUrl,
    std::string const &sha256,
    std::string const &version,
    std::string const &nativeVersion) {
  if (!IsSafeVersion(version) || sha256.size() != 64) {
    throw std::invalid_argument("The update description is not valid.");
  }
  std::wstring const folder = BundleFolder(version);
  CreateDirectoryW(folder.c_str(), nullptr);
  std::wstring const finalPath = folder + L"\\" + kBundleFileName;
  std::wstring const downloadPath = finalPath + L".download";
  DeleteFileW(downloadPath.c_str());
  if (FAILED(URLDownloadToFileW(nullptr, downloadUrl.c_str(), downloadPath.c_str(), 0, nullptr))) {
    throw std::runtime_error("The update could not be downloaded. Check your connection and try again.");
  }
  std::string actual = Sha256OfFile(downloadPath);
  std::string expected = sha256;
  for (char &character : expected) {
    character = static_cast<char>(tolower(static_cast<unsigned char>(character)));
  }
  if (actual != expected) {
    DeleteFileW(downloadPath.c_str());
    throw std::runtime_error("The downloaded update was damaged, so it was not installed. Try again.");
  }
  if (!MoveFileExW(downloadPath.c_str(), finalPath.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    throw std::runtime_error("The update could not be saved.");
  }

  std::lock_guard lock(g_stateMutex);
  State state = ReadState();
  if (state["native"] != nativeVersion) {
    state.clear();
    state["native"] = nativeVersion;
  }
  // Fall back to the bundle running now if the new one fails its trial.
  state["previous"] = g_activeVersion == kBuiltIn ? "" : g_activeVersion;
  state["active"] = version;
  state["trial"] = "1";
  state["started"] = "0";
  WriteState(state);
  RemoveUnusedBundles({state["active"], state["previous"]});
}

void RemoveUnusedBundles(std::vector<std::string> const &keep) noexcept {
  WIN32_FIND_DATAW entry;
  std::wstring const directory = BundlesDirectory();
  HANDLE search = FindFirstFileW((directory + L"\\*").c_str(), &entry);
  if (search == INVALID_HANDLE_VALUE) {
    return;
  }
  do {
    std::wstring const name = entry.cFileName;
    if (!(entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || name == L"." || name == L"..") {
      continue;
    }
    bool isKept = false;
    for (auto const &version : keep) {
      isKept = isKept || (!version.empty() && Widen(version) == name);
    }
    if (!isKept) {
      std::wstring const folder = directory + L"\\" + name;
      DeleteFileW((folder + L"\\" + kBundleFileName).c_str());
      DeleteFileW((folder + L"\\" + kBundleFileName + L".download").c_str());
      RemoveDirectoryW(folder.c_str());
    }
  } while (FindNextFileW(search, &entry));
  FindClose(search);
}

void ConfirmHealthy() noexcept {
  try {
    std::lock_guard lock(g_stateMutex);
    State state = ReadState();
    if (state["trial"] == "1") {
      state["trial"] = "0";
      state["started"] = "0";
      WriteState(state);
    }
  } catch (...) {
  }
}

} // namespace Koto::BundleManager

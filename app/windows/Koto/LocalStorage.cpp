#include "pch.h"
#include "LocalStorage.h"

#include <ShlObj.h>
#include <wincred.h>

#include <winrt/Windows.ApplicationModel.Activation.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.Foundation.h>

#include <fstream>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace Koto::LocalStorage {

namespace {
constexpr wchar_t kStartupTaskId[] = L"KotoStartup";
constexpr wchar_t kRunKey[] = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
constexpr wchar_t kRunValue[] = L"Koto";
constexpr wchar_t kLaunchedAtLoginArgument[] = L"--launched-at-login";
constexpr char kBase64Alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::wstring Widen(std::string const &value) {
  if (value.empty()) {
    return {};
  }
  int const length = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
  std::wstring result(length, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length);
  return result;
}

std::wstring DocumentPath(std::string const &name) {
  bool const isSafe = !name.empty() && name.find_first_of("/\\:") == std::string::npos && name.find("..") == std::string::npos;
  if (!isSafe) {
    throw std::invalid_argument("Invalid document name.");
  }
  return DataDirectory() + L"\\" + Widen(name);
}

std::wstring CredentialTarget(std::string const &key) {
  return L"Koto/" + Widen(key);
}

bool IsPackaged() {
  try {
    return !winrt::Windows::ApplicationModel::Package::Current().Id().Name().empty();
  } catch (...) {
    return false;
  }
}

std::wstring ExecutablePath() {
  wchar_t path[MAX_PATH];
  GetModuleFileNameW(nullptr, path, MAX_PATH);
  return path;
}
} // namespace

std::wstring DataDirectory() {
  PWSTR base = nullptr;
  std::wstring directory;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &base))) {
    directory = std::wstring(base) + L"\\Koto";
  }
  CoTaskMemFree(base);
  CreateDirectoryW(directory.c_str(), nullptr);
  return directory;
}

namespace {
// Where recordings were kept before they moved to Documents.
std::wstring LegacyRecordingsDirectory() {
  return DataDirectory() + L"\\Recordings";
}

std::wstring VoiceNotesDirectory() {
  static std::wstring const directory = [] {
    PWSTR documents = nullptr;
    std::wstring folder;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Documents, KF_FLAG_CREATE, nullptr, &documents))) {
      folder = std::wstring(documents) + L"\\Koto\\Voice notes";
    }
    CoTaskMemFree(documents);
    return folder;
  }();
  return directory;
}
} // namespace

std::wstring RecordingsDirectory() {
  std::wstring const voiceNotes = VoiceNotesDirectory();
  if (!voiceNotes.empty()) {
    // Created on every call, so a folder deleted while Koto runs comes back.
    int const created = SHCreateDirectoryExW(nullptr, voiceNotes.c_str(), nullptr);
    if (created == ERROR_SUCCESS || created == ERROR_ALREADY_EXISTS || created == ERROR_FILE_EXISTS) {
      return voiceNotes;
    }
  }
  std::wstring const legacy = LegacyRecordingsDirectory();
  CreateDirectoryW(legacy.c_str(), nullptr);
  return legacy;
}

void MoveLegacyRecordings() noexcept {
  try {
    std::wstring const from = LegacyRecordingsDirectory();
    std::wstring const to = RecordingsDirectory();
    if (lstrcmpiW(from.c_str(), to.c_str()) == 0) {
      return;
    }
    WIN32_FIND_DATAW entry;
    HANDLE search = FindFirstFileW((from + L"\\*.wav").c_str(), &entry);
    if (search == INVALID_HANDLE_VALUE) {
      return;
    }
    do {
      if (entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
        continue;
      }
      std::wstring const source = from + L"\\" + entry.cFileName;
      std::wstring const target = to + L"\\" + entry.cFileName;
      // A failed move leaves the file where it was; ResolveRecordingPath still finds it.
      MoveFileExW(source.c_str(), target.c_str(), MOVEFILE_COPY_ALLOWED | MOVEFILE_WRITE_THROUGH);
    } while (FindNextFileW(search, &entry));
    FindClose(search);
  } catch (...) {
  }
}

std::wstring ResolveRecordingPath(std::wstring const &path) {
  if (GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES) {
    return path;
  }
  auto const separator = path.find_last_of(L"\\/");
  std::wstring const name = separator == std::wstring::npos ? path : path.substr(separator + 1);
  std::wstring const moved = RecordingsDirectory() + L"\\" + name;
  return GetFileAttributesW(moved.c_str()) != INVALID_FILE_ATTRIBUTES ? moved : path;
}

std::string ReadDocument(std::string const &name) {
  std::ifstream stream(DocumentPath(name), std::ios::binary);
  if (!stream) {
    return {};
  }
  std::ostringstream contents;
  contents << stream.rdbuf();
  return contents.str();
}

void WriteDocument(std::string const &name, std::string const &contents) {
  std::wstring const path = DocumentPath(name);
  std::wstring const temporary = path + L".tmp";
  {
    std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
    if (!stream) {
      throw std::runtime_error("Could not write settings.");
    }
    stream.write(contents.data(), contents.size());
    stream.flush();
    if (!stream) {
      throw std::runtime_error("Could not write settings.");
    }
  }
  if (!MoveFileExW(temporary.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    throw std::runtime_error("Could not save settings.");
  }
}

std::string ReadBinaryBase64(std::wstring const &path) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) {
    throw std::runtime_error("The recording file is missing.");
  }
  std::vector<unsigned char> bytes((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
  std::string encoded;
  encoded.reserve(((bytes.size() + 2) / 3) * 4);
  for (size_t index = 0; index < bytes.size(); index += 3) {
    uint32_t triple = bytes[index] << 16;
    if (index + 1 < bytes.size()) triple |= bytes[index + 1] << 8;
    if (index + 2 < bytes.size()) triple |= bytes[index + 2];
    encoded.push_back(kBase64Alphabet[(triple >> 18) & 63]);
    encoded.push_back(kBase64Alphabet[(triple >> 12) & 63]);
    encoded.push_back(index + 1 < bytes.size() ? kBase64Alphabet[(triple >> 6) & 63] : '=');
    encoded.push_back(index + 2 < bytes.size() ? kBase64Alphabet[triple & 63] : '=');
  }
  return encoded;
}

void DeleteRecording(std::wstring const &path) {
  if (path.find(L"..") != std::wstring::npos) {
    throw std::invalid_argument("Only recordings can be deleted.");
  }
  std::wstring const resolved = ResolveRecordingPath(path);
  auto const isInside = [&resolved](std::wstring const &directory) { return resolved.rfind(directory + L"\\", 0) == 0; };
  if (!isInside(RecordingsDirectory()) && !isInside(LegacyRecordingsDirectory())) {
    throw std::invalid_argument("Only recordings can be deleted.");
  }
  DeleteFileW(resolved.c_str());
}

std::string ReadSecret(std::string const &key) {
  PCREDENTIALW credential = nullptr;
  if (!CredReadW(CredentialTarget(key).c_str(), CRED_TYPE_GENERIC, 0, &credential)) {
    return {};
  }
  std::string value(reinterpret_cast<char const *>(credential->CredentialBlob), credential->CredentialBlobSize);
  CredFree(credential);
  return value;
}

void WriteSecret(std::string const &key, std::string const &value) {
  std::wstring target = CredentialTarget(key);
  CREDENTIALW credential{};
  credential.Type = CRED_TYPE_GENERIC;
  credential.TargetName = target.data();
  credential.CredentialBlobSize = static_cast<DWORD>(value.size());
  credential.CredentialBlob = reinterpret_cast<LPBYTE>(const_cast<char *>(value.data()));
  credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
  wchar_t userName[] = L"Koto";
  credential.UserName = userName;
  if (!CredWriteW(&credential, 0)) {
    throw std::runtime_error("Could not save to Windows Credential Manager.");
  }
}

void DeleteSecret(std::string const &key) {
  CredDeleteW(CredentialTarget(key).c_str(), CRED_TYPE_GENERIC, 0);
}

void SetLaunchAtLogin(bool isEnabled) {
  if (IsPackaged()) {
    auto task = winrt::Windows::ApplicationModel::StartupTask::GetAsync(kStartupTaskId).get();
    if (isEnabled) {
      task.RequestEnableAsync().get();
    } else {
      task.Disable();
    }
    return;
  }
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, kRunKey, 0, KEY_SET_VALUE, &key) != ERROR_SUCCESS) {
    throw std::runtime_error("Could not change startup settings.");
  }
  if (isEnabled) {
    std::wstring const command = L"\"" + ExecutablePath() + L"\" " + kLaunchedAtLoginArgument;
    RegSetValueExW(
        key,
        kRunValue,
        0,
        REG_SZ,
        reinterpret_cast<BYTE const *>(command.c_str()),
        static_cast<DWORD>((command.size() + 1) * sizeof(wchar_t)));
  } else {
    RegDeleteValueW(key, kRunValue);
  }
  RegCloseKey(key);
}

bool GetLaunchAtLogin() {
  if (IsPackaged()) {
    auto task = winrt::Windows::ApplicationModel::StartupTask::GetAsync(kStartupTaskId).get();
    auto const state = task.State();
    return state == winrt::Windows::ApplicationModel::StartupTaskState::Enabled ||
        state == winrt::Windows::ApplicationModel::StartupTaskState::EnabledByPolicy;
  }
  HKEY key = nullptr;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, kRunKey, 0, KEY_QUERY_VALUE, &key) != ERROR_SUCCESS) {
    return false;
  }
  bool const exists = RegQueryValueExW(key, kRunValue, nullptr, nullptr, nullptr, nullptr) == ERROR_SUCCESS;
  RegCloseKey(key);
  return exists;
}

bool WasLaunchedAtLogin() {
  if (wcsstr(GetCommandLineW(), kLaunchedAtLoginArgument)) {
    return true;
  }
  if (!IsPackaged()) {
    return false;
  }
  try {
    auto const arguments = winrt::Windows::ApplicationModel::AppInstance::GetActivatedEventArgs();
    return arguments && arguments.Kind() == winrt::Windows::ApplicationModel::Activation::ActivationKind::StartupTask;
  } catch (...) {
    return false;
  }
}

} // namespace Koto::LocalStorage

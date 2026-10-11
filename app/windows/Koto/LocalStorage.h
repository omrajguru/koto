#pragma once

#include <string>

namespace Koto::LocalStorage {

// %LOCALAPPDATA%\Koto (redirected into the package folder when running as MSIX).
std::wstring DataDirectory();
// Documents\Koto\Voice notes, where every recording is written and kept. Falls back to
// DataDirectory()\Recordings if Documents is unavailable.
std::wstring RecordingsDirectory();
// Moves recordings from the old hidden folder (DataDirectory()\Recordings) into
// RecordingsDirectory(). Called once at startup.
void MoveLegacyRecordings() noexcept;
// The path itself if the file exists, otherwise the file of the same name in
// RecordingsDirectory() (history written before the move still has old paths).
std::wstring ResolveRecordingPath(std::wstring const &path);

// Throws std::invalid_argument when a name could escape the data directory.
std::string ReadDocument(std::string const &name);
// Writes to a temporary file and renames it, so a crash never leaves a half-written document.
void WriteDocument(std::string const &name, std::string const &contents);

std::string ReadBinaryBase64(std::wstring const &path);
// Only deletes files inside the recordings directory (current or old).
void DeleteRecording(std::wstring const &path);

// Windows Credential Manager, scoped to the signed-in Windows user.
std::string ReadSecret(std::string const &key);
void WriteSecret(std::string const &key, std::string const &value);
void DeleteSecret(std::string const &key);

void SetLaunchAtLogin(bool isEnabled);
bool GetLaunchAtLogin();
// True when Windows started Koto at sign-in, so the window should stay hidden.
bool WasLaunchedAtLogin();

} // namespace Koto::LocalStorage

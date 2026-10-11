#pragma once

#include "codegen/NativeDesktopIntegrationSpec.g.h"

#include <NativeModules.h>

#include <functional>
#include <string>

namespace Koto {

// Set by Koto.cpp so JavaScript can reopen the window after it was closed to the tray.
struct WindowHost {
  static std::function<void()> &ShowMainWindow() noexcept {
    static std::function<void()> handler;
    return handler;
  }
  // Restarts Koto so it starts on the newest installed bundle (see Koto.cpp,
  // RestartWithInstalledBundle; an in-process reload crashed Hermes).
  static std::function<void()> &ReloadWithInstalledBundle() noexcept {
    static std::function<void()> handler;
    return handler;
  }
};

REACT_TURBO_MODULE(DesktopIntegration)
struct DesktopIntegration {
  using ModuleSpec = KotoCodegen::DesktopIntegrationSpec;

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept;

  REACT_METHOD(startHotkeyListener)
  void startHotkeyListener() noexcept;
  REACT_METHOD(stopHotkeyListener)
  void stopHotkeyListener() noexcept;

  REACT_METHOD(startRecording)
  void startRecording(winrt::Microsoft::ReactNative::ReactPromise<std::string> &&result) noexcept;
  REACT_METHOD(stopRecording)
  void stopRecording(winrt::Microsoft::ReactNative::ReactPromise<std::string> &&result) noexcept;
  REACT_METHOD(readAudioFile)
  void readAudioFile(std::string path, winrt::Microsoft::ReactNative::ReactPromise<std::string> &&result) noexcept;
  REACT_METHOD(deleteAudioFile)
  void deleteAudioFile(std::string path, winrt::Microsoft::ReactNative::ReactPromise<void> &&result) noexcept;
  REACT_METHOD(getVoiceNotesFolder)
  void getVoiceNotesFolder(winrt::Microsoft::ReactNative::ReactPromise<std::string> &&result) noexcept;
  REACT_METHOD(openVoiceNotesFolder)
  void openVoiceNotesFolder() noexcept;

  REACT_METHOD(setOverlayState)
  void setOverlayState(std::string state, std::string message) noexcept;

  REACT_METHOD(insertText)
  void insertText(std::string text, winrt::Microsoft::ReactNative::ReactPromise<std::string> &&result) noexcept;
  REACT_METHOD(copyText)
  void copyText(std::string text, winrt::Microsoft::ReactNative::ReactPromise<void> &&result) noexcept;

  REACT_METHOD(readSecret)
  void readSecret(std::string key, winrt::Microsoft::ReactNative::ReactPromise<std::string> &&result) noexcept;
  REACT_METHOD(writeSecret)
  void writeSecret(std::string key, std::string value, winrt::Microsoft::ReactNative::ReactPromise<void> &&result) noexcept;
  REACT_METHOD(deleteSecret)
  void deleteSecret(std::string key, winrt::Microsoft::ReactNative::ReactPromise<void> &&result) noexcept;

  REACT_METHOD(readDocument)
  void readDocument(std::string name, winrt::Microsoft::ReactNative::ReactPromise<std::string> &&result) noexcept;
  REACT_METHOD(writeDocument)
  void writeDocument(std::string name, std::string contents, winrt::Microsoft::ReactNative::ReactPromise<void> &&result) noexcept;

  REACT_METHOD(setLaunchAtLogin)
  void setLaunchAtLogin(bool isEnabled, winrt::Microsoft::ReactNative::ReactPromise<void> &&result) noexcept;
  REACT_METHOD(getLaunchAtLogin)
  void getLaunchAtLogin(winrt::Microsoft::ReactNative::ReactPromise<bool> &&result) noexcept;
  REACT_METHOD(showMainWindow)
  void showMainWindow() noexcept;

  REACT_METHOD(setWritingStyle)
  void setWritingStyle(std::string style) noexcept;

  REACT_METHOD(listMicrophones)
  void listMicrophones(winrt::Microsoft::ReactNative::ReactPromise<std::string> &&result) noexcept;
  REACT_METHOD(setMicrophone)
  void setMicrophone(std::string id) noexcept;

  REACT_METHOD(installBundle)
  void installBundle(
      std::string downloadUrl,
      std::string sha256,
      std::string version,
      winrt::Microsoft::ReactNative::ReactPromise<void> &&result) noexcept;
  REACT_METHOD(reloadWithInstalledBundle)
  void reloadWithInstalledBundle() noexcept;
  REACT_METHOD(confirmBundleHealthy)
  void confirmBundleHealthy() noexcept;

  REACT_METHOD(getAppInfo)
  void getAppInfo(winrt::Microsoft::ReactNative::ReactPromise<std::string> &&result) noexcept;
  REACT_METHOD(installUpdate)
  void installUpdate(std::string downloadUrl, winrt::Microsoft::ReactNative::ReactPromise<void> &&result) noexcept;


  REACT_EVENT(onHotkey)
  std::function<void(std::string)> onHotkey;
  REACT_EVENT(onAudioFrame)
  std::function<void(std::string)> onAudioFrame;
  REACT_EVENT(onRecordingError)
  std::function<void(std::string)> onRecordingError;
  REACT_EVENT(onWritingStyleChange)
  std::function<void(std::string)> onWritingStyleChange;
  REACT_EVENT(onMicrophoneChange)
  std::function<void(std::string)> onMicrophoneChange;
  REACT_EVENT(onMicrophonesChanged)
  std::function<void(std::string)> onMicrophonesChanged;

 private:
  winrt::Microsoft::ReactNative::ReactContext m_context;
};

} // namespace Koto

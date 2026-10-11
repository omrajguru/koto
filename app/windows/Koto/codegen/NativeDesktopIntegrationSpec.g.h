
/*
 * This file is auto-generated from a NativeModule spec file in js.
 *
 * This is a C++ Spec class that should be used with MakeTurboModuleProvider to register native modules
 * in a way that also verifies at compile time that the native module matches the interface required
 * by the TurboModule JS spec.
 */
#pragma once
// clang-format off

#include <NativeModules.h>
#include <tuple>

namespace KotoCodegen {


struct DesktopIntegrationSpec : winrt::Microsoft::ReactNative::TurboModuleSpec {
  static constexpr auto methods = std::tuple{
      Method<void() noexcept>{0, L"startHotkeyListener"},
      Method<void() noexcept>{1, L"stopHotkeyListener"},
      Method<void(Promise<std::string>) noexcept>{2, L"startRecording"},
      Method<void(Promise<std::string>) noexcept>{3, L"stopRecording"},
      Method<void(std::string, Promise<std::string>) noexcept>{4, L"readAudioFile"},
      Method<void(std::string, Promise<void>) noexcept>{5, L"deleteAudioFile"},
      Method<void(Promise<std::string>) noexcept>{6, L"getVoiceNotesFolder"},
      Method<void() noexcept>{7, L"openVoiceNotesFolder"},
      Method<void(std::string, std::string) noexcept>{8, L"setOverlayState"},
      Method<void(std::string, Promise<std::string>) noexcept>{9, L"insertText"},
      Method<void(std::string, Promise<void>) noexcept>{10, L"copyText"},
      Method<void(std::string, Promise<std::string>) noexcept>{11, L"readSecret"},
      Method<void(std::string, std::string, Promise<void>) noexcept>{12, L"writeSecret"},
      Method<void(std::string, Promise<void>) noexcept>{13, L"deleteSecret"},
      Method<void(std::string, Promise<std::string>) noexcept>{14, L"readDocument"},
      Method<void(std::string, std::string, Promise<void>) noexcept>{15, L"writeDocument"},
      Method<void(bool, Promise<void>) noexcept>{16, L"setLaunchAtLogin"},
      Method<void(Promise<bool>) noexcept>{17, L"getLaunchAtLogin"},
      Method<void() noexcept>{18, L"showMainWindow"},
      Method<void(std::string) noexcept>{19, L"setWritingStyle"},
      Method<void(Promise<std::string>) noexcept>{20, L"listMicrophones"},
      Method<void(std::string) noexcept>{21, L"setMicrophone"},
      Method<void(std::string, std::string, std::string, Promise<void>) noexcept>{22, L"installBundle"},
      Method<void() noexcept>{23, L"reloadWithInstalledBundle"},
      Method<void() noexcept>{24, L"confirmBundleHealthy"},
      Method<void(Promise<std::string>) noexcept>{25, L"getAppInfo"},
      Method<void(std::string, Promise<void>) noexcept>{26, L"installUpdate"},
      EventEmitter<void(std::string)>{27, L"onHotkey"},
      EventEmitter<void(std::string)>{28, L"onAudioFrame"},
      EventEmitter<void(std::string)>{29, L"onRecordingError"},
      EventEmitter<void(std::string)>{30, L"onWritingStyleChange"},
      EventEmitter<void(std::string)>{31, L"onMicrophoneChange"},
      EventEmitter<void(std::string)>{32, L"onMicrophonesChanged"},
  };

  template <class TModule>
  static constexpr void ValidateModule() noexcept {
    constexpr auto methodCheckResults = CheckMethods<TModule, DesktopIntegrationSpec>();

    REACT_SHOW_METHOD_SPEC_ERRORS(
          0,
          "startHotkeyListener",
          "    REACT_METHOD(startHotkeyListener) void startHotkeyListener() noexcept { /* implementation */ }\n"
          "    REACT_METHOD(startHotkeyListener) static void startHotkeyListener() noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          1,
          "stopHotkeyListener",
          "    REACT_METHOD(stopHotkeyListener) void stopHotkeyListener() noexcept { /* implementation */ }\n"
          "    REACT_METHOD(stopHotkeyListener) static void stopHotkeyListener() noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          2,
          "startRecording",
          "    REACT_METHOD(startRecording) void startRecording(::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(startRecording) static void startRecording(::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          3,
          "stopRecording",
          "    REACT_METHOD(stopRecording) void stopRecording(::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(stopRecording) static void stopRecording(::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          4,
          "readAudioFile",
          "    REACT_METHOD(readAudioFile) void readAudioFile(std::string path, ::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(readAudioFile) static void readAudioFile(std::string path, ::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          5,
          "deleteAudioFile",
          "    REACT_METHOD(deleteAudioFile) void deleteAudioFile(std::string path, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(deleteAudioFile) static void deleteAudioFile(std::string path, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          6,
          "getVoiceNotesFolder",
          "    REACT_METHOD(getVoiceNotesFolder) void getVoiceNotesFolder(::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(getVoiceNotesFolder) static void getVoiceNotesFolder(::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          7,
          "openVoiceNotesFolder",
          "    REACT_METHOD(openVoiceNotesFolder) void openVoiceNotesFolder() noexcept { /* implementation */ }\n"
          "    REACT_METHOD(openVoiceNotesFolder) static void openVoiceNotesFolder() noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          8,
          "setOverlayState",
          "    REACT_METHOD(setOverlayState) void setOverlayState(std::string state, std::string message) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(setOverlayState) static void setOverlayState(std::string state, std::string message) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          9,
          "insertText",
          "    REACT_METHOD(insertText) void insertText(std::string text, ::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(insertText) static void insertText(std::string text, ::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          10,
          "copyText",
          "    REACT_METHOD(copyText) void copyText(std::string text, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(copyText) static void copyText(std::string text, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          11,
          "readSecret",
          "    REACT_METHOD(readSecret) void readSecret(std::string key, ::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(readSecret) static void readSecret(std::string key, ::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          12,
          "writeSecret",
          "    REACT_METHOD(writeSecret) void writeSecret(std::string key, std::string value, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(writeSecret) static void writeSecret(std::string key, std::string value, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          13,
          "deleteSecret",
          "    REACT_METHOD(deleteSecret) void deleteSecret(std::string key, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(deleteSecret) static void deleteSecret(std::string key, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          14,
          "readDocument",
          "    REACT_METHOD(readDocument) void readDocument(std::string name, ::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(readDocument) static void readDocument(std::string name, ::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          15,
          "writeDocument",
          "    REACT_METHOD(writeDocument) void writeDocument(std::string name, std::string contents, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(writeDocument) static void writeDocument(std::string name, std::string contents, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          16,
          "setLaunchAtLogin",
          "    REACT_METHOD(setLaunchAtLogin) void setLaunchAtLogin(bool isEnabled, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(setLaunchAtLogin) static void setLaunchAtLogin(bool isEnabled, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          17,
          "getLaunchAtLogin",
          "    REACT_METHOD(getLaunchAtLogin) void getLaunchAtLogin(::React::ReactPromise<bool> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(getLaunchAtLogin) static void getLaunchAtLogin(::React::ReactPromise<bool> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          18,
          "showMainWindow",
          "    REACT_METHOD(showMainWindow) void showMainWindow() noexcept { /* implementation */ }\n"
          "    REACT_METHOD(showMainWindow) static void showMainWindow() noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          19,
          "setWritingStyle",
          "    REACT_METHOD(setWritingStyle) void setWritingStyle(std::string style) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(setWritingStyle) static void setWritingStyle(std::string style) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          20,
          "listMicrophones",
          "    REACT_METHOD(listMicrophones) void listMicrophones(::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(listMicrophones) static void listMicrophones(::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          21,
          "setMicrophone",
          "    REACT_METHOD(setMicrophone) void setMicrophone(std::string id) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(setMicrophone) static void setMicrophone(std::string id) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          22,
          "installBundle",
          "    REACT_METHOD(installBundle) void installBundle(std::string downloadUrl, std::string sha256, std::string version, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(installBundle) static void installBundle(std::string downloadUrl, std::string sha256, std::string version, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          23,
          "reloadWithInstalledBundle",
          "    REACT_METHOD(reloadWithInstalledBundle) void reloadWithInstalledBundle() noexcept { /* implementation */ }\n"
          "    REACT_METHOD(reloadWithInstalledBundle) static void reloadWithInstalledBundle() noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          24,
          "confirmBundleHealthy",
          "    REACT_METHOD(confirmBundleHealthy) void confirmBundleHealthy() noexcept { /* implementation */ }\n"
          "    REACT_METHOD(confirmBundleHealthy) static void confirmBundleHealthy() noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          25,
          "getAppInfo",
          "    REACT_METHOD(getAppInfo) void getAppInfo(::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(getAppInfo) static void getAppInfo(::React::ReactPromise<std::string> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_METHOD_SPEC_ERRORS(
          26,
          "installUpdate",
          "    REACT_METHOD(installUpdate) void installUpdate(std::string downloadUrl, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n"
          "    REACT_METHOD(installUpdate) static void installUpdate(std::string downloadUrl, ::React::ReactPromise<void> &&result) noexcept { /* implementation */ }\n");
    REACT_SHOW_EVENTEMITTER_SPEC_ERRORS(
          27,
          "onHotkey",
          "    REACT_EVENT(onHotkey) std::function<void(std::string)> onHotkey;\n");
    REACT_SHOW_EVENTEMITTER_SPEC_ERRORS(
          28,
          "onAudioFrame",
          "    REACT_EVENT(onAudioFrame) std::function<void(std::string)> onAudioFrame;\n");
    REACT_SHOW_EVENTEMITTER_SPEC_ERRORS(
          29,
          "onRecordingError",
          "    REACT_EVENT(onRecordingError) std::function<void(std::string)> onRecordingError;\n");
    REACT_SHOW_EVENTEMITTER_SPEC_ERRORS(
          30,
          "onWritingStyleChange",
          "    REACT_EVENT(onWritingStyleChange) std::function<void(std::string)> onWritingStyleChange;\n");
    REACT_SHOW_EVENTEMITTER_SPEC_ERRORS(
          31,
          "onMicrophoneChange",
          "    REACT_EVENT(onMicrophoneChange) std::function<void(std::string)> onMicrophoneChange;\n");
    REACT_SHOW_EVENTEMITTER_SPEC_ERRORS(
          32,
          "onMicrophonesChanged",
          "    REACT_EVENT(onMicrophonesChanged) std::function<void(std::string)> onMicrophonesChanged;\n");
  }
};

} // namespace KotoCodegen

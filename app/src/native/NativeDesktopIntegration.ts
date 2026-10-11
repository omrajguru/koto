import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Bridge to the operating system features a dictation app needs and that
 * React Native does not provide: a global hotkey, microphone capture, the
 * floating orb overlay, inserting text into the focused app, and storage.
 *
 * Implemented in windows/Koto/DesktopIntegration.{h,cpp}.
 */
export interface Spec extends TurboModule {
  /** Begins listening for the dictation hotkey (Ctrl + Win). */
  startHotkeyListener(): void;
  stopHotkeyListener(): void;

  /**
   * Starts capturing the default microphone as 16 kHz mono 16-bit PCM.
   * Audio is written to a WAV file as it arrives (so nothing is lost if the
   * app quits) and is also emitted through onAudioFrame as base64.
   * Also remembers the focused window so insertText can check it is unchanged.
   * Resolves with the recording's file path.
   */
  startRecording(): Promise<string>;
  /** Stops capturing and finalises the WAV header. Resolves with the file path. */
  stopRecording(): Promise<string>;
  /** Whole file as base64. */
  readAudioFile(path: string): Promise<string>;
  deleteAudioFile(path: string): Promise<void>;
  /** Where voice notes are kept: Documents\Koto\Voice notes. */
  getVoiceNotesFolder(): Promise<string>;
  /** Opens that folder in File Explorer. */
  openVoiceNotesFolder(): void;

  /**
   * state: hidden | listening | handsFree | processing | notice | error.
   * message: short text shown beside the orb for notice and error, otherwise ''.
   */
  setOverlayState(state: string, message: string): void;

  /**
   * Pastes text into the window that was focused when recording started.
   * Resolves 'pasted' after pasting and restoring the previous clipboard, or
   * 'copied' when pasting was unsafe (focus moved or an administrator app is
   * focused) and the text was left on the clipboard instead.
   */
  insertText(text: string): Promise<string>;
  copyText(text: string): Promise<void>;

  /** Stored in Windows Credential Manager. Resolves '' when missing. */
  readSecret(key: string): Promise<string>;
  writeSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;

  /** Plain files in the app's data directory. Resolves '' when missing. */
  readDocument(name: string): Promise<string>;
  writeDocument(name: string, contents: string): Promise<void>;

  /** Registers Koto to start when the person signs in to the computer. */
  setLaunchAtLogin(isEnabled: boolean): Promise<void>;
  getLaunchAtLogin(): Promise<boolean>;
  /** Brings the main window back after it was closed to the tray. */
  showMainWindow(): void;

  /** neutral | casual | formal. Shown as the checked item in the tray and orb style menus. */
  setWritingStyle(style: string): void;

  /**
   * JSON array of connected microphones: [{ id, name, isDefault }]. isDefault marks the
   * Windows default recording device.
   */
  listMicrophones(): Promise<string>;
  /**
   * The microphone to record from ('' = Windows default). Recording falls back to the
   * Windows default while it is not connected. Shown as checked in the tray and orb menus.
   */
  setMicrophone(id: string): void;

  /**
   * Instant updates: downloads a JavaScript bundle built for this native version, checks
   * its SHA-256 and installs it on trial. Rejects with a readable message; the bundle in
   * use is untouched on failure.
   */
  installBundle(downloadUrl: string, sha256: string, version: string): Promise<void>;
  /** Reloads the JavaScript side with the newest installed bundle. Native parts keep running. */
  reloadWithInstalledBundle(): void;
  /** Ends the trial of a newly installed bundle once it has started properly. */
  confirmBundleHealthy(): void;

  /**
   * JSON: { version: "1.0.12.0", architecture: "x64" | "ARM64", isPackaged: boolean,
   * bundleVersion: "built-in" | "<instant update version>" }.
   */
  getAppInfo(): Promise<string>;
  /**
   * Has Windows download and install the update at downloadUrl. Koto is closed for the
   * install and reopened afterwards, so on success this usually never resolves.
   * Rejects with a readable message if Windows refuses the update.
   */
  installUpdate(downloadUrl: string): Promise<void>;

  /**
   * pressed | released: the hotkey went down or up.
   * cancelled: Esc, or another key joined the hotkey (Ctrl + Win + D and similar).
   * toggle: the orb was clicked.
   */
  readonly onHotkey: CodegenTypes.EventEmitter<string>;
  /** Payload: base64 encoded PCM16LE, 16 kHz, mono. */
  readonly onAudioFrame: CodegenTypes.EventEmitter<string>;
  /** Payload: a short description of a capture failure. Capture has stopped. */
  readonly onRecordingError: CodegenTypes.EventEmitter<string>;
  /** Payload: neutral | casual | formal, picked from the tray menu or the orb's right-click menu. */
  readonly onWritingStyleChange: CodegenTypes.EventEmitter<string>;
  /** A microphone id ('' = Windows default) picked from the tray or orb menu. */
  readonly onMicrophoneChange: CodegenTypes.EventEmitter<string>;
  /** Microphones were connected, disconnected or the Windows default changed. Payload is ''. */
  readonly onMicrophonesChanged: CodegenTypes.EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DesktopIntegration');

import DesktopIntegration from '../native/NativeDesktopIntegration';
import { ObservableStore } from '../state/observable-store';
import { preferencesStore, updatePreferences } from '../storage/preferences';

/**
 * Which microphone Koto records from.
 *
 * The choice (preferences.microphoneId, '' = Windows default) is stored here and handed to
 * native code, which records from it while it is connected and from the Windows default
 * otherwise. The list stays current in real time: Windows reports microphones being
 * connected, disconnected or the default changing (onMicrophonesChanged), and the list is
 * read again each time.
 */
export interface Microphone {
  id: string;
  name: string;
  /** The Windows default recording device right now. */
  isDefault: boolean;
}

export interface MicrophonesState {
  /** False until the first list arrives; nothing is reported as missing before then. */
  isLoaded: boolean;
  microphones: Microphone[];
}

export const microphonesStore = new ObservableStore<MicrophonesState>({ isLoaded: false, microphones: [] });

/** One device change raises several notifications; they are read as one after this pause. */
const CHANGE_SETTLE_MS = 300;

export function parseMicrophones(json: string): Microphone[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is Microphone => typeof item?.id === 'string' && item.id !== '' && typeof item?.name === 'string')
      .map(item => ({ id: item.id, name: item.name, isDefault: item.isDefault === true }));
  } catch {
    return [];
  }
}

export async function refreshMicrophones(): Promise<Microphone[]> {
  try {
    const microphones = parseMicrophones(await DesktopIntegration.listMicrophones());
    microphonesStore.set({ isLoaded: true, microphones });
    return microphones;
  } catch {
    // Keep the last known list; a failed read is not "no microphones".
    return microphonesStore.get().microphones;
  }
}

/** True when a microphone is chosen, the list has loaded, and it is not connected. */
export function isChosenMicrophoneMissing(state = microphonesStore.get(), chosenId = preferencesStore.get().microphoneId): boolean {
  return chosenId !== '' && state.isLoaded && !state.microphones.some(microphone => microphone.id === chosenId);
}

/** Options for the microphone dropdown: the Windows default, every connected microphone, and the chosen one if it is unplugged. */
export function microphoneOptions(state: MicrophonesState, chosenId: string, chosenName: string): { value: string; label: string }[] {
  const windowsDefault = state.microphones.find(microphone => microphone.isDefault);
  const options = [
    { value: '', label: windowsDefault ? `Windows default (${windowsDefault.name})` : 'Windows default' },
    ...state.microphones.map(microphone => ({ value: microphone.id, label: microphone.name })),
  ];
  if (chosenId && !state.microphones.some(microphone => microphone.id === chosenId)) {
    options.push({ value: chosenId, label: `${chosenName || 'Chosen microphone'} (not connected)` });
  }
  return options;
}

/** Stores the choice, keeping the name so messages can mention it while it is unplugged. */
export async function chooseMicrophone(id: string): Promise<void> {
  const name = id ? (microphonesStore.get().microphones.find(microphone => microphone.id === id)?.name ?? '') : '';
  await updatePreferences({ microphoneId: id, microphoneName: name || preferencesStore.get().microphoneName });
}

/**
 * Keeps the list current, hands the choice to native code whenever it changes, and calls
 * `onChosenConnectionChange` when the chosen microphone is unplugged or plugged back in.
 */
export function startMicrophoneSync(onChosenConnectionChange: (isConnected: boolean, name: string) => void): void {
  let syncedId = preferencesStore.get().microphoneId;
  DesktopIntegration.setMicrophone(syncedId);
  preferencesStore.subscribe(() => {
    const { microphoneId } = preferencesStore.get();
    if (microphoneId !== syncedId) {
      syncedId = microphoneId;
      DesktopIntegration.setMicrophone(microphoneId);
    }
  });

  // Picked from the tray or orb menu.
  DesktopIntegration.onMicrophoneChange(id => {
    void refreshMicrophones().then(() => chooseMicrophone(id));
  });

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  DesktopIntegration.onMicrophonesChanged(() => {
    if (settleTimer) {
      clearTimeout(settleTimer);
    }
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      const wasMissing = isChosenMicrophoneMissing();
      const wasLoaded = microphonesStore.get().isLoaded;
      void refreshMicrophones().then(microphones => {
        const isMissing = isChosenMicrophoneMissing();
        if (!wasLoaded || wasMissing === isMissing) {
          return;
        }
        const { microphoneId, microphoneName } = preferencesStore.get();
        const name = microphones.find(microphone => microphone.id === microphoneId)?.name ?? microphoneName ?? '';
        if (!isMissing && name && name !== microphoneName) {
          // Windows may rename a device; keep the stored name current.
          void updatePreferences({ microphoneName: name });
        }
        onChosenConnectionChange(!isMissing, name || 'Your microphone');
      });
    }, CHANGE_SETTLE_MS);
  });

  void refreshMicrophones();
}

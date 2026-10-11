type Listener = (payload: string) => void;
const mockListeners: Record<string, Listener> = {};
let mockDevices = '[]';
const mockNative = {
  listMicrophones: jest.fn(async () => mockDevices),
  setMicrophone: jest.fn(),
  writeDocument: jest.fn(async () => undefined),
  setLaunchAtLogin: jest.fn(async () => undefined),
  onMicrophoneChange: (listener: Listener) => (mockListeners.picked = listener),
  onMicrophonesChanged: (listener: Listener) => (mockListeners.changed = listener),
};
jest.mock('../src/native/NativeDesktopIntegration', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));

import {
  chooseMicrophone,
  isChosenMicrophoneMissing,
  microphoneOptions,
  microphonesStore,
  parseMicrophones,
  refreshMicrophones,
  startMicrophoneSync,
} from '../src/audio/microphones';
import { DEFAULT_PREFERENCES, preferencesStore } from '../src/storage/preferences';

const LAPTOP = { id: '{0.0.1.00000000}.{laptop}', name: 'Microphone Array (Realtek)', isDefault: true };
const RODE = { id: '{0.0.1.00000000}.{rode}', name: 'RØDE NT-USB "Studio"', isDefault: false };
const devices = (...list: object[]) => JSON.stringify(list);

const onConnectionChange = jest.fn();

beforeAll(() => {
  startMicrophoneSync(onConnectionChange);
});

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useRealTimers();
  preferencesStore.set({ ...DEFAULT_PREFERENCES });
  mockDevices = devices(LAPTOP, RODE);
  await refreshMicrophones();
});

it('reads the device list, ignoring malformed entries', () => {
  expect(parseMicrophones(devices(LAPTOP, { id: '', name: 'x' }, { name: 'no id' }, RODE))).toEqual([LAPTOP, RODE]);
  expect(parseMicrophones('not json')).toEqual([]);
});

it('remembers the choice and its name, and hands it to native code', async () => {
  await chooseMicrophone(RODE.id);
  expect(preferencesStore.get()).toMatchObject({ microphoneId: RODE.id, microphoneName: RODE.name });
  expect(mockNative.setMicrophone).toHaveBeenLastCalledWith(RODE.id);
  await chooseMicrophone('');
  expect(mockNative.setMicrophone).toHaveBeenLastCalledWith('');
});

it('stores a microphone picked from the tray or orb menu', async () => {
  mockListeners.picked(RODE.id);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  expect(preferencesStore.get().microphoneId).toBe(RODE.id);
});

it('says when the chosen microphone is unplugged and plugged back in', async () => {
  jest.useFakeTimers();
  await chooseMicrophone(RODE.id);

  mockDevices = devices(LAPTOP);
  const readsBefore = mockNative.listMicrophones.mock.calls.length;
  // Windows raises several notifications for one change; they are read once.
  mockListeners.changed('');
  mockListeners.changed('');
  mockListeners.changed('');
  await jest.advanceTimersByTimeAsync(400);
  expect(mockNative.listMicrophones.mock.calls.length - readsBefore).toBe(1);
  expect(onConnectionChange).toHaveBeenLastCalledWith(false, RODE.name);
  expect(isChosenMicrophoneMissing()).toBe(true);

  mockDevices = devices(LAPTOP, RODE);
  mockListeners.changed('');
  await jest.advanceTimersByTimeAsync(400);
  expect(onConnectionChange).toHaveBeenLastCalledWith(true, RODE.name);
  expect(isChosenMicrophoneMissing()).toBe(false);
  // The choice is never changed by a microphone coming and going.
  expect(preferencesStore.get().microphoneId).toBe(RODE.id);
});

it('stays quiet about other microphones and when following the Windows default', async () => {
  jest.useFakeTimers();
  mockDevices = devices(LAPTOP);
  mockListeners.changed('');
  await jest.advanceTimersByTimeAsync(400);
  expect(onConnectionChange).not.toHaveBeenCalled();
});

it('does not report a microphone missing before the first list arrives', () => {
  expect(isChosenMicrophoneMissing({ isLoaded: false, microphones: [] }, RODE.id)).toBe(false);
  expect(isChosenMicrophoneMissing({ isLoaded: true, microphones: [] }, RODE.id)).toBe(true);
  expect(isChosenMicrophoneMissing({ isLoaded: true, microphones: [] }, '')).toBe(false);
});

it('lists the Windows default with its name, and keeps an unplugged choice visible', () => {
  const state = microphonesStore.get();
  expect(microphoneOptions(state, '', '')).toEqual([
    { value: '', label: `Windows default (${LAPTOP.name})` },
    { value: LAPTOP.id, label: LAPTOP.name },
    { value: RODE.id, label: RODE.name },
  ]);
  expect(microphoneOptions({ isLoaded: true, microphones: [LAPTOP] }, RODE.id, RODE.name).pop()).toEqual({
    value: RODE.id,
    label: `${RODE.name} (not connected)`,
  });
});

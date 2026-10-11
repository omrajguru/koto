import { encodeBase64 } from '../src/audio/base64';
import { SAMPLE_RATE } from '../src/audio/wave';

type Listener = (payload: string) => void;

const mockListeners: Record<string, Listener> = {};
const mockNative = {
  startHotkeyListener: jest.fn(),
  startRecording: jest.fn(async () => 'C:\\Koto\\Recordings\\17.wav'),
  // Like the real module: the final frame is emitted before stopRecording resolves.
  stopRecording: jest.fn(async () => {
    mockEmitFrames(0.2);
    return 'C:\\Koto\\Recordings\\17.wav';
  }),
  insertText: jest.fn(async () => 'pasted'),
  copyText: jest.fn(async () => undefined),
  setOverlayState: jest.fn(),
  showMainWindow: jest.fn(),
  deleteAudioFile: jest.fn(async () => undefined),
  readAudioFile: jest.fn(async () => ''),
  writeDocument: jest.fn(async () => undefined),
  readDocument: jest.fn(async () => ''),
  readSecret: jest.fn(async () => ''),
  writeSecret: jest.fn(async () => undefined),
  deleteSecret: jest.fn(async () => undefined),
  onHotkey: (listener: Listener) => (mockListeners.hotkey = listener),
  onAudioFrame: (listener: Listener) => (mockListeners.frame = listener),
  onRecordingError: (listener: Listener) => (mockListeners.error = listener),
  onWritingStyleChange: (listener: Listener) => (mockListeners.style = listener),
  setWritingStyle: jest.fn(),
  listMicrophones: jest.fn(async () => '[]'),
  setMicrophone: jest.fn(),
  onMicrophoneChange: (listener: Listener) => (mockListeners.microphone = listener),
  onMicrophonesChanged: (listener: Listener) => (mockListeners.microphones = listener),
};

jest.mock('../src/native/NativeDesktopIntegration', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));

const mockTranscribeSegment = jest.fn(async () => "Send it to John, oh sorry, it's not John, it's Ravi.");
jest.mock('../src/api/koto-api', () => {
  const actual = jest.requireActual('../src/api/koto-api');
  return { ...actual, transcribeSegment: (...args: unknown[]) => mockTranscribeSegment(...(args as [])) };
});

import { ApiError } from '../src/api/koto-api';
import { activityStore, dictationService } from '../src/dictation/dictation-service';
import { connectionStore } from '../src/storage/server-connection';
import { historyStore, loadHistory } from '../src/storage/dictation-history';

/** Emits a loud tone so the segmenter treats it as speech. */
function mockEmitFrames(seconds: number) {
  const samples = new Int16Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.round(8000 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE));
  }
  mockListeners.frame?.(encodeBase64(new Uint8Array(samples.buffer)));
}

async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  }
}

async function dictate(seconds: number) {
  mockListeners.hotkey('pressed');
  await settle();
  mockEmitFrames(seconds);
  // Held well past the tap threshold.
  jest.setSystemTime(Date.now() + 1000);
  mockListeners.hotkey('released');
  await settle();
}

beforeAll(async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  dictationService.start();
  await loadHistory();
});

beforeEach(() => {
  jest.clearAllMocks();
  historyStore.set([]);
  connectionStore.set({ status: 'ready', connection: { serverUrl: 'https://koto.example.workers.dev', accessKey: 'access-key-0123456789', sarvamApiKey: 'sarvam-key', geminiApiKey: 'gemini-key' } });
  mockTranscribeSegment.mockImplementation(async () => "Send it to John, oh sorry, it's not John, it's Ravi.");
});

it('transcribes, formats and pastes after the hotkey is released', async () => {
  await dictate(2);
  expect(mockNative.insertText).toHaveBeenCalledWith('Send it to Ravi.');
  const [record] = historyStore.get();
  expect(record.status).toBe('inserted');
  expect(record.rawTranscript).toContain('John');
  expect(activityStore.get().phase).toBe('idle');
});

it('keeps audio that arrives after the hotkey is released', async () => {
  await dictate(1);
  // 1 s before release plus the 0.2 s final frame delivered while stopping.
  expect(historyStore.get()[0].durationSeconds).toBeCloseTo(1.2, 1);
});

async function doubleTap() {
  mockListeners.hotkey('pressed');
  mockListeners.hotkey('released');
  await settle();
  jest.advanceTimersByTime(150);
  mockListeners.hotkey('pressed');
  mockListeners.hotkey('released');
  await settle();
}

it('starts hands-free on a double tap and finishes on the next press', async () => {
  await doubleTap();
  expect(activityStore.get().phase).toBe('handsFree');
  mockEmitFrames(2);
  mockListeners.hotkey('pressed');
  await settle();
  expect(mockNative.insertText).toHaveBeenCalledTimes(1);
  expect(mockNative.startRecording).toHaveBeenCalledTimes(1);
});

it('ignores a single tap', async () => {
  mockListeners.hotkey('pressed');
  mockListeners.hotkey('released');
  await settle();
  expect(activityStore.get().phase).toBe('awaitingSecondTap');
  jest.advanceTimersByTime(500);
  await settle();
  expect(activityStore.get().phase).toBe('idle');
  expect(mockTranscribeSegment).not.toHaveBeenCalled();
  expect(historyStore.get()).toHaveLength(0);
  expect(mockNative.deleteAudioFile).toHaveBeenCalled();
});

it('finishes hands-free dictation when the orb is clicked', async () => {
  await doubleTap();
  mockEmitFrames(2);
  mockListeners.hotkey('toggle');
  await settle();
  expect(mockNative.insertText).toHaveBeenCalledTimes(1);
});

it('saves the recording for retry when transcription fails', async () => {
  mockTranscribeSegment.mockImplementation(async () => {
    throw new ApiError('Bad request.', 400, 'bad_request');
  });
  await dictate(2);
  const [record] = historyStore.get();
  expect(record.status).toBe('failed');
  expect(record.audioPath).toContain('17.wav');
  expect(mockNative.insertText).not.toHaveBeenCalled();
  expect(mockNative.deleteAudioFile).not.toHaveBeenCalled();
});

it('records before a server is connected and asks for settings', async () => {
  connectionStore.set({ status: 'notSetUp' });
  await dictate(2);
  const [record] = historyStore.get();
  expect(record.status).toBe('failed');
  expect(record.failureReason).toMatch(/koto settings/i);
  expect(mockNative.showMainWindow).toHaveBeenCalled();
});

it('marks text left on the clipboard when pasting was unsafe', async () => {
  mockNative.insertText.mockResolvedValueOnce('copied');
  await dictate(2);
  expect(historyStore.get()[0].status).toBe('copied');
  expect(mockNative.setOverlayState).toHaveBeenCalledWith('notice', expect.stringMatching(/clipboard/i));
});

it('copies instead when pasting throws', async () => {
  mockNative.insertText.mockRejectedValueOnce(new Error('Clipboard busy'));
  await dictate(2);
  expect(mockNative.copyText).toHaveBeenCalledWith('Send it to Ravi.');
  expect(historyStore.get()[0].status).toBe('copied');
});

it('does not send silence', async () => {
  mockNative.stopRecording.mockImplementationOnce(async () => 'C:\\Koto\\Recordings\\17.wav');
  mockListeners.hotkey('pressed');
  await settle();
  mockListeners.frame(encodeBase64(new Uint8Array(SAMPLE_RATE * 2 * 2)));
  jest.setSystemTime(Date.now() + 1000);
  mockListeners.hotkey('released');
  await settle();
  expect(mockTranscribeSegment).not.toHaveBeenCalled();
  expect(historyStore.get()[0].status).toBe('empty');
});

it('discards a short cancelled recording and keeps a long one', async () => {
  mockListeners.hotkey('pressed');
  await settle();
  mockEmitFrames(0.5);
  mockListeners.hotkey('cancelled');
  await settle();
  expect(historyStore.get()).toHaveLength(0);
  expect(mockNative.deleteAudioFile).toHaveBeenCalled();

  mockListeners.hotkey('pressed');
  await settle();
  mockEmitFrames(3);
  mockListeners.hotkey('cancelled');
  await settle();
  expect(historyStore.get()[0].failureReason).toMatch(/cancelled/i);
  expect(mockNative.insertText).not.toHaveBeenCalled();
});

it('applies a writing style picked from the orb during the dictation', async () => {
  mockListeners.hotkey('pressed');
  await settle();
  mockEmitFrames(2);
  mockListeners.style('casual');
  await settle();
  // The orb shows the style while recording.
  expect(mockNative.setOverlayState).toHaveBeenCalledWith('listening', 'Casual');
  jest.setSystemTime(Date.now() + 1000);
  mockListeners.hotkey('released');
  await settle();
  // Casual drops the full stop of a short one-sentence message.
  expect(mockNative.insertText).toHaveBeenCalledWith('Send it to Ravi');
  mockListeners.style('neutral');
  await settle();
});

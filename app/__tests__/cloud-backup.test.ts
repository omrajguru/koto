const mockListBackup = jest.fn();
const mockUploadBackupPart = jest.fn();
const mockCreateBackupArchive = jest.fn();
jest.mock('../src/api/koto-api', () => {
  const actual = jest.requireActual('../src/api/koto-api');
  return {
    ...actual,
    listBackup: (...args: unknown[]) => mockListBackup(...args),
    uploadBackupPart: (...args: unknown[]) => mockUploadBackupPart(...args),
    createBackupArchive: (...args: unknown[]) => mockCreateBackupArchive(...args),
  };
});

const mockNative = {
  readAudioFile: jest.fn(async (path: string) => (path.includes('big') ? 'A'.repeat(9_000_000) : 'UklGRg==')),
  readDocument: jest.fn(async (name: string) => (name === 'history.json' ? '[{"text":"कल meeting"}]' : '')),
  writeDocument: jest.fn(async () => undefined),
  copyText: jest.fn(async () => undefined),
  onHotkey: jest.fn(),
  onAudioFrame: jest.fn(),
  onRecordingError: jest.fn(),
};
jest.mock('../src/native/NativeDesktopIntegration', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));

const mockOpenURL = jest.fn(async () => undefined);
jest.mock('react-native', () => ({ Linking: { openURL: (...args: unknown[]) => mockOpenURL(...(args as [])) } }));

import { ApiError } from '../src/api/koto-api';
import { decodeBase64, encodeBase64 } from '../src/audio/base64';
import { backUpToCloud, backupStore, downloadBackup, utf8Bytes } from '../src/backup/cloud-backup';
import { activityStore } from '../src/dictation/dictation-service';
import { connectionStore } from '../src/storage/server-connection';
import { type DictationRecord, historyStore } from '../src/storage/dictation-history';

const FOLDER = 'C:\\Users\\ravi\\Documents\\Koto\\Voice notes';

function note(name: string, status: DictationRecord['status'] = 'inserted', minute = 0): DictationRecord {
  return {
    id: name,
    createdAt: new Date(Date.UTC(2026, 9, 17, 17, minute)).toISOString(),
    durationSeconds: 3,
    status,
    text: 'Hello.',
    rawTranscript: 'Hello.',
    audioPath: `${FOLDER}\\${name}`,
  };
}

const LISTING = { files: [{ name: 'in-cloud.wav', size: 10 }], usedBytes: 10, quotaBytes: 2 * 1024 ** 3 };

beforeEach(() => {
  jest.clearAllMocks();
  backupStore.set({ phase: 'idle', done: 0, total: 0 });
  activityStore.set({ phase: 'idle', processingCount: 0 });
  connectionStore.set({ status: 'ready', connection: { serverUrl: 'https://koto.example.workers.dev', accessKey: 'access-key-0123456789', sarvamApiKey: 'sarvam-key', geminiApiKey: 'gemini-key' } });
  mockListBackup.mockResolvedValue(LISTING);
  mockUploadBackupPart.mockResolvedValue(undefined);
  historyStore.set([
    note('new-2.wav', 'copied', 2),
    note('in-cloud.wav', 'inserted', 1),
    note('recording.wav', 'transcribing', 3),
    note('new-1.wav', 'failed', 0),
  ]);
});

it('uploads only voice notes missing from the cloud, oldest first, then history and settings', async () => {
  await backUpToCloud();
  const names = mockUploadBackupPart.mock.calls.map(([input]) => input.name);
  expect(names).toEqual(['new-1.wav', 'new-2.wav', 'history.json']);
  expect(backupStore.get()).toMatchObject({ phase: 'idle', isError: false, usedBytes: 10 });
  expect(backupStore.get().message).toMatch(/Backed up 2 voice notes/);
  expect(mockNative.writeDocument).toHaveBeenCalledWith('backup.json', expect.stringContaining('lastBackedUpAt'));
});

it('sends large voice notes in parts the server accepts', async () => {
  historyStore.set([note('big.wav')]);
  await backUpToCloud();
  const parts = mockUploadBackupPart.mock.calls.map(([input]) => input).filter(input => input.name === 'big.wav');
  // 9,000,000 characters in parts of at most 1,000,000.
  expect(parts.map(part => [part.part, part.parts])).toEqual(Array.from({ length: 9 }, (_, index) => [index, 9]));
  expect(parts.every(part => part.data.length <= 1_000_000 && part.uploadId === parts[0].uploadId)).toBe(true);
});

it('waits while a dictation is in progress', async () => {
  activityStore.set({ phase: 'listening', processingCount: 0 });
  const running = backUpToCloud();
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  expect(mockUploadBackupPart).not.toHaveBeenCalled();
  activityStore.set({ phase: 'idle', processingCount: 0 });
  await running;
  expect(mockUploadBackupPart).toHaveBeenCalled();
});

it('retries a dropped connection, then carries on', async () => {
  jest.useFakeTimers();
  mockUploadBackupPart.mockRejectedValueOnce(new ApiError('Unable to reach Koto.', 0, 'network'));
  const running = backUpToCloud();
  await jest.advanceTimersByTimeAsync(5000);
  await running;
  jest.useRealTimers();
  expect(backupStore.get().isError).toBe(false);
  expect(mockUploadBackupPart.mock.calls.filter(([input]) => input.name === 'new-1.wav')).toHaveLength(2);
});

it('stops when the cloud backup is full and says what was saved', async () => {
  mockUploadBackupPart
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new ApiError('Your cloud backup is full (2 GB). Older voice notes stay on this PC.', 413, 'backup_failed'));
  await backUpToCloud();
  expect(backupStore.get()).toMatchObject({ phase: 'idle', isError: true });
  expect(backupStore.get().message).toMatch(/full \(2 GB\).*1 voice notes were backed up/);
  expect(mockUploadBackupPart).toHaveBeenCalledTimes(2);
});

it('runs one backup at a time', async () => {
  const first = backUpToCloud();
  const second = backUpToCloud();
  await Promise.all([first, second]);
  expect(mockListBackup).toHaveBeenCalledTimes(2); // Once before uploading, once for usage afterwards.
});

it('asks for server settings instead of uploading when none are saved', async () => {
  connectionStore.set({ status: 'notSetUp' });
  await backUpToCloud();
  expect(mockListBackup).not.toHaveBeenCalled();
  expect(backupStore.get()).toMatchObject({ message: 'Connect your server in Settings to back up.', isError: true });
});

it('opens the zip link in the browser, or puts it on the clipboard', async () => {
  mockCreateBackupArchive.mockResolvedValue({ downloadUrl: 'https://example.com/zip', fileCount: 3, bytes: 5 * 1024 * 1024, expiresAt: '' });
  await downloadBackup();
  expect(mockOpenURL).toHaveBeenCalledWith('https://example.com/zip');
  expect(backupStore.get().message).toBe('Downloading 3 files (5.0 MB) in your browser.');

  mockOpenURL.mockRejectedValueOnce(new Error('No browser'));
  await downloadBackup();
  expect(mockNative.copyText).toHaveBeenCalledWith('https://example.com/zip');
  expect(backupStore.get().message).toMatch(/clipboard/);
});

it('encodes history with Indian scripts as UTF-8', () => {
  const text = 'कल meeting ✓ 😀';
  // encodeURIComponent writes UTF-8 bytes as %XX, which gives the expected bytes without Node's Buffer.
  const expected = encodeURIComponent(text)
    .split(/(%[0-9A-F]{2})/)
    .filter(Boolean)
    .flatMap(piece => (piece.startsWith('%') ? [parseInt(piece.slice(1), 16)] : Array.from(piece, character => character.charCodeAt(0))));
  const bytes = utf8Bytes(text);
  expect(Array.from(bytes)).toEqual(expected);
  // And it survives the base64 round trip used for uploads.
  const roundTrip = decodeBase64(encodeBase64(bytes));
  expect(decodeURIComponent(Array.from(roundTrip, byte => `%${byte.toString(16).padStart(2, '0')}`).join(''))).toBe(text);
});

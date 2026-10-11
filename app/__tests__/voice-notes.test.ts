const mockDeleteAudioFile = jest.fn(async () => undefined);
jest.mock('../src/native/NativeDesktopIntegration', () => ({
  __esModule: true,
  default: {
    deleteAudioFile: (...args: unknown[]) => mockDeleteAudioFile(...(args as [])),
    readDocument: jest.fn(async () => ''),
    writeDocument: jest.fn(async () => undefined),
  },
}));

import { type DictationRecord, historyStore, loadHistory, pruneDeliveredAudio } from '../src/storage/dictation-history';
import { DEFAULT_PREFERENCES, preferencesStore } from '../src/storage/preferences';

const NOW = Date.parse('2026-10-17T17:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function record(id: string, ageDays: number, status: DictationRecord['status']): DictationRecord {
  return {
    id,
    createdAt: new Date(NOW - ageDays * DAY).toISOString(),
    durationSeconds: 4,
    status,
    text: 'Send the invite to Ravi.',
    rawTranscript: 'Send the invite to Ravi.',
    audioPath: `C:\\Users\\ravi\\Documents\\Koto\\Voice notes\\${id}.wav`,
  };
}

beforeAll(async () => {
  await loadHistory();
});

beforeEach(() => {
  jest.clearAllMocks();
  historyStore.set([record('old-delivered', 40, 'inserted'), record('recent-delivered', 3, 'copied'), record('old-failed', 40, 'failed')]);
});

it('keeps every voice note by default', async () => {
  preferencesStore.set({ ...DEFAULT_PREFERENCES });
  await pruneDeliveredAudio(NOW);
  expect(mockDeleteAudioFile).not.toHaveBeenCalled();
  expect(historyStore.get().every(entry => entry.audioPath)).toBe(true);
});

it('deletes delivered voice notes older than the chosen period, never failed ones', async () => {
  preferencesStore.set({ ...DEFAULT_PREFERENCES, voiceNoteRetention: 'week' });
  await pruneDeliveredAudio(NOW);
  expect(mockDeleteAudioFile).toHaveBeenCalledTimes(1);
  const byId = Object.fromEntries(historyStore.get().map(entry => [entry.id, entry.audioPath]));
  expect(byId['old-delivered']).toBe('');
  expect(byId['recent-delivered']).not.toBe('');
  expect(byId['old-failed']).not.toBe('');
});

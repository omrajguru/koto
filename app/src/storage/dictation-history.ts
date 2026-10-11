import DesktopIntegration from '../native/NativeDesktopIntegration';
import { ObservableStore } from '../state/observable-store';
import { preferencesStore, type VoiceNoteRetention } from './preferences';

export type DictationStatus =
  /** Audio saved; transcription in progress. */
  | 'transcribing'
  /** Pasted into the focused app. */
  | 'inserted'
  /** Left on the clipboard because pasting was unsafe or failed. */
  | 'copied'
  /** Transcribed in the background once the server is connected; kept in history only. */
  | 'saved'
  /** Transcription failed. The recording is kept so it can be retried. */
  | 'failed'
  /** The recording contained no speech. */
  | 'empty';

export interface DictationRecord {
  id: string;
  createdAt: string;
  durationSeconds: number;
  status: DictationStatus;
  /** Formatted text, as inserted. */
  text: string;
  /** Saaras output before formatting, kept so formatting mistakes are recoverable. */
  rawTranscript: string;
  /** The rule-based text, kept when AI polish replaced it. */
  unpolishedText?: string;
  audioPath: string;
  failureReason?: string;
}

const DOCUMENT_NAME = 'history.json';
const MAX_RECORDS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Voice notes whose text was delivered are deleted after this long. Failed ones are kept until retried or removed. */
const RETENTION_MS: Record<VoiceNoteRetention, number> = {
  forever: Number.POSITIVE_INFINITY,
  month: 30 * DAY_MS,
  week: 7 * DAY_MS,
  day: DAY_MS,
};

export const historyStore = new ObservableStore<DictationRecord[]>([]);

let markHistoryLoaded: () => void = () => undefined;
/** Writing before the stored history is read would replace it, so writes wait for this. */
const historyLoaded = new Promise<void>(resolve => {
  markHistoryLoaded = resolve;
});
let writeQueue: Promise<void> = historyLoaded;

/** Writes are serialised, and each writes the latest state, so a slow write never overwrites a newer one. */
function persist(): Promise<void> {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => DesktopIntegration.writeDocument(DOCUMENT_NAME, JSON.stringify(historyStore.get())));
  return writeQueue;
}

export async function loadHistory(): Promise<void> {
  try {
    await readStoredHistory();
  } finally {
    markHistoryLoaded();
  }
}

async function readStoredHistory(): Promise<void> {
  try {
    const stored = await DesktopIntegration.readDocument(DOCUMENT_NAME);
    if (!stored) {
      return;
    }
    const records = (JSON.parse(stored) as DictationRecord[]).map(record =>
      // Still marked transcribing means Koto quit mid-way. The audio is on disk, so offer a retry.
      record.status === 'transcribing'
        ? { ...record, status: 'failed' as const, failureReason: 'Koto closed before this finished.' }
        : record,
    );
    // A dictation may already have finished while history was loading; keep it.
    historyStore.set(current => {
      const loadedIds = new Set(records.map(record => record.id));
      return [...current.filter(record => !loadedIds.has(record.id)), ...records]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, MAX_RECORDS);
    });
  } catch (error) {
    console.warn('History could not be read.', error);
  }
}

export async function saveRecord(record: DictationRecord): Promise<void> {
  historyStore.set(records => {
    const others = records.filter(existing => existing.id !== record.id);
    return [record, ...others].slice(0, MAX_RECORDS);
  });
  await persist();
}

export async function updateRecord(id: string, change: Partial<DictationRecord>): Promise<DictationRecord | undefined> {
  let updated: DictationRecord | undefined;
  historyStore.set(records =>
    records.map(record => {
      if (record.id !== id) {
        return record;
      }
      updated = { ...record, ...change };
      return updated;
    }),
  );
  await persist();
  return updated;
}

export async function removeRecord(id: string): Promise<void> {
  const record = historyStore.get().find(existing => existing.id === id);
  historyStore.set(records => records.filter(existing => existing.id !== id));
  await persist();
  if (record?.audioPath) {
    await DesktopIntegration.deleteAudioFile(record.audioPath).catch(() => undefined);
  }
}

/** Deletes voice notes of delivered dictations older than the chosen retention. Text stays in history. */
export async function pruneDeliveredAudio(now = Date.now()): Promise<void> {
  const retentionMs = RETENTION_MS[preferencesStore.get().voiceNoteRetention] ?? RETENTION_MS.forever;
  if (!Number.isFinite(retentionMs)) {
    return;
  }
  const expired = historyStore
    .get()
    .filter(
      record =>
        record.audioPath &&
        (record.status === 'inserted' || record.status === 'copied' || record.status === 'saved' || record.status === 'empty') &&
        now - Date.parse(record.createdAt) > retentionMs,
    );
  if (expired.length === 0) {
    return;
  }
  for (const record of expired) {
    await DesktopIntegration.deleteAudioFile(record.audioPath).catch(() => undefined);
  }
  const expiredIds = new Set(expired.map(record => record.id));
  historyStore.set(records => records.map(record => (expiredIds.has(record.id) ? { ...record, audioPath: '' } : record)));
  await persist();
}

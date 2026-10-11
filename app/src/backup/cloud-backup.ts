import { Linking } from 'react-native';
import {
  ApiError,
  BACKUP_PART_BASE64,
  type BackupListing,
  createBackupArchive,
  listBackup,
  uploadBackupPart,
} from '../api/koto-api';
import { encodeBase64 } from '../audio/base64';
import { activityStore } from '../dictation/dictation-service';
import DesktopIntegration from '../native/NativeDesktopIntegration';
import { currentConnection, type ServerConnection } from '../storage/server-connection';
import { historyStore } from '../storage/dictation-history';
import { ObservableStore } from '../state/observable-store';

/**
 * Backs up voice notes, history and settings to the R2 bucket of the person's own Koto
 * server, and downloads everything as one zip.
 *
 * - Runs in the background: the window can be closed while it works.
 * - Dictation comes first: uploading waits while a dictation is recorded or processed.
 * - Resumable: files already in the cloud are skipped, so an interrupted backup continues.
 * - Backup only adds and updates. Deleting a voice note here, or the local retention
 *   setting, never deletes the cloud copy.
 */

/** Koto's own files that are worth keeping; the server settings and keys are in Credential Manager, not here. */
const DATA_DOCUMENTS = ['history.json', 'preferences.json'];
const STATE_DOCUMENT = 'backup.json';
const RETRY_DELAYS_MS = [1000, 4000];

export interface BackupState {
  phase: 'idle' | 'backingUp' | 'preparingDownload';
  done: number;
  total: number;
  /** Outcome of the last action, shown in Settings. */
  message?: string;
  isError?: boolean;
  lastBackedUpAt?: string;
  usedBytes?: number;
  quotaBytes?: number;
}

export const backupStore = new ObservableStore<BackupState>({ phase: 'idle', done: 0, total: 0 });

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** File name of a recording path, as stored in the cloud. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? '';
}

/** UTF-8 without TextEncoder, which not every Hermes build has. */
export function utf8Bytes(text: string): Uint8Array {
  /* eslint-disable no-bitwise -- UTF-8 encoding */
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
  }
  /* eslint-enable no-bitwise */
  return Uint8Array.from(bytes);
}

function uploadId(): string {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let index = 0; index < 16; index += 1) {
    id += characters[Math.floor(Math.random() * characters.length)];
  }
  return id;
}

/** Resolves once no dictation is being recorded or processed. */
function dictationIdle(): Promise<void> {
  const isIdle = () => {
    const { phase, processingCount } = activityStore.get();
    return phase === 'idle' && processingCount === 0;
  };
  if (isIdle()) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const unsubscribe = activityStore.subscribe(() => {
      if (isIdle()) {
        unsubscribe();
        resolve();
      }
    });
  });
}

/** Voice notes in history that are finished and not yet in the cloud, oldest first. */
export function voiceNotesToBackUp(listing: BackupListing): { name: string; path: string }[] {
  const inCloud = new Set(listing.files.map(file => file.name));
  const seen = new Set<string>();
  return historyStore
    .get()
    .filter(record => record.audioPath && record.status !== 'transcribing')
    .map(record => ({ name: fileNameOf(record.audioPath), path: record.audioPath }))
    .filter(({ name }) => {
      if (!/\.wav$/i.test(name) || inCloud.has(name) || seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    })
    .reverse();
}

class StopBackup extends Error {}

function describeFailure(error: unknown): { message: string; shouldStop: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return { message: error.message, shouldStop: true };
    }
    if (error.status === 413 || error.code === 'backup_not_configured') {
      return { message: error.message, shouldStop: true };
    }
    return { message: error.message, shouldStop: !error.isTransient };
  }
  return { message: error instanceof Error ? error.message : 'The backup could not finish.', shouldStop: true };
}

async function uploadFile(connection: ServerConnection, name: string, base64: string): Promise<void> {
  const parts = Math.max(1, Math.ceil(base64.length / BACKUP_PART_BASE64));
  const id = uploadId();
  for (let part = 0; part < parts; part += 1) {
    const data = base64.slice(part * BACKUP_PART_BASE64, (part + 1) * BACKUP_PART_BASE64);
    for (let attempt = 0; ; attempt += 1) {
      // Dictation first: never compete with a recording or its transcription for the network.
      await dictationIdle();
      try {
        await uploadBackupPart({ connection, name, uploadId: id, part, parts, data });
        break;
      } catch (error) {
        const failure = describeFailure(error);
        if (failure.shouldStop || attempt >= RETRY_DELAYS_MS.length) {
          throw new StopBackup(failure.message);
        }
        await wait(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
}

function setUsage(listing: BackupListing): void {
  backupStore.set(current => ({ ...current, usedBytes: listing.usedBytes, quotaBytes: listing.quotaBytes }));
}

export async function loadBackupState(): Promise<void> {
  try {
    const stored = await DesktopIntegration.readDocument(STATE_DOCUMENT);
    if (stored) {
      const parsed = JSON.parse(stored) as { lastBackedUpAt?: string };
      backupStore.set(current => ({ ...current, lastBackedUpAt: parsed.lastBackedUpAt }));
    }
  } catch {
    // A missing or damaged record only hides the last backup time.
  }
}

/** Uploads everything not yet in the cloud. Safe to call again while running: it does nothing. */
export async function backUpToCloud(): Promise<void> {
  if (backupStore.get().phase !== 'idle') {
    return;
  }
  const connection = currentConnection();
  if (!connection) {
    backupStore.set(current => ({ ...current, message: 'Connect your server in Settings to back up.', isError: true }));
    return;
  }
  backupStore.set(current => ({ ...current, phase: 'backingUp', done: 0, total: 0, message: undefined, isError: false }));
  let uploadedNotes = 0;
  try {
    const listing = await listBackup(connection);
    setUsage(listing);
    const notes = voiceNotesToBackUp(listing);
    const total = notes.length + DATA_DOCUMENTS.length;
    backupStore.set(current => ({ ...current, total }));
    for (const note of notes) {
      await dictationIdle();
      let audio: string;
      try {
        audio = await DesktopIntegration.readAudioFile(note.path);
      } catch {
        // Deleted from the folder by hand: nothing to back up for this one.
        backupStore.set(current => ({ ...current, done: current.done + 1 }));
        continue;
      }
      await uploadFile(connection, note.name, audio);
      uploadedNotes += 1;
      backupStore.set(current => ({ ...current, done: current.done + 1 }));
    }
    // Last, so the history in the cloud describes the voice notes already there.
    for (const name of DATA_DOCUMENTS) {
      const contents = await DesktopIntegration.readDocument(name).catch(() => '');
      if (contents) {
        await uploadFile(connection, name, encodeBase64(utf8Bytes(contents)));
      }
      backupStore.set(current => ({ ...current, done: current.done + 1 }));
    }
    const lastBackedUpAt = new Date().toISOString();
    await DesktopIntegration.writeDocument(STATE_DOCUMENT, JSON.stringify({ lastBackedUpAt })).catch(() => undefined);
    setUsage(await listBackup(connection).catch(() => listing));
    backupStore.set(current => ({
      ...current,
      lastBackedUpAt,
      message:
        uploadedNotes === 0
          ? 'All voice notes were already backed up. History and settings are up to date.'
          : `Backed up ${uploadedNotes} voice ${uploadedNotes === 1 ? 'note' : 'notes'}, history and settings.`,
      isError: false,
    }));
  } catch (error) {
    const message =
      error instanceof StopBackup ? error.message : describeFailure(error).message;
    backupStore.set(current => ({
      ...current,
      message: uploadedNotes > 0 ? `${message} ${uploadedNotes} voice notes were backed up; back up again to continue.` : message,
      isError: true,
    }));
  } finally {
    backupStore.set(current => ({ ...current, phase: 'idle' }));
  }
}

/** Opens a download link for a zip of everything in the cloud in the browser. */
export async function downloadBackup(): Promise<void> {
  if (backupStore.get().phase !== 'idle') {
    return;
  }
  const connection = currentConnection();
  if (!connection) {
    backupStore.set(current => ({ ...current, message: 'Connect your server in Settings to download your backup.', isError: true }));
    return;
  }
  backupStore.set(current => ({ ...current, phase: 'preparingDownload', message: undefined, isError: false }));
  try {
    const archive = await createBackupArchive(connection);
    const size = `${(archive.bytes / (1024 * 1024)).toFixed(1)} MB`;
    try {
      await Linking.openURL(archive.downloadUrl);
      backupStore.set(current => ({
        ...current,
        message: `Downloading ${archive.fileCount} files (${size}) in your browser.`,
        isError: false,
      }));
    } catch {
      // No browser opened: the link is still usable for 30 minutes.
      await DesktopIntegration.copyText(archive.downloadUrl).catch(() => undefined);
      backupStore.set(current => ({
        ...current,
        message: `The download link (${size}) is on your clipboard. Paste it into a browser within 30 minutes.`,
        isError: false,
      }));
    }
  } catch (error) {
    backupStore.set(current => ({ ...current, message: describeFailure(error).message, isError: true }));
  } finally {
    backupStore.set(current => ({ ...current, phase: 'idle' }));
  }
}

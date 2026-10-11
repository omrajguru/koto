import { crc32, directory, localHeader, type ZipEntry, zipSize } from './zip.ts';

/**
 * Cloud backup of voice notes and history in the deployment's own R2 bucket.
 *
 * - `files/<name>`: the backed-up file, with its CRC-32 in custom metadata so the zip
 *   download can stream it without reading it twice.
 * - `parts/<upload id>/<part>`: a file arriving in parts of at most MAX_PART_BASE64
 *   characters. Each part records the running CRC-32 and byte count, so finishing a file
 *   needs one read per part and nothing else. The last part joins them into `files/<name>`
 *   and deletes them; a half-uploaded file never appears.
 *
 * Sizes are chosen for the Workers Free plan: a part is small enough to checksum in a few
 * milliseconds of CPU, and a request stays under 1,000 R2 operations.
 */
export const MAX_PART_BASE64 = 1_000_000;
const MAX_PARTS = 900;
/** Bytes a part decodes to at most. */
const PART_BYTES = (MAX_PART_BASE64 / 4) * 3;
/** A zip without ZIP64 must stay under 4 GB; this leaves room for headers. */
export const BACKUP_QUOTA_BYTES = 3 * 1024 * 1024 * 1024;
/** Files per zip, so one download stays under the Free plan's 1,000 R2 operations. */
export const FILES_PER_ZIP = 900;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}\.(?:wav|json)$/;
const UPLOAD_ID = /^[A-Za-z0-9]{16}$/;

export class BackupRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export interface BackedUpFile {
  name: string;
  size: number;
  crc?: number;
  uploaded: Date;
}

export function isBackupFileName(name: unknown): name is string {
  return typeof name === 'string' && FILE_NAME.test(name) && !name.includes('..');
}

function partKey(uploadId: string, part: number): string {
  return `parts/${uploadId}/${String(part).padStart(6, '0')}`;
}

export async function listBackedUpFiles(bucket: R2Bucket): Promise<BackedUpFile[]> {
  const files: BackedUpFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: 'files/', cursor, include: ['customMetadata'] });
    for (const object of page.objects) {
      const crc = Number(object.customMetadata?.crc32);
      files.push({
        name: object.key.slice('files/'.length),
        size: object.size,
        crc: Number.isInteger(crc) ? crc : undefined,
        uploaded: object.uploaded,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return files;
}

export interface FilePart {
  name: unknown;
  uploadId: unknown;
  part: unknown;
  parts: unknown;
  data: unknown;
}

/** Checks a part before anything is stored. */
export function validateFilePart(input: FilePart): { name: string; uploadId: string; part: number; parts: number; data: string } {
  const { name, uploadId, part, parts, data } = input;
  if (!isBackupFileName(name)) {
    throw new BackupRequestError('Only voice notes (.wav) and Koto data (.json) can be backed up.');
  }
  if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId)) {
    throw new BackupRequestError('uploadId must be 16 letters or digits.');
  }
  if (typeof parts !== 'number' || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) {
    throw new BackupRequestError('This file is too large to back up.', 413);
  }
  if (typeof part !== 'number' || !Number.isInteger(part) || part < 0 || part >= parts) {
    throw new BackupRequestError('part is out of range.');
  }
  if (typeof data !== 'string' || data.length > MAX_PART_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new BackupRequestError(`data must be base64 of at most ${MAX_PART_BASE64} characters.`);
  }
  return { name, uploadId, part, parts, data };
}

export async function storeFilePart(bucket: R2Bucket, input: FilePart): Promise<{ isComplete: boolean }> {
  const { name, uploadId, part, parts, data } = validateFilePart(input);
  let previousCrc = 0;
  let previousBytes = 0;
  if (part === 0) {
    // Checked once per file, before any of it is stored.
    const stored = (await listBackedUpFiles(bucket)).filter(file => file.name !== name).reduce((total, file) => total + file.size, 0);
    if (stored + parts * PART_BYTES > BACKUP_QUOTA_BYTES) {
      throw new BackupRequestError('Your cloud backup is full (3 GB). Older voice notes stay on this PC.', 413);
    }
  } else {
    const previous = await bucket.head(partKey(uploadId, part - 1));
    if (!previous || previous.customMetadata?.name !== name) {
      throw new BackupRequestError('Some parts of this file did not arrive. Back up again.');
    }
    previousCrc = Number(previous.customMetadata.crc32);
    previousBytes = Number(previous.customMetadata.bytes);
  }
  const bytes = new Uint8Array(Buffer.from(data, 'base64'));
  const crc = crc32(bytes, previousCrc);
  const totalBytes = previousBytes + bytes.length;
  await bucket.put(partKey(uploadId, part), bytes, {
    customMetadata: { name, crc32: String(crc), bytes: String(totalBytes) },
  });
  if (part !== parts - 1) {
    return { isComplete: false };
  }
  await joinParts(bucket, { name, uploadId, parts, crc, totalBytes });
  return { isComplete: true };
}

/** Streams the parts, in order, into one object of known length. */
async function joinParts(
  bucket: R2Bucket,
  file: { name: string; uploadId: string; parts: number; crc: number; totalBytes: number },
): Promise<void> {
  const keys = Array.from({ length: file.parts }, (_, index) => partKey(file.uploadId, index));
  const { readable, writable } = new FixedLengthStream(file.totalBytes);
  const copying = (async () => {
    for (const key of keys) {
      const object = await bucket.get(key);
      if (!object) {
        throw new BackupRequestError('Some parts of this file did not arrive. Back up again.');
      }
      // Native stream to native stream: the bytes never pass through JavaScript.
      await object.body.pipeTo(writable, { preventClose: true });
    }
    await writable.close();
  })();
  copying.catch(() => writable.abort().catch(() => undefined));
  await Promise.all([
    bucket.put(`files/${file.name}`, readable, {
      httpMetadata: { contentType: file.name.endsWith('.wav') ? 'audio/wav' : 'application/json' },
      customMetadata: { crc32: String(file.crc) },
    }),
    copying,
  ]);
  await bucket.delete(keys);
}

/** Place in the zip: voice notes in their own folder, Koto's data at the top. */
export function archivePath(name: string): string {
  return name.endsWith('.wav') ? `Voice notes/${name}` : name;
}

/** Files in each zip of the download: Koto's data in every zip, voice notes spread across them. */
export function zipVolumes(files: BackedUpFile[]): BackedUpFile[][] {
  const usable = files.filter(file => file.crc !== undefined);
  const data = usable.filter(file => !file.name.endsWith('.wav'));
  const notes = usable.filter(file => file.name.endsWith('.wav'));
  const perZip = FILES_PER_ZIP - data.length;
  const volumes: BackedUpFile[][] = [];
  for (let start = 0; start < Math.max(notes.length, 1); start += perZip) {
    volumes.push([...data, ...notes.slice(start, start + perZip)]);
  }
  return volumes;
}

function entriesOf(files: BackedUpFile[]): ZipEntry[] {
  return files.map(file => ({ path: archivePath(file.name), size: file.size, crc: file.crc ?? 0, modified: file.uploaded }));
}

/** A zip of the given files, streamed from R2 as the browser downloads it. */
export function streamZip(bucket: R2Bucket, files: BackedUpFile[]): { body: ReadableStream; size: number } {
  const entries = entriesOf(files);
  const size = zipSize(entries);
  const { readable, writable } = new FixedLengthStream(size);
  const write = async (bytes: Uint8Array) => {
    const writer = writable.getWriter();
    await writer.write(bytes);
    writer.releaseLock();
  };
  void (async () => {
    try {
      for (const [index, file] of files.entries()) {
        await write(localHeader(entries[index]));
        const object = await bucket.get(`files/${file.name}`);
        if (!object) {
          throw new Error(`${file.name} disappeared from the backup.`);
        }
        await object.body.pipeTo(writable, { preventClose: true });
      }
      await write(directory(entries));
      await writable.close();
    } catch (error) {
      console.error('Backup download failed', error);
      await writable.abort(error).catch(() => undefined);
    }
  })();
  return { body: readable, size };
}

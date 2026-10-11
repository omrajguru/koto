import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { archivePath, type BackedUpFile, BackupRequestError, FILES_PER_ZIP, validateFilePart, zipVolumes } from '../src/backup.ts';
import { isSameSecret, signDownload } from '../src/index.ts';
import { crc32, directory, localHeader, type ZipEntry, zipSize } from '../src/zip.ts';

const part = { name: 'Koto 2022-12-17 1700.wav', uploadId: 'abcdefgh12345678', part: 0, parts: 2, data: 'UklGRg==' };

test('crc32 matches the standard check value and continues across parts', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
  assert.equal(crc32(bytes.subarray(4), crc32(bytes.subarray(0, 4))), 0xcbf43926);
});

test('builds a zip that a standard reader opens, with the size known in advance', () => {
  const files = [
    { path: 'history.json', bytes: new TextEncoder().encode('{"records":[]}') },
    { path: 'Voice notes/नमस्ते 1.wav', bytes: new Uint8Array(1000).map((_, index) => index % 251) },
  ];
  const entries: ZipEntry[] = files.map(file => ({
    path: file.path,
    size: file.bytes.length,
    crc: crc32(file.bytes),
    modified: new Date('2022-12-17T17:00:00Z'),
  }));
  const chunks = files.flatMap((file, index) => [localHeader(entries[index]), file.bytes]);
  chunks.push(directory(entries));
  const zip = Buffer.concat(chunks);
  assert.equal(zip.length, zipSize(entries));

  const folder = mkdtempSync(join(tmpdir(), 'koto-zip-'));
  try {
    writeFileSync(join(folder, 'backup.zip'), zip);
    const script = 'import json, sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps(z.namelist()))';
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const names = JSON.parse(execFileSync(python, ['-c', script, join(folder, 'backup.zip')], { encoding: 'utf8' }));
    assert.deepEqual(names, ['history.json', 'Voice notes/नमस्ते 1.wav']);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('backup accepts only voice notes and Koto data, in valid parts', () => {
  assert.deepEqual(validateFilePart(part), part);
  assert.throws(() => validateFilePart({ ...part, name: '../secrets.wav' }), BackupRequestError);
  assert.throws(() => validateFilePart({ ...part, name: 'notes.exe' }), BackupRequestError);
  assert.throws(() => validateFilePart({ ...part, uploadId: 'short' }), BackupRequestError);
  assert.throws(() => validateFilePart({ ...part, part: 2 }), BackupRequestError);
  assert.throws(() => validateFilePart({ ...part, parts: 5000 }), /too large/);
  assert.throws(() => validateFilePart({ ...part, data: 'not base64!' }), BackupRequestError);
  assert.equal(archivePath('history.json'), 'history.json');
  assert.equal(archivePath('a.wav'), 'Voice notes/a.wav');
});

test('splits a large backup into zips that each carry the history', () => {
  const file = (name: string): BackedUpFile => ({ name, size: 10, crc: 1, uploaded: new Date() });
  const notes = Array.from({ length: FILES_PER_ZIP * 2 }, (_, index) => file(`note ${index}.wav`));
  const volumes = zipVolumes([file('history.json'), ...notes, { ...file('broken.wav'), crc: undefined }]);
  assert.equal(volumes.length, 3);
  assert.ok(volumes.every(volume => volume[0].name === 'history.json' && volume.length <= FILES_PER_ZIP));
  assert.equal(volumes.flat().filter(entry => entry.name.endsWith('.wav')).length, notes.length);
  assert.equal(zipVolumes([]).length, 1);
});

test('compares secrets exactly and signs each download separately', async () => {
  assert.equal(await isSameSecret('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(await isSameSecret('a'.repeat(32), 'a'.repeat(31) + 'b'), false);
  assert.equal(await isSameSecret('', 'a'.repeat(32)), false);
  const signature = await signDownload('key-one-0123456789', 1_800_000_000, 1);
  assert.match(signature, /^[0-9a-f]{64}$/);
  assert.notEqual(signature, await signDownload('key-one-0123456789', 1_800_000_000, 2));
  assert.notEqual(signature, await signDownload('key-two-0123456789', 1_800_000_000, 1));
});

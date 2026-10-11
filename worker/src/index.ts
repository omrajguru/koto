import {
  BACKUP_QUOTA_BYTES,
  BackupRequestError,
  listBackedUpFiles,
  storeFilePart,
  streamZip,
  zipVolumes,
} from './backup.ts';
import { MAX_POLISH_CHARACTERS, type PolishStyle, polishSafely, warmGemini } from './polish.ts';
import {
  INDIC_SCRIPTS,
  type IndicScript,
  parseKeyterms,
  SUPPORTED_LANGUAGE_CODES,
  transcribeSegment,
  TranscriptionRequestError,
  validateWaveSegment,
} from './transcription.ts';

/**
 * Koto's server, one Worker per person. It holds no API keys: the app sends the person's
 * Sarvam and Gemini keys with each request, over HTTPS, and they are used for that request
 * only. The Worker checks the access key chosen at deploy time, so nobody else can use it.
 */
export interface Env {
  /** Set when deploying (Deploy to Cloudflare asks for it). Typed into Koto's settings. */
  KOTO_ACCESS_KEY?: string;
  /** Optional: cloud backup of voice notes and history. */
  BACKUPS?: R2Bucket;
}

const MIN_ACCESS_KEY_LENGTH = 16;
const DOWNLOAD_LINK_MINUTES = 30;
const POLISH_STYLES = new Set<PolishStyle>(['neutral', 'casual', 'formal']);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return json(status, { code, message });
}

function html(status: number, title: string, message: string): Response {
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f5;font:16px/1.5 system-ui,sans-serif}main{max-width:32rem;padding:24px}h1{font-size:20px;font-weight:600;margin:0 0 8px}p{margin:0 0 12px;color:#a3a3a3}code{color:#f5f5f5}</style>
</head><body><main><h1>${title}</h1>${message}</main></body></html>`;
  return new Response(page, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' },
  });
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Compares hashes, so the time taken does not reveal how much of the key matched. */
export async function isSameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

function isSetUp(env: Env): env is Env & { KOTO_ACCESS_KEY: string } {
  return (env.KOTO_ACCESS_KEY ?? '').length >= MIN_ACCESS_KEY_LENGTH;
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && isSetUp(env) && (await isSameSecret(match[1], env.KOTO_ACCESS_KEY)));
}

async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message)));
  return [...signature].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Download links work without the access key, so they are signed and expire. */
export async function signDownload(accessKey: string, expires: number, volume: number | 'all'): Promise<string> {
  return hmac(accessKey, `backup-download:${expires}:${volume}`);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function handleTranscription(request: Request): Promise<Response> {
  const apiKey = request.headers.get('x-sarvam-api-key') ?? '';
  if (!apiKey) {
    return errorResponse(400, 'missing_sarvam_key', 'Add your Sarvam API key in Koto settings.');
  }
  // Body: { audio: base64 WAV, languageCode?: string, keyterms?: string[], script?: 'native' | 'latin' | 'mixed' }
  const body = await readJson(request);
  const languageCode = typeof body.languageCode === 'string' ? body.languageCode : 'unknown';
  if (!SUPPORTED_LANGUAGE_CODES.has(languageCode)) {
    return errorResponse(400, 'unsupported_language', `Language ${languageCode} is not supported.`);
  }
  try {
    const keyterms = parseKeyterms(body.keyterms);
    const audio = Buffer.from(typeof body.audio === 'string' ? body.audio : '', 'base64');
    validateWaveSegment(audio);
    const script = typeof body.script === 'string' && INDIC_SCRIPTS.has(body.script as IndicScript) ? (body.script as IndicScript) : 'native';
    return json(200, await transcribeSegment(audio, { apiKey, languageCode, keyterms, script }));
  } catch (error) {
    if (error instanceof TranscriptionRequestError) {
      return errorResponse(error.statusCode, error.statusCode === 401 ? 'invalid_sarvam_key' : 'transcription_failed', error.message);
    }
    throw error;
  }
}

/** Body: { text, style }. Always answers 200 with usable text; polishing is best-effort. */
async function handlePolish(request: Request): Promise<Response> {
  const apiKey = request.headers.get('x-gemini-api-key') ?? '';
  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text : '';
  const style = typeof body.style === 'string' && POLISH_STYLES.has(body.style as PolishStyle) ? (body.style as PolishStyle) : 'neutral';
  if (!text.trim() || text.length > MAX_POLISH_CHARACTERS) {
    return json(200, { text, isPolished: false, reason: 'unsupported_length' });
  }
  return json(200, await polishSafely(text, style, apiKey));
}

async function handleBackup(request: Request, env: Env & { KOTO_ACCESS_KEY: string }, action: 'list' | 'upload' | 'archive'): Promise<Response> {
  const bucket = env.BACKUPS;
  if (!bucket) {
    return errorResponse(503, 'backup_not_configured', 'Cloud backup is not set up on your Koto server. Add an R2 bucket named BACKUPS.');
  }
  try {
    if (action === 'list') {
      const files = await listBackedUpFiles(bucket);
      const usedBytes = files.reduce((total, file) => total + file.size, 0);
      return json(200, { files: files.map(({ name, size }) => ({ name, size })), usedBytes, quotaBytes: BACKUP_QUOTA_BYTES });
    }
    if (action === 'upload') {
      const body = await readJson(request);
      return json(200, await storeFilePart(bucket, { name: body.name, uploadId: body.uploadId, part: body.part, parts: body.parts, data: body.data }));
    }
    const files = await listBackedUpFiles(bucket);
    const volumes = zipVolumes(files);
    if (files.length === 0) {
      throw new BackupRequestError('Nothing has been backed up yet. Back up first.', 404);
    }
    const expires = Math.floor(Date.now() / 1000) + DOWNLOAD_LINK_MINUTES * 60;
    const volume = volumes.length === 1 ? 1 : 'all';
    const url = new URL('/v1/backup/download', request.url);
    url.searchParams.set('expires', String(expires));
    url.searchParams.set('volume', String(volume));
    url.searchParams.set('signature', await signDownload(env.KOTO_ACCESS_KEY, expires, volume));
    return json(200, {
      downloadUrl: url.toString(),
      fileCount: volumes.flat().length,
      bytes: files.reduce((total, file) => total + file.size, 0),
      expiresAt: new Date(expires * 1000).toISOString(),
    });
  } catch (error) {
    if (error instanceof BackupRequestError) {
      return errorResponse(error.statusCode, 'backup_failed', error.message);
    }
    throw error;
  }
}

/** Opened in the browser from Koto's settings. A large backup comes as several zips, listed on a page. */
async function handleDownload(url: URL, env: Env & { KOTO_ACCESS_KEY: string }): Promise<Response> {
  const expires = Number(url.searchParams.get('expires'));
  const volumeParameter = url.searchParams.get('volume') ?? '';
  const volume = volumeParameter === 'all' ? 'all' : Number(volumeParameter);
  const signature = url.searchParams.get('signature') ?? '';
  const isValid =
    Number.isInteger(expires) &&
    expires > Date.now() / 1000 &&
    (volume === 'all' || (Number.isInteger(volume) && volume >= 1)) &&
    (await isSameSecret(signature, await signDownload(env.KOTO_ACCESS_KEY, expires, volume)));
  if (!isValid || !env.BACKUPS) {
    return html(403, 'Download link expired', '<p>Start the download again from Koto: Settings, Voice notes, Download backup.</p>');
  }
  const volumes = zipVolumes(await listBackedUpFiles(env.BACKUPS));
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  if (volume === 'all') {
    const links = await Promise.all(
      volumes.map(async (_, index) => {
        const link = new URL(url);
        link.searchParams.set('volume', String(index + 1));
        link.searchParams.set('signature', await signDownload(env.KOTO_ACCESS_KEY, expires, index + 1));
        return `<p><a style="color:#f5f5f5" href="${link.toString().replace(/&/g, '&amp;')}">Part ${index + 1} of ${volumes.length}</a></p>`;
      }),
    );
    return html(200, 'Your Koto backup', `<p>Your backup is split into ${volumes.length} zips. Each has your history and settings.</p>${links.join('')}`);
  }
  const files = volumes[volume - 1];
  if (!files) {
    return html(404, 'Not found', '<p>This part of the backup does not exist. Start the download again from Koto.</p>');
  }
  const zip = streamZip(env.BACKUPS, files);
  const suffix = volumes.length > 1 ? `-part-${volume}` : '';
  return new Response(zip.body, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(zip.size),
      'content-disposition': `attachment; filename="koto-backup-${stamp}${suffix}.zip"`,
      'cache-control': 'no-store',
    },
  });
}

async function route(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const { method } = request;
  const path = url.pathname;
  if (method === 'GET' && path === '/health') {
    return json(200, { status: 'ok' });
  }
  if (method === 'GET' && path === '/') {
    return isSetUp(env)
      ? html(200, 'Your Koto server is running', `<p>In Koto, open Settings and add this address as the server:</p><p><code>${url.origin}</code></p><p>Use the access key you chose when deploying.</p>`)
      : html(503, 'Almost there', '<p>Set the <code>KOTO_ACCESS_KEY</code> secret on this Worker (at least 16 characters), then reload.</p>');
  }
  if (!isSetUp(env)) {
    return errorResponse(503, 'not_set_up', 'Your Koto server has no access key yet. Set KOTO_ACCESS_KEY in Cloudflare.');
  }
  if (method === 'GET' && path === '/v1/backup/download') {
    return handleDownload(url, env);
  }
  if (!(await isAuthorized(request, env))) {
    return errorResponse(401, 'unauthenticated', 'The access key does not match your Koto server. Check it in Koto settings.');
  }
  if (method === 'GET' && path === '/v1/status') {
    return json(200, { status: 'ok', backup: Boolean(env.BACKUPS) });
  }
  if (method === 'POST' && path === '/v1/transcriptions') {
    return handleTranscription(request);
  }
  if (method === 'POST' && path === '/v1/polish') {
    return handlePolish(request);
  }
  if (method === 'POST' && path === '/v1/polish/warm') {
    const apiKey = request.headers.get('x-gemini-api-key') ?? '';
    // Answers at once; the warm-up continues in the background.
    context.waitUntil(warmGemini(apiKey).catch(error => console.warn('Warm-up failed', error)));
    return json(200, { status: 'warm' });
  }
  if (method === 'GET' && path === '/v1/backup/files') {
    return handleBackup(request, env, 'list');
  }
  if (method === 'POST' && path === '/v1/backup/files') {
    return handleBackup(request, env, 'upload');
  }
  if (method === 'POST' && path === '/v1/backup/archives') {
    return handleBackup(request, env, 'archive');
  }
  return errorResponse(404, 'not_found', 'Not found.');
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, context);
    } catch (error) {
      console.error('Unhandled error', error);
      return errorResponse(500, 'internal_error', 'Something failed on your Koto server. Try again.');
    }
  },
} satisfies ExportedHandler<Env>;

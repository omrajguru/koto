import type { ServerConnection } from '../storage/server-connection';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  /** Worth retrying: the network failed, the server erred, or Sarvam rate limited us. */
  get isTransient(): boolean {
    if (this.code === 'not_set_up') {
      return false;
    }
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  /** The access key or an API key was not accepted; fixed in Settings, not by retrying. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

/** Sends the access key, plus only the provider key the request needs. */
function headersFor(connection: ServerConnection, provider?: 'sarvam' | 'gemini'): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${connection.accessKey}` };
  if (provider === 'sarvam') {
    headers['x-sarvam-api-key'] = connection.sarvamApiKey;
  }
  if (provider === 'gemini' && connection.geminiApiKey) {
    headers['x-gemini-api-key'] = connection.geminiApiKey;
  }
  return headers;
}

async function request<T>(
  connection: ServerConnection,
  path: string,
  init: RequestInit & { timeoutMs?: number; provider?: 'sarvam' | 'gemini' } = {},
): Promise<{ status: number; body: T }> {
  const { timeoutMs, provider, ...requestInit } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 30_000);
  let response: Response;
  try {
    response = await fetch(`${connection.serverUrl}${path}`, {
      ...requestInit,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...headersFor(connection, provider), ...(requestInit.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Unable to reach your Koto server. Check your connection and the server address.', 0, 'network');
  } finally {
    clearTimeout(timeout);
  }
  const body = (await response.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!response.ok) {
    throw new ApiError(body.message ?? `Your Koto server answered with status ${response.status}.`, response.status, body.code ?? 'error');
  }
  return { status: response.status, body };
}

export interface ServerStatus {
  status: 'ok';
  /** Whether cloud backup storage is attached to the server. */
  backup: boolean;
}

/** Confirms the address and access key before they are saved. */
export async function checkServer(connection: ServerConnection): Promise<ServerStatus> {
  const result = await request<ServerStatus>(connection, '/v1/status', { method: 'GET', timeoutMs: 15_000 });
  return result.body;
}

export async function polishText(input: {
  connection: ServerConnection;
  text: string;
  style: string;
  timeoutMs: number;
}): Promise<{ text: string; isPolished: boolean; reason?: string }> {
  const result = await request<{ text: string; isPolished: boolean; reason?: string }>(input.connection, '/v1/polish', {
    method: 'POST',
    provider: 'gemini',
    body: JSON.stringify({ text: input.text, style: input.style }),
    timeoutMs: input.timeoutMs,
  });
  return result.body;
}

export async function warmPolish(connection: ServerConnection): Promise<void> {
  await request(connection, '/v1/polish/warm', { method: 'POST', provider: 'gemini', body: '{}' });
}

export interface TranscriptionRequest {
  connection: ServerConnection;
  /** base64 WAV, 16 kHz mono PCM16, under 30 seconds. */
  audio: string;
  languageCode: string;
  keyterms: string[];
  /** How Hindi, Marathi and other Indian languages are written. English is never affected. */
  script: IndicScript;
}

export type IndicScript = 'native' | 'latin' | 'mixed';

export async function transcribeSegment(input: TranscriptionRequest): Promise<string> {
  const result = await request<{ transcript: string }>(input.connection, '/v1/transcriptions', {
    method: 'POST',
    provider: 'sarvam',
    body: JSON.stringify({ audio: input.audio, languageCode: input.languageCode, keyterms: input.keyterms, script: input.script }),
    timeoutMs: 35_000,
  });
  return result.body.transcript;
}

// Cloud backup ---------------------------------------------------------------

export interface BackupListing {
  files: { name: string; size: number }[];
  usedBytes: number;
  quotaBytes: number;
}

/** Characters of base64 per upload request; the server accepts at most 1,000,000. */
export const BACKUP_PART_BASE64 = 1_000_000;

export async function listBackup(connection: ServerConnection): Promise<BackupListing> {
  const result = await request<BackupListing>(connection, '/v1/backup/files', { method: 'GET' });
  return result.body;
}

export async function uploadBackupPart(input: {
  connection: ServerConnection;
  name: string;
  uploadId: string;
  part: number;
  parts: number;
  data: string;
}): Promise<void> {
  await request(input.connection, '/v1/backup/files', {
    method: 'POST',
    body: JSON.stringify({ name: input.name, uploadId: input.uploadId, part: input.part, parts: input.parts, data: input.data }),
    timeoutMs: 60_000,
  });
}

export interface BackupArchive {
  downloadUrl: string;
  fileCount: number;
  bytes: number;
  expiresAt: string;
}

/** A signed link to a zip of everything backed up, streamed by the server as it downloads. */
export async function createBackupArchive(connection: ServerConnection): Promise<BackupArchive> {
  const result = await request<BackupArchive>(connection, '/v1/backup/archives', { method: 'POST', body: '{}', timeoutMs: 60_000 });
  return result.body;
}

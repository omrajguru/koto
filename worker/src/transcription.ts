/**
 * Proxies one audio segment to Sarvam's Saaras v4 speech-to-text REST API.
 *
 * The REST endpoint is meant for audio under 30 seconds, so the desktop app
 * splits long dictation into segments of at most 28 seconds at pauses and
 * sends them while the person is still speaking.
 */
const SARVAM_ENDPOINT = 'https://api.sarvam.ai/speech-to-text';
export const SARVAM_MODEL = 'saaras:v4';

const SAMPLE_RATE = 16_000;
const MAX_SEGMENT_SECONDS = 30;
const WAV_HEADER_BYTES = 44;
export const MAX_SEGMENT_BYTES = WAV_HEADER_BYTES + SAMPLE_RATE * 2 * MAX_SEGMENT_SECONDS;
export const MAX_KEYTERMS = 50;
const MAX_KEYTERM_LENGTH = 64;

export const SUPPORTED_LANGUAGE_CODES = new Set([
  'unknown', 'en-IN', 'hi-IN', 'bn-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN',
  'gu-IN', 'as-IN', 'ur-IN', 'ne-IN', 'kok-IN', 'ks-IN', 'sd-IN', 'sa-IN', 'sat-IN', 'mni-IN', 'brx-IN',
  'mai-IN', 'doi-IN',
]);

export class TranscriptionRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Accepts only the format the desktop app produces: PCM WAV, 16 kHz, mono, 16-bit. */
export function validateWaveSegment(audio: Buffer): void {
  if (audio.length <= WAV_HEADER_BYTES) {
    throw new TranscriptionRequestError('Audio segment is empty.', 400);
  }
  if (audio.length > MAX_SEGMENT_BYTES) {
    throw new TranscriptionRequestError('Audio segment is longer than 30 seconds.', 413);
  }
  const isWave = audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE';
  const audioFormat = audio.readUInt16LE(20);
  const channels = audio.readUInt16LE(22);
  const sampleRate = audio.readUInt32LE(24);
  const bitsPerSample = audio.readUInt16LE(34);
  if (!isWave || audioFormat !== 1 || channels !== 1 || sampleRate !== SAMPLE_RATE || bitsPerSample !== 16) {
    throw new TranscriptionRequestError('Audio must be 16 kHz mono 16-bit PCM WAV.', 415);
  }
}

export function parseKeyterms(raw: unknown): string[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new TranscriptionRequestError('keyterms must be an array of strings.', 400);
  }
  return raw
    .filter((term): term is string => typeof term === 'string')
    .map(term => term.trim())
    .filter(term => term.length > 0 && term.length <= MAX_KEYTERM_LENGTH)
    .slice(0, MAX_KEYTERMS);
}

export interface TranscriptionResult {
  transcript: string;
  languageCode: string | null;
}

/**
 * How Indian languages are written: native (Devanagari and other scripts, Saaras's default),
 * latin ("kal meeting hai", Saaras mode "translit") or mixed (English words in English letters,
 * the rest in its own script, mode "codemix").
 */
export type IndicScript = 'native' | 'latin' | 'mixed';
export const INDIC_SCRIPTS = new Set<IndicScript>(['native', 'latin', 'mixed']);
const SARVAM_MODES: Record<IndicScript, string> = { native: 'transcribe', latin: 'translit', mixed: 'codemix' };
/** Letters of the Indian scripts Saaras writes (Devanagari through Malayalam, plus Ol Chiki and Meetei Mayek). */
const INDIC_LETTERS = /[ऀ-ൿ᱐-᱿ꯀ-꯿]/u;

/**
 * Transcribes in Saaras's default mode, which punctuates English best. Only when the
 * result contains an Indian script and another script was asked for does it ask again in
 * that mode, so English dictation is never affected and costs one request.
 */
export async function transcribeSegment(
  audio: Buffer,
  options: { apiKey: string; languageCode: string; keyterms: string[]; script?: IndicScript },
): Promise<TranscriptionResult> {
  const result = await requestTranscription(audio, options, 'transcribe');
  const script = options.script ?? 'native';
  if (script === 'native' || !INDIC_LETTERS.test(result.transcript)) {
    return result;
  }
  return requestTranscription(audio, options, SARVAM_MODES[script]);
}

async function requestTranscription(
  audio: Buffer,
  options: { apiKey: string; languageCode: string; keyterms: string[] },
  mode: string,
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'segment.wav');
  form.append('model', SARVAM_MODEL);
  form.append('language_code', options.languageCode);
  form.append('mode', mode);
  if (options.keyterms.length > 0) {
    form.append('keyterms', JSON.stringify(options.keyterms));
  }

  const response = await fetch(SARVAM_ENDPOINT, {
    method: 'POST',
    headers: { 'api-subscription-key': options.apiKey },
    body: form,
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Sarvam request failed', response.status, detail.slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new TranscriptionRequestError('Sarvam did not accept your API key. Check it in Koto settings.', 401);
    }
    if (response.status === 429) {
      throw new TranscriptionRequestError('Transcription is rate limited. Try again in a moment.', 429);
    }
    throw new TranscriptionRequestError('Transcription service returned an error.', 502);
  }
  const body = (await response.json()) as { transcript?: string; language_code?: string | null };
  return { transcript: body.transcript ?? '', languageCode: body.language_code ?? null };
}

import { holdsSpeech } from './speech-level';
import { rootMeanSquare, SAMPLE_RATE } from './wave';

/**
 * Splits a continuous recording into segments Saaras v4's REST API accepts
 * (under 30 seconds), cutting at the quietest moment so words are not split.
 *
 * Segments are released while the person is still speaking, so most of the
 * transcription work is done by the time they stop.
 */
export const SEGMENT_SEARCH_START_SECONDS = 15;
export const SEGMENT_FORCE_SECONDS = 28;
const WINDOW_SECONDS = 0.2;
const PAUSE_THRESHOLD = 0.012;
/** Windows louder than this count as speech. Quiet rooms sit well below it. */
const CHECK_INTERVAL_SAMPLES = SAMPLE_RATE / 2;

export interface AudioSegment {
  samples: Int16Array;
  /** False when the segment is silence or room noise and need not be sent. */
  containsSpeech: boolean;
}

/** Whether a segment is worth sending: adapts to quiet microphones (speech-level.ts). */
export function containsSpeech(samples: Int16Array): boolean {
  return holdsSpeech(samples);
}

/** Index of the centre of the quietest window between `from` and `to`. */
function quietestPoint(samples: Int16Array, from: number, to: number): { index: number; level: number } {
  const window = Math.floor(SAMPLE_RATE * WINDOW_SECONDS);
  const step = Math.floor(window / 2);
  let best = { index: to, level: Number.POSITIVE_INFINITY };
  for (let start = from; start + window <= to; start += step) {
    const level = rootMeanSquare(samples, start, start + window);
    if (level < best.level) {
      best = { index: start + step, level };
    }
  }
  return best;
}

export class SpeechSegmenter {
  private chunks: Int16Array[] = [];
  private length = 0;
  private samplesSinceCheck = 0;

  /** Adds captured audio. Returns any segments that are now complete. */
  push(samples: Int16Array): AudioSegment[] {
    this.chunks.push(samples);
    this.length += samples.length;
    this.samplesSinceCheck += samples.length;
    const completed: AudioSegment[] = [];
    const searchStart = SEGMENT_SEARCH_START_SECONDS * SAMPLE_RATE;
    const forceAt = SEGMENT_FORCE_SECONDS * SAMPLE_RATE;
    while (this.length >= searchStart && (this.samplesSinceCheck >= CHECK_INTERVAL_SAMPLES || this.length >= forceAt)) {
      this.samplesSinceCheck = 0;
      const buffered = this.buffered();
      const searchEnd = Math.min(buffered.length, forceAt);
      const pause = quietestPoint(buffered, searchStart, searchEnd);
      if (pause.level < PAUSE_THRESHOLD || buffered.length >= forceAt) {
        completed.push(this.cut(buffered, pause.index));
      } else {
        break;
      }
    }
    return completed;
  }

  /** Returns whatever remains once recording stops. */
  flush(): AudioSegment | undefined {
    if (this.length === 0) {
      return undefined;
    }
    const buffered = this.buffered();
    this.chunks = [];
    this.length = 0;
    return { samples: buffered, containsSpeech: containsSpeech(buffered) };
  }

  private buffered(): Int16Array {
    if (this.chunks.length === 1) {
      return this.chunks[0];
    }
    const merged = new Int16Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [merged];
    return merged;
  }

  private cut(buffered: Int16Array, index: number): AudioSegment {
    const segment = buffered.slice(0, index);
    const rest = buffered.slice(index);
    this.chunks = rest.length > 0 ? [rest] : [];
    this.length = rest.length;
    return { samples: segment, containsSpeech: containsSpeech(segment) };
  }
}

/** Splits a finished recording, used when retrying a saved recording. */
export function segmentRecording(samples: Int16Array): AudioSegment[] {
  const segmenter = new SpeechSegmenter();
  const segments: AudioSegment[] = [];
  const step = SAMPLE_RATE / 10;
  for (let offset = 0; offset < samples.length; offset += step) {
    segments.push(...segmenter.push(samples.subarray(offset, Math.min(samples.length, offset + step))));
  }
  const last = segmenter.flush();
  if (last) {
    segments.push(last);
  }
  return segments;
}

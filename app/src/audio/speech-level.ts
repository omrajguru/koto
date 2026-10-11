import { rootMeanSquare, SAMPLE_RATE } from './wave';

/**
 * Quiet speech (a laptop microphone at arm's length) is brought up to a level Saaras hears
 * clearly, and recognised as speech in the first place.
 *
 * Measured on a laptop: loud speech sat at 0.04 to 0.08 RMS (-28 to -22 dBFS), silence
 * was digital zero (the laptop's own noise suppression gates it), and a 0.02 speech
 * threshold dropped a real one-second dictation as silence.
 *
 * Only the audio sent for transcription is changed; the saved voice note stays as recorded.
 */

const WINDOW = Math.floor(SAMPLE_RATE * 0.05);
/** Loud speech is brought to about this RMS (-15 dBFS). */
const TARGET_SPEECH_RMS = 0.18;
/** At most +15.6 dB, so a nearly silent room is not turned into loud noise. */
const MAXIMUM_GAIN = 6;
/** Above this, peaks are rounded off smoothly instead of clipping... */
const LIMITER_THRESHOLD = 0.85;
/** ...and never reach full scale. */
const LIMITER_CEILING = 0.98;

/** Speech is recognised above this RMS at most (the old fixed threshold). */
const LOUD_SPEECH_RMS = 0.02;
/** ...and never below this, whatever the room. */
const QUIETEST_SPEECH_RMS = 0.008;
/** Speech is this many times louder than the room's background. */
const SPEECH_OVER_NOISE = 3;

function windowLevels(samples: Int16Array, window = WINDOW): number[] {
  const levels: number[] = [];
  for (let start = 0; start + window <= samples.length; start += window) {
    levels.push(rootMeanSquare(samples, start, start + window));
  }
  return levels;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted.length === 0 ? 0 : sorted[Math.floor(fraction * (sorted.length - 1))];
}

/** The RMS above which a window counts as speech, adapted to the background noise. */
export function speechThreshold(samples: Int16Array): number {
  const noise = percentile(windowLevels(samples).sort((a, b) => a - b), 0.1);
  return Math.min(LOUD_SPEECH_RMS, Math.max(QUIETEST_SPEECH_RMS, noise * SPEECH_OVER_NOISE));
}

/**
 * True when the audio holds speech: at least 0.2 s above the adaptive threshold (a single
 * click or bump is not speech), or any clearly loud moment.
 */
export function holdsSpeech(samples: Int16Array): boolean {
  const levels = windowLevels(samples, Math.floor(SAMPLE_RATE * 0.1));
  if (levels.some(level => level > LOUD_SPEECH_RMS)) {
    return true;
  }
  const threshold = speechThreshold(samples);
  return levels.filter(level => level > threshold).length >= 2;
}

/**
 * The gain that brings loud speech to the target level, between 1 and MAXIMUM_GAIN.
 * Measured on the windows that hold speech only: a short quiet phrase followed by
 * 15 seconds of silence must still be raised.
 */
export function speechGain(samples: Int16Array): number {
  const threshold = speechThreshold(samples);
  const voiced = windowLevels(samples)
    .filter(level => level > threshold)
    .sort((a, b) => a - b);
  const loudSpeech = percentile(voiced, 0.9);
  if (loudSpeech <= 0) {
    return 1;
  }
  return Math.min(MAXIMUM_GAIN, Math.max(1, TARGET_SPEECH_RMS / loudSpeech));
}

/** Raises quiet speech for transcription, rounding off peaks instead of clipping them. */
export function normaliseSpeech(samples: Int16Array): Int16Array {
  const gain = speechGain(samples);
  if (gain < 1.1) {
    return samples;
  }
  const output = new Int16Array(samples.length);
  const headroom = LIMITER_CEILING - LIMITER_THRESHOLD;
  for (let index = 0; index < samples.length; index += 1) {
    const value = (samples[index] / 32768) * gain;
    const magnitude = Math.abs(value);
    const limited =
      magnitude <= LIMITER_THRESHOLD ? magnitude : LIMITER_THRESHOLD + headroom * Math.tanh((magnitude - LIMITER_THRESHOLD) / headroom);
    output[index] = Math.round(Math.sign(value) * limited * 32767);
  }
  return output;
}

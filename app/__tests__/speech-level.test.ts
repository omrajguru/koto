import { holdsSpeech, normaliseSpeech, speechGain, speechThreshold } from '../src/audio/speech-level';
import { rootMeanSquare, SAMPLE_RATE } from '../src/audio/wave';

/** A tone at the given RMS for the given seconds, like steady speech at that level. */
function tone(rms: number, seconds: number): Int16Array {
  const samples = new Int16Array(Math.round(SAMPLE_RATE * seconds));
  const amplitude = rms * Math.SQRT2 * 32767;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE));
  }
  return samples;
}

function join(...parts: Int16Array[]): Int16Array {
  const output = new Int16Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

describe('quiet speech', () => {
  it('raises a distant voice, at most 6 times', () => {
    // A laptop microphone at arm's length: loud speech around 0.04 RMS.
    const distant = join(new Int16Array(SAMPLE_RATE / 2), tone(0.04, 2));
    expect(speechGain(distant)).toBeCloseTo(4.5, 1);
    expect(rootMeanSquare(normaliseSpeech(distant), SAMPLE_RATE / 2)).toBeCloseTo(0.18, 1);
    // Faint speech after silence gets the most gain; a steady hum below the speech level is room noise, left alone.
    expect(speechGain(join(new Int16Array(SAMPLE_RATE), tone(0.012, 0.5)))).toBe(6);
    expect(speechGain(tone(0.005, 1))).toBe(1);
  });

  it('raises a short quiet phrase followed by long silence', () => {
    // A streaming segment: half a second of quiet speech, then 15 s of silence.
    const sparse = join(tone(0.03, 0.5), new Int16Array(SAMPLE_RATE * 15));
    expect(speechGain(sparse)).toBe(6);
  });

  it('leaves speech that is already loud enough, and silence, untouched', () => {
    const loud = tone(0.25, 1);
    expect(normaliseSpeech(loud)).toBe(loud);
    const silence = new Int16Array(SAMPLE_RATE);
    expect(normaliseSpeech(silence)).toBe(silence);
  });

  it('rounds off peaks instead of clipping', () => {
    const output = normaliseSpeech(join(tone(0.03, 1), tone(0.6, 0.05)));
    expect(Math.max(...Array.from(output, value => Math.abs(value)))).toBeLessThan(32767);
  });
});

describe('recognising speech', () => {
  it('hears quiet speech in a silent room', () => {
    // A real one-second dictation ("Ravi.") was dropped as silence by the old fixed threshold.
    expect(holdsSpeech(join(new Int16Array(SAMPLE_RATE / 2), tone(0.012, 0.5)))).toBe(true);
  });

  it('ignores silence, steady room noise and a single click', () => {
    expect(holdsSpeech(new Int16Array(SAMPLE_RATE))).toBe(false);
    expect(holdsSpeech(tone(0.006, 2))).toBe(false);
    expect(holdsSpeech(join(new Int16Array(SAMPLE_RATE), tone(0.015, 0.1), new Int16Array(SAMPLE_RATE)))).toBe(false);
  });

  it('raises the bar in a noisy room', () => {
    const noisy = join(tone(0.006, 2), tone(0.012, 0.3));
    expect(speechThreshold(noisy)).toBeGreaterThan(0.012);
    expect(holdsSpeech(noisy)).toBe(false);
  });
});

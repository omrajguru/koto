import { decodeBase64, encodeBase64 } from '../src/audio/base64';
import { segmentRecording, SpeechSegmenter } from '../src/audio/speech-segmenter';
import { bytesToSamples, encodeWave, SAMPLE_RATE } from '../src/audio/wave';

function tone(seconds: number, amplitude = 8000): Int16Array {
  const samples = new Int16Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE));
  }
  return samples;
}

function concat(...parts: Int16Array[]): Int16Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Int16Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    for (const length of [0, 1, 2, 3, 4, 1000, 17_001]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 31) % 256);
      expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('matches Node for a known value', () => {
    const bytes = Uint8Array.from('Koto 17:00', character => character.charCodeAt(0));
    expect(encodeBase64(bytes)).toBe('S290byAxNzowMA==');
  });
});

describe('wave', () => {
  it('writes a 16 kHz mono header and round-trips samples', () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768]);
    const wave = encodeWave(samples);
    const view = new DataView(wave.buffer);
    expect(String.fromCharCode(...wave.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(Array.from(bytesToSamples(wave.slice(44)))).toEqual(Array.from(samples));
  });
});

describe('speech segmenter', () => {
  it('keeps short recordings in one segment', () => {
    const segments = segmentRecording(tone(5));
    expect(segments).toHaveLength(1);
    expect(segments[0].containsSpeech).toBe(true);
  });

  it('cuts at a pause after 15 seconds', () => {
    const recording = concat(tone(17), new Int16Array(SAMPLE_RATE / 2), tone(6));
    const segments = segmentRecording(recording);
    expect(segments).toHaveLength(2);
    const firstSeconds = segments[0].samples.length / SAMPLE_RATE;
    expect(firstSeconds).toBeGreaterThan(17);
    expect(firstSeconds).toBeLessThan(17.5);
  });

  it('never produces a segment longer than 28 seconds', () => {
    const segments = segmentRecording(tone(70));
    expect(segments.length).toBeGreaterThanOrEqual(3);
    for (const segment of segments) {
      expect(segment.samples.length / SAMPLE_RATE).toBeLessThanOrEqual(28);
    }
    const total = segments.reduce((sum, segment) => sum + segment.samples.length, 0);
    expect(total).toBe(70 * SAMPLE_RATE);
  });

  it('marks silence so it is not sent', () => {
    const segmenter = new SpeechSegmenter();
    segmenter.push(new Int16Array(SAMPLE_RATE * 2));
    expect(segmenter.flush()?.containsSpeech).toBe(false);
  });
});

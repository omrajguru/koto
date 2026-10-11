/* eslint-disable no-bitwise -- byte-level encoding */
export const SAMPLE_RATE = 16_000;

/** Wraps 16 kHz mono PCM16 samples in a 44 byte WAV header. */
export function encodeWave(samples: Int16Array): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  new Int16Array(buffer, 44).set(samples);
  return new Uint8Array(buffer);
}

/** Interprets little-endian PCM16 bytes as samples. */
export function bytesToSamples(bytes: Uint8Array): Int16Array {
  const samples = new Int16Array(Math.floor(bytes.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    const value = bytes[index * 2] | (bytes[index * 2 + 1] << 8);
    samples[index] = value >= 0x8000 ? value - 0x10000 : value;
  }
  return samples;
}

/** Root mean square level of a window, 0 to 1. */
export function rootMeanSquare(samples: Int16Array, start = 0, end = samples.length): number {
  if (end <= start) {
    return 0;
  }
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    const value = samples[index] / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / (end - start));
}

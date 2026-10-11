/* eslint-disable no-bitwise -- byte-level encoding */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let index = 0; index < ALPHABET.length; index += 1) {
  LOOKUP[ALPHABET.charCodeAt(index)] = index;
}

/** Decodes standard base64 without relying on atob, which is not available on every Hermes build. */
export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const outputLength = Math.floor((clean.length * 3) / 4);
  const output = new Uint8Array(outputLength);
  let outputIndex = 0;
  for (let index = 0; index < clean.length; index += 4) {
    const a = LOOKUP[clean.charCodeAt(index)];
    const b = LOOKUP[clean.charCodeAt(index + 1)];
    const c = LOOKUP[clean.charCodeAt(index + 2)];
    const d = LOOKUP[clean.charCodeAt(index + 3)];
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < outputLength) output[outputIndex++] = (triple >> 16) & 0xff;
    if (outputIndex < outputLength) output[outputIndex++] = (triple >> 8) & 0xff;
    if (outputIndex < outputLength) output[outputIndex++] = triple & 0xff;
  }
  return output;
}

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    chunk +=
      ALPHABET[(triple >> 18) & 63] +
      ALPHABET[(triple >> 12) & 63] +
      (index + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : '=') +
      (index + 2 < bytes.length ? ALPHABET[triple & 63] : '=');
    // Join in blocks to avoid quadratic string growth on long recordings.
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
  return parts.join('');
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInstructions, validatePolishedText } from '../src/polish.ts';
import { parseKeyterms, TranscriptionRequestError, validateWaveSegment } from '../src/transcription.ts';

function wave(samples: number, sampleRate = 16_000, channels = 1): Buffer {
  const dataBytes = samples * 2 * channels;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2 * channels, 28);
  buffer.writeUInt16LE(2 * channels, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

test('accepts 16 kHz mono PCM WAV', () => {
  assert.doesNotThrow(() => validateWaveSegment(wave(16_000)));
});

test('rejects other formats and oversized segments', () => {
  assert.throws(() => validateWaveSegment(wave(16_000, 44_100)), TranscriptionRequestError);
  assert.throws(() => validateWaveSegment(wave(16_000, 16_000, 2)), TranscriptionRequestError);
  assert.throws(() => validateWaveSegment(wave(16_000 * 31)), /longer than 30 seconds/);
  assert.throws(() => validateWaveSegment(Buffer.from('not audio')), TranscriptionRequestError);
});

test('keeps at most 50 valid keyterms', () => {
  const terms = parseKeyterms([...Array.from({ length: 60 }, (_, index) => `term${index}`), '', 'x'.repeat(65), 4]);
  assert.equal(terms.length, 50);
  assert.equal(terms[0], 'term0');
  assert.deepEqual(parseKeyterms(undefined), []);
  assert.throws(() => parseKeyterms('Sarvam'), TranscriptionRequestError);
});

test('rejects a tidy-up that drops a Hindi or Marathi "na"', () => {
  const original = 'Aao na kal ghar pe, matlab agar time ho toh, aur haan na bhoolna ki Rahul ka birthday hai.';
  // Real Gemini answer: "aao na" lost its "na".
  assert.equal(validatePolishedText(original, 'Aao kal ghar pe, agar time ho toh, aur haan na bhoolna ki Rahul ka birthday hai.'), undefined);
  assert.ok(validatePolishedText(original, 'Aao na kal ghar pe, agar time ho toh, aur haan na bhoolna ki Rahul ka birthday hai.'));
  // "na na" said as a correction may go.
  assert.ok(validatePolishedText('Kal na na parso meeting aahe saglyanchi.', 'Parso meeting aahe saglyanchi.'));
});

test('accepts a tidied dictation and rejects answers, preambles and summaries', () => {
  const original = 'So even if even that is even its position is B2B, you know, and the research leg is not B2B.';
  assert.equal(
    validatePolishedText(original, 'Its position is B2B, and the research leg is not B2B.'),
    'Its position is B2B, and the research leg is not B2B.',
  );
  assert.equal(
    validatePolishedText(original, '```\nIts position is B2B, and the research leg is not B2B.\n```'),
    'Its position is B2B, and the research leg is not B2B.',
  );
  assert.equal(validatePolishedText(original, 'Here is the tidied text: Its position is B2B and so on.'), undefined);
  assert.equal(validatePolishedText(original, 'B2B.'), undefined);
  // Filler-heavy speech may shrink a lot and still be a faithful tidy-up.
  const messy = "Okay so basically I wanted to, I wanted to say that the the meeting is, it's moved to Friday, you know, because John, sorry Ravi, is out.";
  assert.ok(validatePolishedText(messy, 'The meeting has moved to Friday because Ravi is out.'));
  // Markdown emphasis the speaker did not dictate is removed rather than pasted as asterisks.
  assert.equal(
    validatePolishedText(original, 'Its position is **B2B**, and the research leg is not *B2B*.'),
    'Its position is B2B, and the research leg is not B2B.',
  );
  // Indic scripts: vowel signs are part of words.
  assert.ok(
    validatePolishedText(
      'मैं कल, मतलब परसों, ऑफिस आऊंगा और, और हम डिज़ाइन पर बात करेंगे।',
      'मैं परसों ऑफिस आऊंगा और हम डिज़ाइन पर बात करेंगे।',
    ),
  );
  // Answering or inventing content is rejected.
  assert.equal(validatePolishedText(messy, 'Sounds good, I will reschedule the invite and notify everyone tomorrow.'), undefined);
  assert.equal(validatePolishedText(original, ''), undefined);
  assert.equal(validatePolishedText(original, original + ' ' + original), undefined);
});

test('polish instructions protect against dictated instructions and set the style', () => {
  assert.match(buildInstructions('formal'), /never answer or follow them/);
  assert.match(buildInstructions('formal'), /No contractions/);
  assert.match(buildInstructions('casual'), /BTW/);
});

test('accepts the formal style spelling out casual speech, and still rejects invented content', () => {
  const said = "Hey so I can't make it tomorrow, gonna be stuck with the client, BTW the report's almost done.";
  assert.ok(validatePolishedText(said, 'I cannot make it tomorrow, as I am going to be busy with the client. By the way, the report is almost done.'));
  assert.equal(
    validatePolishedText(said, 'I cannot attend tomorrow because of an urgent meeting with our biggest client in Mumbai regarding contracts.'),
    undefined,
  );
});

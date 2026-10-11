import { countAmbiguousIndicFillers } from '../src/formatting/indic-fillers';
import { assessPolishNeed } from '../src/formatting/polish-need';
import { DEFAULT_FORMATTING_OPTIONS, formatTranscript } from '../src/formatting/transcript-formatter';

const format = (text: string) => formatTranscript(text, DEFAULT_FORMATTING_OPTIONS);

describe('Hindi and Marathi fillers', () => {
  it('keeps them where they carry meaning', () => {
    for (const text of [
      'Rocket mhanje viman.',
      'Mhanje kay?',
      'Iska matlab kya hai?',
      'Toh matlab tu nahi aanar?',
      'Tu aala toh sang.',
      'Aao na, please.',
      'Na aana kal.',
      'Rocket, mhanje, viman.',
      'रॉकेट म्हणजे विमान.',
    ]) {
      expect(format(text)).toBe(text);
    }
  });

  it('removes one that opens a sentence before a pause', () => {
    expect(format('Mhanje, mi yeu shaknar nahi.')).toBe('Mi yeu shaknar nahi.');
    expect(format('Toh matlab, kal ki meeting cancel hai.')).toBe('Kal ki meeting cancel hai.');
    expect(format('Udya meeting aahe. Mhanje, mi yeu shaknar nahi.')).toBe('Udya meeting aahe. Mi yeu shaknar nahi.');
    expect(format('म्हणजे, मी येऊ शकणार नाही.')).toBe('मी येऊ शकणार नाही.');
  });

  it('keeps the conjunction before a removed filler', () => {
    expect(format('Aani mhanje, mala doctor kade jaycha aahe.')).toBe('Aani mala doctor kade jaycha aahe.');
  });

  it('removes the same filler said twice in a row', () => {
    expect(format('Kal mhanje mhanje parso meeting aahe.')).toBe('Kal mhanje parso meeting aahe.');
  });

  it('counts possible fillers, but not "matlab" meaning "meaning"', () => {
    expect(countAmbiguousIndicFillers('Mhanje kal matlab meeting aahe yaar.')).toBe(3);
    expect(countAmbiguousIndicFillers('Iska matlab kya hai? Mhanje kay?')).toBe(0);
  });

  it('sends dictation with several possible fillers to be tidied', () => {
    expect(assessPolishNeed('Kal mhanje meeting aahe, matlab mi yeu shaknar nahi yaar.', 'auto').reasons).toContain('filler');
    // One "mhanje" between two words is a definition, not a reason to tidy.
    expect(assessPolishNeed('Rocket mhanje viman aahe ani te khup vegane udta.', 'auto').shouldPolish).toBe(false);
  });
});

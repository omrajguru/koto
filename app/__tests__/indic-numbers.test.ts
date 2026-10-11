import { convertIndicNumbers } from '../src/formatting/indic-numbers';
import { DEFAULT_FORMATTING_OPTIONS, formatTranscript } from '../src/formatting/transcript-formatter';

const format = (text: string) => formatTranscript(text, DEFAULT_FORMATTING_OPTIONS);

describe('Hindi and Marathi numbers', () => {
  it('writes a spoken time as digits (real dictation)', () => {
    expect(format('Mi aaj raatri nau vaajta devila jaanar aahe, tyamule tula je jevaycha asel tar lagech aatta mala saang.')).toBe(
      'Mi aaj raatri 9 vaajta devila jaanar aahe, tyamule tula je jevaycha asel tar lagech aatta mala saang.',
    );
    expect(format('मी आज रात्री नऊ वाजता देवीला जाणार आहे.')).toBe('मी आज रात्री 9 वाजता देवीला जाणार आहे.');
  });

  it('writes half and quarter hours', () => {
    expect(convertIndicNumbers('kal saade paanch baje milte hai')).toBe('kal 5:30 baje milte hai');
    expect(convertIndicNumbers('savva nau vaajta ye')).toBe('9:15 vaajta ye');
    expect(convertIndicNumbers('paune nau vaajta nighu')).toBe('8:45 vaajta nighu');
    expect(convertIndicNumbers('dedh baje lunch hai')).toBe('1:30 baje lunch hai');
    expect(convertIndicNumbers('अडीच वाजता भेटू')).toBe('2:30 वाजता भेटू');
  });

  it('writes amounts, durations and counts', () => {
    expect(convertIndicNumbers('paanch sau rupaye de do')).toBe('500 rupaye de do');
    expect(convertIndicNumbers('do hazaar rupaye lagenge')).toBe('2000 rupaye lagenge');
    expect(convertIndicNumbers('das minute ruko')).toBe('10 minute ruko');
    expect(convertIndicNumbers('teen taas lagtil')).toBe('3 taas lagtil');
    expect(convertIndicNumbers('saat divas aahet')).toBe('7 divas aahet');
    expect(convertIndicNumbers('pandhra lok yetil')).toBe('15 lok yetil');
    expect(convertIndicNumbers('adich hajar rupaye')).toBe('2500 rupaye');
  });

  it('leaves words that only look like numbers', () => {
    for (const text of [
      'please do it today',
      'ek divas mi nakki yeil',
      'tujha nav kay aahe',
      'mere saath chalo',
      'nau ki das, mala mahit nahi',
      'teen ager',
    ]) {
      expect(convertIndicNumbers(text)).toBe(text);
    }
    expect(convertIndicNumbers('do baje aana')).toBe('2 baje aana');
  });
});

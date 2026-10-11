import { applyWritingStyle } from '../src/formatting/writing-style';
import { DEFAULT_FORMATTING_OPTIONS, formatTranscript } from '../src/formatting/transcript-formatter';

const format = (text: string) => formatTranscript(text, DEFAULT_FORMATTING_OPTIONS);

describe('web and email addresses', () => {
  it('leaves a dictated address as typed, ready to paste into a browser', () => {
    // Real Saaras output.
    expect(format('youtube.com.')).toBe('youtube.com');
    expect(format('icloud.com/mail.')).toBe('icloud.com/mail');
    expect(format('www.google.co.in')).toBe('www.google.co.in');
  });

  it('writes host names and email addresses in lowercase', () => {
    // Real Saaras output: it sometimes uses brand capitals.
    expect(format('YouTube.com.')).toBe('youtube.com');
    expect(format('Watch it on YouTube.com/Shorts today.')).toBe('Watch it on youtube.com/Shorts today.');
    expect(format('Write to Ravi@Gmail.com.')).toBe('Write to ravi@gmail.com.');
    expect(format('We use YouTube and Node.js every day.')).toBe('We use YouTube and Node.js every day.');
  });

  it('joins spoken addresses', () => {
    expect(format('youtube dot com')).toBe('youtube.com');
    expect(format('Open github dot com slash omrajguru slash koto.')).toBe('Open github.com/omrajguru/koto.');
    expect(format('https colon slash slash sarvam dot ai')).toBe('https://sarvam.ai');
    expect(format('www dot substrates dot in')).toBe('www.substrates.in');
  });

  it('joins spoken email addresses', () => {
    expect(format('Send it to ravi at the rate gmail dot com.')).toBe('Send it to ravi@gmail.com.');
    expect(format('My email is ravi at gmail dot com.')).toBe('My email is ravi@gmail.com.');
    expect(format('ravikumar077 at the rate gmail.com')).toBe('ravikumar077@gmail.com');
  });

  it('does not capitalise an address that starts a sentence', () => {
    expect(format('The link works. youtube.com is the one to share.')).toBe('The link works. youtube.com is the one to share.');
    expect(applyWritingStyle('youtube.com', 'formal')).toBe('youtube.com');
    expect(applyWritingStyle('youtube.com', 'casual')).toBe('youtube.com');
  });

  it('keeps the full stop when a sentence ends with an address', () => {
    expect(format('The site is youtube.com.')).toBe('The site is youtube.com.');
  });

  it('leaves ordinary words alone', () => {
    expect(format('We meet at the office at noon.')).toBe('We meet at the office at noon.');
    expect(format('Let us meet at google dot com headquarters.')).toBe('Let us meet at google.com headquarters.');
    expect(format('The dot on the map is our office.')).toBe('The dot on the map is our office.');
    expect(format('so the plan is ready.')).toBe('So the plan is ready.');
  });
});

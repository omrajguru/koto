import { DEFAULT_FORMATTING_OPTIONS, formatTranscript } from '../src/formatting/transcript-formatter';

const format = (text: string) => formatTranscript(text, DEFAULT_FORMATTING_OPTIONS);

describe('brackets and quotes', () => {
  it('turns a spoken pair into the signs', () => {
    expect(format('The launch, open bracket, next week, close bracket, is confirmed.')).toBe('The launch (next week) is confirmed.');
    expect(format('We moved it. Open bracket. Again. Close bracket.')).toBe('We moved it. (Again).');
    expect(format('He said open quote ship it today close quote and left.')).toBe('He said "ship it today" and left.');
    expect(format('He said quote this is fine unquote, which it was not.')).toBe('He said "this is fine", which it was not.');
    expect(format('Use the open square bracket draft close square bracket tag.')).toBe('Use the [draft] tag.');
  });

  it('leaves punctuation that is only being talked about', () => {
    // Real dictation: someone describing a problem with quotes, not dictating them.
    expect(format("Like, let's say double quote or quotes. Improve this.")).toBe("Like, let's say double quote or quotes. Improve this.");
    expect(format('Put this inside brackets when I ask for brackets.')).toBe('Put this inside brackets when I ask for brackets.');
    expect(format('An open bracket on its own stays as words.')).toBe('An open bracket on its own stays as words.');
    expect(format('Can you send me a quote for the website?')).toBe('Can you send me a quote for the website?');
  });
});

describe('sentence marks', () => {
  it('ends a sentence with the mark that was said', () => {
    expect(format('Is it ready question mark')).toBe('Is it ready?');
    expect(format('Is it ready question mark. Then we ship it.')).toBe('Is it ready? Then we ship it.');
    expect(format('We did it exclamation mark')).toBe('We did it!');
    expect(format('That is all full stop')).toBe('That is all.');
  });

  it('keeps the words when the mark is being talked about', () => {
    expect(format('The question mark is missing in the title.')).toBe('The question mark is missing in the title.');
    expect(format('Add a question mark.')).toBe('Add a question mark.');
    expect(format('I asked a question mark you down as present.')).toBe('I asked a question mark you down as present.');
  });
});

describe('signs', () => {
  it('writes keyboard shortcuts with plus signs', () => {
    // Real dictation.
    expect(format('When I click the Control plus Windows button it cuts the first word.')).toBe(
      'When I click the Control + Windows button it cuts the first word.',
    );
    expect(format('Press control plus shift plus T to reopen the tab.')).toBe('Press control + Shift + T to reopen the tab.'.replace('Shift', 'shift'));
    expect(format('Then Alt plus F4 closes it.')).toBe('Then Alt + F4 closes it.');
  });

  it('leaves "plus" that is not a sign', () => {
    // Real dictation: "control plus and" is talk about the bug, not a shortcut.
    expect(format('It said control plus and it put the plus thing in words.')).toBe('It said control plus and it put the plus thing in words.');
    expect(format('Plus, we need a new logo.')).toBe('Plus, we need a new logo.');
    expect(format('She got an A plus in maths.')).toBe('She got an A plus in maths.');
  });

  it('writes arithmetic between numbers', () => {
    expect(format('So 2 plus 2 equals 4.')).toBe('So 2 + 2 = 4.');
    expect(format('It is 10 minus 3, which is 7.')).toBe('It is 10 - 3, which is 7.');
    expect(format('That is 3 times 4 equals 12.')).toBe('That is 3 × 4 = 12.');
    expect(format('Split the 100 into 4 parts.')).toBe('Split the 100 into 4 parts.');
    expect(format('I called 3 times yesterday.')).toBe('I called 3 times yesterday.');
  });

  it('writes other named signs', () => {
    expect(format('I write C plus plus and Rust.')).toBe('I write C++ and Rust.');
    expect(format('Bring tea and slash or coffee.')).toBe('Bring tea and/or coffee.');
    expect(format('Post it with hashtag launchday tonight.')).toBe('Post it with #launchday tonight.');
    expect(format('The hashtag is not working.')).toBe('The hashtag is not working.');
    expect(format('Research ampersand development.')).toBe('Research & development.');
  });
});

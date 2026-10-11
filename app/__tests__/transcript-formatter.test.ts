import {
  DEFAULT_FORMATTING_OPTIONS,
  formatTranscript,
} from '../src/formatting/transcript-formatter';

const format = (text: string, overrides = {}) =>
  formatTranscript(text, { ...DEFAULT_FORMATTING_OPTIONS, ...overrides });

// Verbatim Saaras v4 output for synthesized speech, recorded 9 October 2026.
describe('Saaras v4 transcripts', () => {
  it('applies a correction Saaras split into its own sentence', () => {
    expect(format("Send the invite to John. Oh, sorry, it's not John, it's Ravi. Ask him to bring the slides.")).toBe(
      'Send the invite to Ravi. Ask him to bring the slides.',
    );
  });

  it('applies a restatement that opens a sentence', () => {
    expect(format('So, I think we should probably ship it on Tuesday. Sorry, Wednesday.')).toBe(
      'So, I think we should probably ship it on Wednesday.',
    );
  });

  it('formats an enumeration written as separate sentences', () => {
    expect(
      format('For the launch we need 3 things. First, update the website. Second, email customers. And third, post on social.'),
    ).toBe('For the launch we need 3 things:\n1. Update the website\n2. Email customers\n3. Post on social');
  });

  it('lays out spoken paragraph and bullet commands', () => {
    expect(
      format(
        'Hi team, quick update on Koto. The app now splits audio at pauses. New paragraph. Next steps. Bullet point finish the macOS overlay. Bullet point test Windows ARM builds. Bullet point write the release notes. Thanks, Ravi.',
      ),
    ).toBe(
      'Hi team, quick update on Koto. The app now splits audio at pauses.\n\nNext steps:\n- Finish the macOS overlay\n- Test Windows ARM builds\n- Write the release notes\n\nThanks, Ravi.',
    );
  });

  it('leaves an apology that starts a new thought', () => {
    expect(format("The build is done. Sorry, I'm late.")).toBe("The build is done. Sorry, I'm late.");
  });
});

describe('self-corrections', () => {
  it('replaces a corrected name and drops the correction', () => {
    expect(format("Send the invite to John, oh sorry, it's not John, it's Ravi.")).toBe('Send the invite to Ravi.');
  });

  it('handles the correction without punctuation', () => {
    expect(format('send the invite to john oh sorry its not john its ravi')).toBe('Send the invite to ravi');
  });

  it('keeps capitalisation of the corrected word', () => {
    expect(format('Ask John to review it. Sorry, not John, Ravi.')).toBe('Ask Ravi to review it.');
  });

  it('applies a restatement after a comma cue', () => {
    expect(format("Let's meet on Tuesday, sorry, Wednesday.")).toBe("Let's meet on Wednesday.");
  });

  it('aligns a restatement on a repeated word', () => {
    expect(format('The call is at 5 pm, no wait, at 6 pm.')).toBe('The call is at 6 pm.');
  });

  it('discards the previous sentence on "scratch that"', () => {
    expect(format('I will be late. Actually, scratch that. I am on time.')).toBe('I am on time.');
  });

  it('leaves ordinary contrasts alone', () => {
    expect(format("It's not fast, it's slow.")).toBe("It's not fast, it's slow.");
  });

  it('does not treat an apology as a correction', () => {
    expect(format("I'm sorry I missed the meeting.")).toBe("I'm sorry I missed the meeting.");
    expect(format('I mean it, thank you.')).toBe('I mean it, thank you.');
  });
});

describe('filler words', () => {
  it('removes um and uh', () => {
    expect(format('So, um, I think, uh, we should ship it.')).toBe('So, I think, we should ship it.');
  });

  it('keeps words that only contain filler letters', () => {
    expect(format('The umbrella is under the hummingbird feeder.')).toBe('The umbrella is under the hummingbird feeder.');
  });
});

describe('repeated words', () => {
  it('removes stutters', () => {
    expect(format('I think the the plan works.')).toBe('I think the plan works.');
  });

  it('keeps intentional repeats', () => {
    expect(format('It was very very good.')).toBe('It was very very good.');
  });
});

describe('lists', () => {
  it('formats a spoken enumeration as a numbered list', () => {
    expect(
      format('For the launch we need three things. First, update the website, second, email customers, and third, post on social.'),
    ).toBe('For the launch we need three things:\n1. Update the website\n2. Email customers\n3. Post on social');
  });

  it('formats "number one" style lists', () => {
    expect(format('Groceries, number one, milk, number two, eggs.')).toBe('Groceries:\n1. Milk\n2. Eggs');
  });

  it('ignores a single ordinal', () => {
    expect(format('This is the first time I tried it.')).toBe('This is the first time I tried it.');
  });

  it('turns spoken bullet points into a bulleted list', () => {
    expect(format('Agenda bullet point budget review bullet point hiring plan')).toBe(
      'Agenda\n- Budget review\n- Hiring plan',
    );
  });

  it('supports new line and new paragraph', () => {
    expect(format('Hi Ravi, new paragraph, thanks for the notes. New line Best, Asha')).toBe(
      'Hi Ravi\n\nThanks for the notes.\nBest, Asha',
    );
  });

  it('can be switched off', () => {
    expect(format('Agenda bullet point budget review', { formatLists: false })).toBe('Agenda bullet point budget review');
  });
});

describe('replacements and casing', () => {
  it('applies personal replacements as whole words', () => {
    expect(
      format('open koto speech and check sarvam', {
        replacements: [
          { spoken: 'koto speech', written: 'Koto Speech' },
          { spoken: 'sarvam', written: 'Sarvam' },
        ],
      }),
    ).toBe('Open Koto Speech and check Sarvam');
  });

  it('capitalises I and sentence starts', () => {
    expect(format("i think i'm ready. are you?")).toBe("I think I'm ready. Are you?");
  });

  it('leaves non-Latin text intact', () => {
    expect(format('मैं कल आऊंगा।')).toBe('मैं कल आऊंगा।');
  });

  it('returns an empty string for silence', () => {
    expect(format('   ')).toBe('');
  });
});

// Thinking aloud: restarts and rephrasing with no correction cue. Taken from a real dictation.
describe('thinking aloud', () => {
  it('keeps only the last attempt of a restarted phrase', () => {
    expect(format('So even if even that\'s even its position is B2B.')).toBe('So even its position is B2B.');
  });

  it('drops an abandoned two-word start that ends mid-thought', () => {
    expect(format('We should check if we should ship on Friday.')).toBe('We should ship on Friday.');
    expect(format('It is it was raining all day.')).toBe('It was raining all day.');
  });

  it('keeps the new subject when a restart changes it', () => {
    // Real Saaras output for "if people have problems, they should be able to reach us".
    expect(format('So if if we will have problems, we should they should be able to reach us.')).toBe(
      'So if we will have problems, they should be able to reach us.',
    );
    expect(format('I will we will send it on Monday.')).toBe('We will send it on Monday.');
  });

  it('keeps the rephrased version of a phrase', () => {
    expect(format('And the research thing of this, the research leg of this, is not even B2B.')).toBe(
      'And the research leg of this, is not even B2B.',
    );
    expect(format('We need the launch plan for March, the launch date for March, by Friday.')).toBe(
      'We need the launch date for March, by Friday.',
    );
  });

  it('collapses a stutter at the start of a sentence', () => {
    expect(format('Okay. So, so yeah. That is the plan.')).toBe('Okay. So yeah. That is the plan.');
  });

  it('handles the whole recording', () => {
    expect(
      format(
        "So even if even that's even its position is. B2B. It is business to business. And the research thing of this, the research leg of this, is not even B2B, it's not even B2C. Okay. So, so yeah.",
      ),
    ).toBe(
      "So even its position is. B2B. It is business to business. And the research leg of this, is not even B2B, it's not even B2C. Okay. So yeah.",
    );
  });

  it('leaves deliberate repetition alone', () => {
    const intentional = [
      'I think I can finish it today.',
      'The cat and the dog are asleep.',
      'And that is that.',
      'To be or not to be.',
      'It was very, very good.',
      'Day by day it gets easier.',
      'A lot of time, a lot of money, a lot of effort.',
      'The first part of this, the second part of this.',
      'We tried and we tried again.',
      'If you can, if you want, call me.',
    ];
    for (const sentence of intentional) {
      expect(format(sentence)).toBe(sentence);
    }
  });
});

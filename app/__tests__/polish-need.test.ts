import { assessPolishNeed } from '../src/formatting/polish-need';
import { DEFAULT_FORMATTING_OPTIONS, formatTranscript } from '../src/formatting/transcript-formatter';

const cleaned = (text: string) => formatTranscript(text, DEFAULT_FORMATTING_OPTIONS);

describe('when to polish with AI', () => {
  it('skips short or already clean dictation', () => {
    expect(assessPolishNeed('Send the invite to Ravi.', 'auto').shouldPolish).toBe(false);
    expect(
      assessPolishNeed('The build passed on both machines, and I will publish the release notes this evening.', 'auto')
        .shouldPolish,
    ).toBe(false);
  });

  it('polishes the real recording', () => {
    const text = cleaned(
      "So the position of our company is B2B. So even if even that's even its position is B2B. And the research thing of this, the research leg of this, is not even B2B. So our mission statement, what I need everyone to understand,",
    );
    const assessment = assessPolishNeed(text, 'auto');
    expect(assessment.shouldPolish).toBe(true);
    expect(assessment.reasons).toEqual(expect.arrayContaining(['cut-sentence']));
  });

  it('polishes unresolved corrections and leftover filler', () => {
    expect(
      assessPolishNeed('I think the deadline is Monday, wait, the client said the deadline moved again last week.', 'auto')
        .reasons,
    ).toContain('correction');
    expect(
      assessPolishNeed('The design is basically fine but the onboarding is kind of long for new people joining.', 'auto')
        .reasons,
    ).toContain('filler');
  });

  it('polishes run-on sentences', () => {
    const runOn =
      'we started the migration on Monday and the database moved first and then the queue workers needed new credentials and the dashboard broke because nobody updated the environment and we spent the evening fixing it';
    expect(assessPolishNeed(runOn, 'auto').reasons).toContain('run-on');
  });

  // Real Saaras transcripts the earlier checks let through untidied.
  it('polishes "like" used as filler', () => {
    const text = cleaned(
      "Can you like deploy the fix because it wasn't deployed, we ran out of limits. Just quickly deploy the fix and yeah, that's all.",
    );
    expect(assessPolishNeed(text, 'auto').reasons).toContain('filler');
    expect(
      assessPolishNeed(
        "Like system isn't able to decide by its best when the sentence needs tidying up.",
        'auto',
      ).reasons,
    ).toContain('filler');
    expect(assessPolishNeed('They rarely post, they have like very less followers on Twitter.', 'auto').reasons).toContain(
      'filler',
    );
  });

  it('polishes a sentence Saaras cut at a pause', () => {
    const text = cleaned('I need you to tell me the. Terms of both of the earlier amendments and the latest amendments both.');
    expect(assessPolishNeed(text, 'auto').reasons).toContain('cut-sentence');
  });

  it('polishes phrases said twice', () => {
    expect(
      assessPolishNeed("You can obviously rephrase this. So let's just let's just solve the marketing team's problem please.", 'auto')
        .reasons,
    ).toContain('repeated');
  });

  it('acts on strong signals in short dictation, but not on clean short sentences', () => {
    expect(assessPolishNeed('Can you like send it today?', 'auto').shouldPolish).toBe(true);
    expect(assessPolishNeed('Would you like coffee or tea today?', 'auto').shouldPolish).toBe(false);
  });

  it('leaves ordinary uses of "like" and sentence endings alone', () => {
    for (const text of [
      'I like how the new onboarding screens look on the small laptop display.',
      'It looks just like the design we reviewed with the marketing team last week.',
      'Would you like me to send the release notes to everyone before the meeting?',
      'Make it feel like the one we shipped last year, with the same rounded corners.',
      'What is the new deadline for the launch, and who is the release for?',
      'The build passed on both machines, so I will publish it after lunch today.',
      'That is very, very good news for the whole team and for the launch plan.',
    ]) {
      expect({ text, ...assessPolishNeed(text, 'auto') }).toMatchObject({ text, shouldPolish: false });
    }
  });

  it('asks the AI to place brackets or quotes said after the words', () => {
    expect(assessPolishNeed('The launch is next week, put that in brackets please.', 'auto').reasons).toContain('formatting-request');
    expect(assessPolishNeed('In quotes, ship it today, is what he told me.', 'auto').reasons).toContain('formatting-request');
    expect(assessPolishNeed('We should ship the release next week with the team.', 'auto').shouldPolish).toBe(false);
  });

  it('respects the setting', () => {
    expect(assessPolishNeed('Send the invite to Ravi.', 'always').shouldPolish).toBe(true);
    expect(
      assessPolishNeed('I think the deadline is Monday, wait, the client said the deadline moved again.', 'never')
        .shouldPolish,
    ).toBe(false);
  });
});

describe('"you know" as filler', () => {
  it('is removed when said as an aside', () => {
    expect(cleaned('We build for businesses, you know, not consumers.')).toBe('We build for businesses, not consumers.');
    expect(cleaned('You know, the launch went well.')).toBe('The launch went well.');
    expect(cleaned('It was a long week, you know.')).toBe('It was a long week.');
  });

  it('stays when it is part of the sentence', () => {
    expect(cleaned('Do you know the address?')).toBe('Do you know the address?');
    expect(cleaned('You know what I mean.')).toBe('You know what I mean.');
    expect(cleaned('I want you to know the plan.')).toBe('I want you to know the plan.');
  });
});

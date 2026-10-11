import { DEFAULT_FORMATTING_OPTIONS, formatTranscript } from '../src/formatting/transcript-formatter';
import { applyWritingStyle } from '../src/formatting/writing-style';

const inStyle = (text: string, style: 'neutral' | 'casual' | 'formal') =>
  applyWritingStyle(formatTranscript(text, DEFAULT_FORMATTING_OPTIONS), style);

describe('casual', () => {
  it('uses chat abbreviations', () => {
    expect(inStyle('By the way, I will send it as soon as possible.', 'casual')).toBe('BTW, I will send it ASAP');
    expect(inStyle('To be honest, in my opinion it is fine. Let me know.', 'casual')).toBe('TBH, IMO it is fine. LMK.');
  });

  it('keeps the full stop on longer, multi-sentence messages', () => {
    expect(inStyle('I checked the logs. The build is green.', 'casual')).toBe('I checked the logs. The build is green.');
  });

  it('does not touch words that only contain an abbreviation', () => {
    expect(inStyle('Standby the wayside.', 'casual')).toBe('Standby the wayside');
  });
});

describe('formal', () => {
  it('spells out abbreviations, contractions and slang', () => {
    expect(inStyle("BTW I'm gonna send it ASAP, it's ready.", 'formal')).toBe(
      'By the way I am going to send it as soon as possible, it is ready.',
    );
    expect(inStyle("Yeah, we can't ship today.", 'formal')).toBe('Yes, we cannot ship today.');
  });

  it('removes spoken scaffolding', () => {
    expect(inStyle('Okay. So, so yeah. So our mission statement is simple.', 'formal')).toBe(
      'Our mission statement is simple.',
    );
    expect(inStyle('The plan, you know, is to launch in May.', 'formal')).toBe('The plan is to launch in May.');
    expect(inStyle('Basically, the server restarts at 17:00.', 'formal')).toBe('The server restarts at 17:00.');
  });

  it('keeps meaningful uses of the same words', () => {
    expect(inStyle('That is right. I like the design.', 'formal')).toBe('That is right. I like the design.');
    expect(inStyle('It went well. So did the launch.', 'formal')).toBe('It went well. So did the launch.');
  });

  it('cleans the real recording', () => {
    expect(
      inStyle(
        "So even if even that's even its position is B2B. And the research thing of this, the research leg of this, is not even B2B. Okay. So, so yeah. So our mission statement is clear.",
        'formal',
      ),
      // "So even ..." keeps its "So": without a comma, an opener is only dropped before a subject.
    ).toBe('So even its position is B2B. And the research leg of this, is not even B2B. Our mission statement is clear.');
  });
});

describe('neutral', () => {
  it('leaves the text as cleaned', () => {
    expect(inStyle("By the way, I'm gonna send it.", 'neutral')).toBe("By the way, I'm gonna send it.");
  });
});

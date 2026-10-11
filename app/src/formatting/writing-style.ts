import { NOT_A_WEB_ADDRESS } from './web-addresses';

/**
 * Writing styles: the same dictation written for a chat message or for an email.
 *
 * - neutral: as spoken, after the standard clean-up.
 * - casual: common phrases become chat abbreviations (by the way -> BTW), and a short
 *   one-sentence message drops its final full stop.
 * - formal: abbreviations and contractions are spelled out, slang becomes standard
 *   words, and spoken scaffolding ("Okay.", "So yeah.", a leading "So,") is removed.
 *
 * Rules only; no language model is involved, so sentence structure is never rewritten.
 */
export type WritingStyle = 'neutral' | 'casual' | 'formal';

export const WRITING_STYLES: WritingStyle[] = ['neutral', 'casual', 'formal'];

export const WRITING_STYLE_LABELS: Record<WritingStyle, string> = {
  neutral: 'Neutral',
  casual: 'Casual',
  formal: 'Formal',
};

export function isWritingStyle(value: string): value is WritingStyle {
  return (WRITING_STYLES as string[]).includes(value);
}

const NOT_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_AFTER = '(?![\\p{L}\\p{N}])';

function phrase(words: string): RegExp {
  const pattern = words
    .split(' ')
    .map(word => word.replace(/'/g, "['’]"))
    .join('\\s+');
  return new RegExp(`${NOT_BEFORE}${pattern}${NOT_AFTER}`, 'giu');
}

/** Spoken phrase and its chat abbreviation. Longest phrases first so they win over parts. */
const ABBREVIATIONS: [string, string][] = [
  ['for what it\'s worth', 'FWIW'],
  ['as soon as possible', 'ASAP'],
  ['for your information', 'FYI'],
  ['talk to you later', 'TTYL'],
  ['to be honest', 'TBH'],
  ['in my opinion', 'IMO'],
  ['I do not know', 'IDK'],
  ["I don't know", 'IDK'],
  ['oh my god', 'OMG'],
  ['let me know', 'LMK'],
  ['by the way', 'BTW'],
  ['never mind', 'NVM'],
  ['on my way', 'OMW'],
  ['be right back', 'BRB'],
  ['in real life', 'IRL'],
];

/** Expansions for formal writing. "IDK" expands straight to the formal form. */
const EXPANSIONS: [string, string][] = [
  ['FWIW', "for what it's worth"],
  ['ASAP', 'as soon as possible'],
  ['FYI', 'for your information'],
  ['TTYL', 'talk to you later'],
  ['TBH', 'to be honest'],
  ['IMO', 'in my opinion'],
  ['IDK', 'I do not know'],
  ['LMK', 'let me know'],
  ['BTW', 'by the way'],
  ['NVM', 'never mind'],
  ['OMW', 'on my way'],
  ['BRB', 'be right back'],
];

const CONTRACTIONS: [string, string][] = [
  ["can't", 'cannot'],
  ["won't", 'will not'],
  ["shan't", 'shall not'],
  ["don't", 'do not'],
  ["doesn't", 'does not'],
  ["didn't", 'did not'],
  ["isn't", 'is not'],
  ["aren't", 'are not'],
  ["wasn't", 'was not'],
  ["weren't", 'were not'],
  ["haven't", 'have not'],
  ["hasn't", 'has not'],
  ["hadn't", 'had not'],
  ["shouldn't", 'should not'],
  ["wouldn't", 'would not'],
  ["couldn't", 'could not'],
  ["mustn't", 'must not'],
  ["I'm", 'I am'],
  ["I've", 'I have'],
  ["I'll", 'I will'],
  ["I'd", 'I would'],
  ["you're", 'you are'],
  ["you've", 'you have'],
  ["you'll", 'you will'],
  ["we're", 'we are'],
  ["we've", 'we have'],
  ["we'll", 'we will'],
  ["they're", 'they are'],
  ["they've", 'they have'],
  ["they'll", 'they will'],
  ["he's", 'he is'],
  ["she's", 'she is'],
  // "It's" is always "it is" or "it has"; "it is" reads correctly for both in nearly all dictation.
  ["it's", 'it is'],
  ["that's", 'that is'],
  ["there's", 'there is'],
  ["what's", 'what is'],
  ["who's", 'who is'],
  ["let's", 'let us'],
];

const SLANG: [string, string][] = [
  ['gonna', 'going to'],
  ['wanna', 'want to'],
  ['gotta', 'have to'],
  ['kinda', 'kind of'],
  ['sorta', 'sort of'],
  ['dunno', 'do not know'],
  ['yeah', 'yes'],
  ['yep', 'yes'],
  ['nope', 'no'],
];

/** Copies the case pattern of the spoken words onto the replacement. */
function keepCase(spoken: string, replacement: string): string {
  if (replacement === replacement.toUpperCase()) {
    return replacement;
  }
  if (spoken.length > 1 && spoken === spoken.toUpperCase() && /\p{L}{2}/u.test(spoken)) {
    // An abbreviation being expanded ("BTW" -> "by the way") keeps sentence case, not shouting.
    return replacement;
  }
  const first = spoken.charAt(0);
  return first !== first.toLowerCase() ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

function replaceAll(text: string, pairs: [string, string][]): string {
  let result = text;
  for (const [from, to] of pairs) {
    result = result.replace(phrase(from), match => keepCase(match, to));
  }
  return result;
}

/**
 * Whole sentences that carry no content when written: "Okay.", "So yeah.", "Right."
 * Longer phrases come first so "So yeah." is removed whole rather than as "So".
 */
const SCAFFOLDING_SENTENCE =
  /(^|(?<=[.!?])\s+)(?:so yeah|yeah so|all right|alright|anyways|anyway|okay|ok|right|yeah|so|um|uh)(?:[.!?]+(?=\s|$)|$)/giu;
/**
 * Sentence openers that only bridge spoken thoughts: "So, the plan" -> "The plan". Without a
 * comma they are removed only before a subject ("So our mission", "So I think"), which keeps
 * meaningful uses such as "So did the launch" and "Well done".
 */
const OPENER = '(?:okay so|ok so|so basically|so|basically|well|okay|ok|anyway|alright)';
const SUBJECT =
  '(?:the|our|my|your|their|his|her|its|this|that|these|those|we|i|you|they|he|she|it|there|here|let)(?![\\p{L}\\p{N}])';
const SCAFFOLDING_OPENER = new RegExp(`(^|[.!?]\\s+)${OPENER}(?:,\\s*|\\s+(?=${SUBJECT}))`, 'giu');
/** Asides set off by commas: "the plan, you know, is" -> "the plan is". */
const SCAFFOLDING_ASIDE = /,\s*(?:you know|like|I mean|sort of|kind of)\s*,/giu;

/** A lowercase letter starting a sentence, unless it starts a web address ("youtube.com"). */
const SENTENCE_START = new RegExp(`(^|[.!?]\\s+|\\n\\s*)(\\p{Ll})${NOT_A_WEB_ADDRESS}`, 'gu');

function capitaliseSentenceStarts(text: string): string {
  return text.replace(SENTENCE_START, (_, prefix: string, letter: string) => prefix + letter.toUpperCase());
}

export function applyFormalStyle(text: string): string {
  let result = text;
  result = result.replace(SCAFFOLDING_ASIDE, ' ');
  // Repeat: removing one opener can expose another ("Okay. So, the plan").
  for (let pass = 0; pass < 3; pass += 1) {
    result = result
      .replace(SCAFFOLDING_SENTENCE, '$1')
      .replace(/^\s+/, '')
      .replace(/([.!?])\s{2,}/g, '$1 ')
      .replace(SCAFFOLDING_OPENER, '$1');
  }
  result = replaceAll(result, EXPANSIONS);
  result = replaceAll(result, CONTRACTIONS);
  result = replaceAll(result, SLANG);
  result = result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^\s+/gm, '')
    .trim();
  return capitaliseSentenceStarts(result);
}

const CASUAL_MESSAGE_MAX_WORDS = 25;

export function applyCasualStyle(text: string): string {
  let result = replaceAll(text, ABBREVIATIONS);
  // A short one-sentence message reads like chat without a final full stop.
  const isSingleSentence = !/[.!?]\s+\S/.test(result) && !result.includes('\n');
  const wordCount = result.split(/\s+/).filter(Boolean).length;
  if (isSingleSentence && wordCount <= CASUAL_MESSAGE_MAX_WORDS) {
    result = result.replace(/\.$/, '');
  }
  return result;
}

export function applyWritingStyle(text: string, style: WritingStyle): string {
  if (!text) {
    return text;
  }
  switch (style) {
    case 'casual':
      return applyCasualStyle(text);
    case 'formal':
      return applyFormalStyle(text);
    default:
      return text;
  }
}

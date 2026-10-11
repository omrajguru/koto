import { countAmbiguousIndicFillers } from './indic-fillers';

/**
 * Decides whether a dictation, after the rule-based clean-up, still reads like speech and
 * is worth sending to the AI polish step. Most short, clean dictations are not, so Gemini is
 * asked only about the cases rules cannot fix. The decision is local and instant.
 */
export type PolishMode = 'auto' | 'always' | 'never';

/** Below this, only strong signals (a correction, filler, a broken sentence) trigger a polish. */
const MINIMUM_WORDS = 12;
const MINIMUM_WORDS_FOR_STRONG_SIGNAL = 6;
const LONG_SENTENCE_WORDS = 32;
/** Long dictation is always tidied and laid out in paragraphs. */
export const LONG_DICTATION_WORDS = 60;

const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}\'])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}\'])';

function words(list: string[]): RegExp {
  return new RegExp(`${NOT_WORD_BEFORE}(?:${list.join('|')})${NOT_WORD_AFTER}`, 'iu');
}

/** Correction cues the rules leave in place when the correction shape is not recognisable. */
const UNRESOLVED_CORRECTION = words([
  'sorry',
  'wait',
  'or rather',
  'no no',
  'actually no',
  'i meant',
  'let me rephrase',
  'what i mean is',
  'i mean to say',
]);
/** Filler and hedges that only the AI can remove without changing meaning. */
const LEFTOVER_FILLER = words([
  'i mean',
  'kind of',
  'sort of',
  'basically',
  'literally',
  'you see',
  'i guess',
  'or something',
  'and stuff',
  'and all that',
  'and all of that',
  'you know',
  'so yeah',
  'and yeah',
  'yeah so',
  'okay so',
  "that's all",
  'all of etcetera',
]);
/**
 * "like" used as filler, not as a verb or comparison: "Can you like deploy", "Like system
 * isn't", "they have like very less". "Would you like", "just like my", "I like it" and
 * "like the one" do not match.
 */
const NOT_A_COMPARISON =
  '(?!(?:this|that|it|to|a|an|the|them|him|her|me|us|you|when|how|what|which|who|these|those)(?![\\p{L}]))';
const FILLER_LIKE = new RegExp(
  `(?:^|[.!?,]\\s+)like,?\\s+${NOT_A_COMPARISON}\\p{L}` +
    `|${NOT_WORD_BEFORE}(?:(?:can|could|will|should)\\s+(?:you|we|i|they)|have|has|had|is|are|was|were|it's)\\s+like\\s+${NOT_A_COMPARISON}\\p{L}`,
  'iu',
);
/**
 * Saaras ends a sentence at a pause, so a thought broken by a breath reads "tell me the.
 * Terms of both". A sentence that ends on a word that cannot end one was cut in half. Words
 * that can end a sentence ("what is it for", "turn it on", "that is that") are left out.
 */
const CUT_SENTENCE_ENDING = words(['the', 'a', 'an', 'to', 'of', 'from', 'into', 'by', 'and', 'but', 'or', 'because', 'than', 'our', 'my', 'your', 'their', 'very']);
/** A thought that trails off at the very end: a comma or a connecting word. */
const ABANDONED_ENDING = new RegExp(`(?:,|${CUT_SENTENCE_ENDING.source})\\s*$`, 'iu');

/**
 * "next week, put that in brackets", "in quotes, ship it": which words "that" means needs the
 * whole sentence, so the AI does it. Spoken pairs ("open bracket ... close bracket") are
 * already converted by the rules (spoken-symbols.ts).
 */
const FORMATTING_REQUEST =
  /(?<![\p{L}\p{N}])(?:in|inside|within|into|between)\s+(?:round\s+|square\s+|double\s+)?(?:brackets?|parenthes[ie]s|quotes|quotation marks)(?![\p{L}\p{N}])/iu;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function wordList(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function withoutEndPunctuation(sentence: string): string {
  return sentence.replace(/[.!?]+$/, '').trim();
}

const CUT_SENTENCE = new RegExp(`${CUT_SENTENCE_ENDING.source}$`, 'iu');

/** A sentence cut at a pause: it ends on a word that cannot end a sentence. */
function hasCutSentence(parts: string[]): boolean {
  return parts.some(sentence => CUT_SENTENCE.test(withoutEndPunctuation(sentence)));
}

/** Phrases said twice in a row that the rules left: "let's just let's just", "it would it would". */
function hasRepeatedPhrase(text: string): boolean {
  const list = wordList(text);
  for (let size = 2; size <= 5; size += 1) {
    for (let start = 0; start + size * 2 <= list.length; start += 1) {
      let isRepeated = true;
      for (let offset = 0; offset < size; offset += 1) {
        if (list[start + offset] !== list[start + size + offset]) {
          isRepeated = false;
          break;
        }
      }
      if (isRepeated) {
        return true;
      }
    }
  }
  return false;
}

export interface PolishAssessment {
  shouldPolish: boolean;
  reasons: string[];
}

export function assessPolishNeed(text: string, mode: PolishMode): PolishAssessment {
  if (mode === 'never' || !text.trim()) {
    return { shouldPolish: false, reasons: [] };
  }
  if (mode === 'always') {
    return { shouldPolish: true, reasons: ['always'] };
  }
  const count = wordCount(text);
  if (count < MINIMUM_WORDS_FOR_STRONG_SIGNAL) {
    return { shouldPolish: false, reasons: [] };
  }
  const parts = sentences(text);

  // Strong signals: the text is plainly unfinished speech, even when short.
  const strong: string[] = [];
  if (UNRESOLVED_CORRECTION.test(text)) {
    strong.push('correction');
  }
  // One "mhanje" may mean "that is"; two or more in one dictation are worth a look.
  if (LEFTOVER_FILLER.test(text) || FILLER_LIKE.test(text) || countAmbiguousIndicFillers(text) >= 2) {
    strong.push('filler');
  }
  if (hasCutSentence(parts) || ABANDONED_ENDING.test(text.trim())) {
    strong.push('cut-sentence');
  }
  if (hasRepeatedPhrase(text)) {
    strong.push('repeated');
  }
  if (FORMATTING_REQUEST.test(text)) {
    strong.push('formatting-request');
  }
  if (count < MINIMUM_WORDS) {
    return { shouldPolish: strong.length > 0, reasons: strong };
  }

  const reasons = [...strong];
  if (count >= LONG_DICTATION_WORDS) {
    reasons.push('long');
  }
  if (parts.some(sentence => wordCount(sentence) > LONG_SENTENCE_WORDS)) {
    reasons.push('run-on');
  }
  if (parts.some(sentence => (sentence.match(/,/g) ?? []).length >= 4)) {
    reasons.push('comma-heavy');
  }
  if (parts.filter(sentence => /^(?:and|but|so)(?![\p{L}\p{N}])/iu.test(sentence)).length >= 2) {
    reasons.push('chained');
  }
  return { shouldPolish: reasons.length > 0, reasons };
}

import { removeIndicFillers } from './indic-fillers';
import { convertIndicNumbers } from './indic-numbers';
import { convertSpokenSymbols } from './spoken-symbols';
import { finishLoneWebAddress, joinSpokenWebAddresses, lowercaseWebAddresses, NOT_A_WEB_ADDRESS } from './web-addresses';

/**
 * Turns a raw Saaras v4 transcript into text ready to paste.
 *
 * Every step is a deterministic rule; no language model is involved. Rules are
 * deliberately conservative: when a pattern is ambiguous the text is left as
 * spoken, because a wrong edit is worse than a missed one.
 *
 * Pipeline order matters:
 * 1. Personal replacements ("koto speech" -> "Koto Speech"), spoken web addresses ("youtube dot com" -> "youtube.com"),
 *    and spoken punctuation and signs ("open bracket ... close bracket", "Control plus Windows")
 * 2. Filler words (um, uh, ...)
 * 3. Self-corrections ("John, oh sorry, it's not John, it's Ravi" -> "Ravi")
 * 4. Repeated words ("the the" -> "the")
 * 5. Spoken layout commands ("new line", "new paragraph", "bullet point")
 * 6. Spoken enumerations ("first ..., second ...") -> numbered lists
 * 7. Spacing, punctuation and capitalisation
 */

export interface WordReplacement {
  spoken: string;
  written: string;
}

export interface FormattingOptions {
  removeFillerWords: boolean;
  applySelfCorrections: boolean;
  formatLists: boolean;
  replacements: WordReplacement[];
}

export const DEFAULT_FORMATTING_OPTIONS: FormattingOptions = {
  removeFillerWords: true,
  applySelfCorrections: true,
  formatLists: true,
  replacements: [],
};

// Letters and digits in any script, so rules behave on Devanagari and other scripts too.
const WORD_CHARACTER = '[\\p{L}\\p{N}]';
const NOT_BEFORE = `(?<!${WORD_CHARACTER})`;
const NOT_AFTER = `(?!${WORD_CHARACTER})`;
const WORD = `${WORD_CHARACTER}+(?:['’]${WORD_CHARACTER}+)?`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wholePhrase(phrase: string, flags = 'giu'): RegExp {
  const pattern = phrase.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  return new RegExp(`${NOT_BEFORE}${pattern}${NOT_AFTER}`, flags);
}

/** Copies the capitalisation style of `template` onto `value`. */
function matchCase(template: string, value: string): string {
  if (template.length > 1 && template === template.toUpperCase() && template !== template.toLowerCase()) {
    return value.toUpperCase();
  }
  const first = template.charAt(0);
  if (first !== first.toLowerCase()) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return value;
}

// 1. Personal replacements -------------------------------------------------

export function applyReplacements(text: string, replacements: WordReplacement[]): string {
  let result = text;
  // Longer phrases first so "koto speech" wins over "koto".
  const ordered = [...replacements]
    .filter(replacement => replacement.spoken.trim().length > 0)
    .sort((a, b) => b.spoken.length - a.spoken.length);
  for (const replacement of ordered) {
    result = result.replace(wholePhrase(replacement.spoken), replacement.written);
  }
  return result;
}

// 2. Filler words ------------------------------------------------------------

const FILLER_WORDS = ['um+', 'u+h+m*', 'e+r+m*', 'a+h+', 'h+m+', 'm{2,}', 'mhm'];
const FILLER_PATTERN = new RegExp(
  `(^|[\\s,;])(?:${FILLER_WORDS.join('|')})${NOT_AFTER}[,.…]*(?=\\s|$|[,.;!?])`,
  'giu',
);

/**
 * "you know" only counts as filler when set off as an aside: ", you know," mid-sentence,
 * "You know," opening a sentence, or ", you know." closing one. "Do you know" and
 * "You know what I mean" are left alone.
 */
const YOU_KNOW_ASIDE = /,\s*you know\s*,/giu;
const YOU_KNOW_OPENER = /(^|[.!?]\s+)you know,\s*/giu;
const YOU_KNOW_CLOSER = /,\s*you know(?=\s*[.!?]|\s*$)/giu;

export function removeFillerWords(text: string): string {
  let previous: string;
  let result = text;
  do {
    previous = result;
    result = result.replace(FILLER_PATTERN, '$1');
  } while (result !== previous);
  return result
    .replace(YOU_KNOW_ASIDE, (aside, offset: number, whole: string) =>
      // Keep a comma only where a new clause follows ("businesses, not consumers");
      // otherwise the aside sat between subject and verb ("The plan is").
      CLAUSE_OPENER.test(whole.slice(offset + aside.length)) ? ', ' : ' ',
    )
    .replace(YOU_KNOW_OPENER, '$1')
    .replace(YOU_KNOW_CLOSER, '');
}

const CLAUSE_OPENER = /^\s*(?:not|but|and|so|or|because|which|who|then|although|while|though)(?![\p{L}\p{N}])/iu;

// 3. Self-corrections ------------------------------------------------------

// Spoken signals that the speaker is about to correct something they just said.
const CORRECTION_CUE =
  '(?:(?:oh|ah|no|nope|wait)[\\s,]+)*(?:sorry|my bad|correction|i mean|no wait|wait no|actually no|no no|nope|i meant)';
const COPULA = "(?:it['’]?s|it is|that['’]?s|that is|he['’]?s|she['’]?s|its)";
const SHORT_PHRASE = `${WORD}(?:\\s+${WORD}){0,2}`;

/**
 * "... John ... oh sorry, it's not John, it's Ravi" removes the correction and
 * replaces the most recent "John" with "Ravi". Requires a correction cue so that
 * ordinary sentences like "it's not fast, it's slow" are untouched.
 */
const CORRECTION_SEPARATOR = `(?:\\s*[,;]\\s*(?:(?:${COPULA}|but|rather)\\s+)?|\\s+(?:${COPULA}|but|rather)\\s+)`;
const NEGATED_CORRECTION = new RegExp(
  `[\\s,;.]*${NOT_BEFORE}${CORRECTION_CUE}[\\s,.]+(?:${COPULA}\\s+)?not\\s+(${WORD}(?:\\s+${WORD}){0,2}?)${CORRECTION_SEPARATOR}`,
  'iu',
);

/**
 * "meet on Tuesday, sorry, Wednesday" replaces the words before the cue with
 * the restatement. Saaras often writes this as "Tuesday. Sorry, Wednesday.",
 * so a cue that opens a short sentence also counts. The cue must be set off by
 * punctuation (or start a clause with oh/no) to avoid treating "I'm sorry" or
 * "I mean it" as corrections, and restatements that open a new thought
 * ("Sorry, I'm late.") are left alone.
 */
const RESTATEMENT = new RegExp(
  `([.!?]\\s+|,\\s*|\\s+(?=(?:oh|no|wait)[\\s,]))${CORRECTION_CUE}[\\s,]+(${SHORT_PHRASE})(?=\\s*(?:[.!?;,]|$))`,
  'iu',
);
const NEW_THOUGHT_OPENERS = new Set([
  'i', "i'm", 'im', "i'll", "i've", 'we', "we're", 'you', 'he', 'she', 'they', 'it', "it's", 'this', 'that',
  'my', 'our', 'your', 'can', 'could', 'will', 'would', 'was', 'am', 'please', 'thanks', 'thank', 'about', 'for',
]);

const DISCARD_PREVIOUS = /[\s,]*\b(?:scratch that|strike that|delete that|ignore that)\b[.,!]?/iu;

function lastWholeWordIndex(haystack: string, needle: string): { index: number; matched: string } | undefined {
  const pattern = wholePhrase(needle);
  let found: { index: number; matched: string } | undefined;
  for (const match of haystack.matchAll(pattern)) {
    found = { index: match.index ?? 0, matched: match[0] };
  }
  return found;
}

function applyNegatedCorrections(text: string): string {
  let result = text;
  for (let guard = 0; guard < 10; guard += 1) {
    const match = NEGATED_CORRECTION.exec(result);
    if (!match) {
      break;
    }
    const wrong = match[1];
    const before = result.slice(0, match.index);
    // The intended phrase has as many words as the phrase it corrects ("John" -> "Ravi").
    const remainder = result.slice(match.index + match[0].length);
    const wordCount = wrong.split(/\s+/).length;
    const rightMatch = new RegExp(`^${WORD}(?:\\s+${WORD}){0,${wordCount - 1}}`, 'u').exec(remainder);
    if (!rightMatch) {
      break;
    }
    const right = rightMatch[0];
    const after = remainder.slice(right.length);
    const target = lastWholeWordIndex(before, wrong);
    if (target) {
      const corrected =
        before.slice(0, target.index) + matchCase(target.matched, right) + before.slice(target.index + target.matched.length);
      result = corrected + after;
    } else {
      // Nothing earlier to correct: keep the speaker's intended phrase in place of the correction.
      result = `${before} ${right}${after}`;
    }
  }
  return result;
}

function applyRestatements(text: string): string {
  let result = text;
  for (let guard = 0; guard < 10; guard += 1) {
    const match = RESTATEMENT.exec(result);
    if (!match) {
      break;
    }
    const restatement = match[2];
    const openingWord = restatement.split(/\s+/)[0].toLowerCase().replace('’', "'");
    if (NEW_THOUGHT_OPENERS.has(openingWord)) {
      // Not a correction. Leave it and keep looking further along.
      const end = match.index + match[0].length;
      return result.slice(0, end) + applyRestatements(result.slice(end));
    }
    const before = result.slice(0, match.index);
    const after = result.slice(match.index + match[0].length);
    const replacementWords = restatement.split(/\s+/);
    const beforeWords = [...before.matchAll(new RegExp(WORD, 'gu'))];
    // Clause boundary: never reach back past the previous sentence.
    const clauseStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'));
    const candidates = beforeWords.filter(word => (word.index ?? 0) > clauseStart);
    if (candidates.length === 0) {
      result = `${before}${after}`;
      continue;
    }
    // If the restatement repeats a recent word ("at 5, sorry, at 6"), align on it.
    const anchorWord = replacementWords[0].toLowerCase();
    let startWord = -1;
    for (let index = candidates.length - 1; index >= Math.max(0, candidates.length - 6); index -= 1) {
      if (candidates[index][0].toLowerCase() === anchorWord) {
        startWord = index;
        break;
      }
    }
    if (startWord === -1) {
      startWord = Math.max(0, candidates.length - replacementWords.length);
    }
    const replaced = candidates[startWord];
    const replaceFrom = replaced.index ?? 0;
    result = before.slice(0, replaceFrom) + matchCase(replaced[0], restatement) + after;
  }
  return result;
}

function lastSentenceEnd(text: string): number {
  return Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'), text.lastIndexOf('\n'));
}

function applyDiscards(text: string): string {
  let result = text;
  for (let guard = 0; guard < 10; guard += 1) {
    const match = DISCARD_PREVIOUS.exec(result);
    if (!match) {
      break;
    }
    let before = result.slice(0, match.index).replace(/[\s.!?,]+$/, '');
    const after = result.slice(match.index + match[0].length);
    let sentenceEnd = lastSentenceEnd(before);
    // "I will be late. Actually, scratch that." discards the previous sentence, not just "Actually".
    const fragmentWords = before.slice(sentenceEnd + 1).trim().split(/\s+/).filter(Boolean);
    if (sentenceEnd >= 0 && fragmentWords.length <= 2) {
      before = before.slice(0, sentenceEnd);
      sentenceEnd = lastSentenceEnd(before);
    }
    const kept = sentenceEnd >= 0 ? before.slice(0, sentenceEnd + 1) : '';
    result = `${kept} ${after.replace(/^[\s.,]+/, '')}`;
  }
  return result;
}

export function applySelfCorrections(text: string): string {
  return applyRestatements(applyNegatedCorrections(applyDiscards(text)));
}

// Thinking aloud ----------------------------------------------------------
//
// People restart and rephrase while they work out what to say, with no cue word:
//   "So even if even that's even its position is"            -> "So even its position is"
//   "the research thing of this, the research leg of this"    -> "the research leg of this"
// Ordinary speech repeats words on purpose too ("I think I can", "the cat and the dog",
// "and that is that"), so each rule only fires on a shape that is rarely deliberate.

/** Words that cannot end a thought; a fragment ending in one was abandoned. */
const DANGLING_WORDS = new Set([
  'if', 'that', "that's", 'thats', 'the', 'a', 'an', 'to', 'of', 'is', 'was', 'are', 'were', 'it', "it's", 'its',
  'i', 'we', 'you', 'they', 'in', 'on', 'for', 'with', 'because', 'when', 'my', 'our', 'your', 'this', 'his',
  'her', 'their', 'be',
]);

const SUBJECTS = new Set(['i', 'we', 'you', 'they', 'he', 'she', 'it', 'people', 'everyone', 'someone']);

interface WordToken {
  word: string;
  start: number;
  end: number;
}

function tokenize(text: string): WordToken[] {
  return [...text.matchAll(new RegExp(WORD, 'gu'))].map(match => ({
    word: match[0].toLowerCase().replace('’', "'"),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

/** Applies a rewrite to each clause separately; restarts never span punctuation. */
function mapClauses(text: string, rewrite: (clause: string) => string): string {
  return text.replace(/[^.!?;:,\n]+/g, clause => rewrite(clause));
}

/**
 * Returns the index of the token where the final attempt starts, if the clause opens
 * one or more abandoned attempts before it. Two shapes count:
 * - The same word starts three or more attempts close together: "even if even that's even its".
 * - The same word or word pair starts two attempts, and the first ends on a dangling word:
 *   "it is it was", "we should check if we should ship".
 */
function findRestart(tokens: WordToken[]): { from: number; to: number } | undefined {
  for (let first = 0; first < tokens.length; first += 1) {
    const word = tokens[first].word;
    if (ALLOWED_REPEATS.has(word)) {
      continue;
    }
    // Chain of nearby attempts starting with the same word.
    const chain = [first];
    for (let next = first + 1; next < tokens.length && next - chain[chain.length - 1] <= 2; next += 1) {
      if (tokens[next].word === word) {
        chain.push(next);
      }
    }
    const last = chain[chain.length - 1];
    // The kept attempt must say something, which rules out endings like "and that is that".
    const hasSubstance = tokens.length - last >= 2;
    if (chain.length >= 3 && hasSubstance) {
      return { from: first, to: last };
    }
    if (chain.length === 2 && last - first === 2 && hasSubstance && DANGLING_WORDS.has(tokens[first + 1].word)) {
      // "we should they should be": the second attempt changed the subject, so keep "they should".
      const subjectBefore = first > 0 ? tokens[first - 1].word : '';
      if (SUBJECTS.has(subjectBefore) && SUBJECTS.has(tokens[first + 1].word) && subjectBefore !== tokens[first + 1].word) {
        return { from: first - 1, to: first + 1 };
      }
      return { from: first, to: last };
    }
    // Same two-word opening repeated within a few words, after a dangling word.
    for (let next = first + 2; next <= first + 5 && next + 1 < tokens.length; next += 1) {
      const isRepeatedPair =
        first + 1 < tokens.length && tokens[next].word === word && tokens[next + 1].word === tokens[first + 1].word;
      if (isRepeatedPair && next - first >= 3 && DANGLING_WORDS.has(tokens[next - 1].word) && tokens.length - next >= 3) {
        return { from: first, to: next };
      }
    }
  }
  return undefined;
}

export function collapseRestarts(text: string): string {
  return mapClauses(text, clause => {
    let result = clause;
    for (let guard = 0; guard < 5; guard += 1) {
      const tokens = tokenize(result);
      const restart = findRestart(tokens);
      if (!restart) {
        break;
      }
      const abandoned = tokens[restart.from];
      const kept = tokens[restart.to];
      // The kept word takes the capitalisation of the abandoned one ("It is it was" -> "It was").
      const keptWord = matchCase(result.slice(abandoned.start, abandoned.end), result.slice(kept.start, kept.end));
      result = result.slice(0, abandoned.start) + keptWord + result.slice(kept.end);
    }
    return result;
  });
}


/**
 * "the research thing of this, the research leg of this" keeps the second wording. The
 * second phrase must match the end of the first in length (give or take a word), opening
 * two words and final word, which lists ("a lot of time, a lot of money") never do.
 */
export function collapseRephrasing(text: string): string {
  return text.replace(/[^.!?;:\n]+/g, sentence => {
    const segments = sentence.split(',');
    for (let index = 0; index + 1 < segments.length; index += 1) {
      const before = tokenize(segments[index]);
      const after = tokenize(segments[index + 1]);
      if (after.length < 3 || after.length > 8) {
        continue;
      }
      for (const length of [after.length, after.length - 1, after.length + 1]) {
        if (length < 3 || length > before.length) {
          continue;
        }
        const tail = before.slice(before.length - length);
        const isRephrase =
          tail[0].word === after[0].word &&
          tail[1].word === after[1].word &&
          tail[tail.length - 1].word === after[after.length - 1].word &&
          tail.map(token => token.word).join(' ') !== after.map(token => token.word).join(' ');
        if (isRephrase) {
          // Drop the first wording and its comma; keep whatever led into it ("And", "We need").
          const lead = segments[index].slice(0, tail[0].start).replace(/\s+$/, '');
          const replacement = segments[index + 1].trimStart();
          segments.splice(index, 2, lead ? `${lead} ${replacement}` : ` ${replacement}`);
          index -= 1;
          break;
        }
      }
    }
    return segments.join(',');
  });
}

/** "So, so yeah" at the start of a sentence is a stutter, even though "so so" can be deliberate. */
const SENTENCE_START_STUTTER = /(^|[.!?]\s+)(so|and|but|okay|yeah|yes|no|the|i|we)(?:,?\s+\2)+(?![\p{L}\p{N}])/giu;

export function collapseSentenceStartStutter(text: string): string {
  return text.replace(SENTENCE_START_STUTTER, (_, prefix: string, word: string) => prefix + word);
}

export function applyThinkingAloudCleanup(text: string): string {
  return collapseRephrasing(collapseRestarts(collapseSentenceStartStutter(text)));
}

// 4. Repeated words ----------------------------------------------------------

// Doubles that are often intentional.
const ALLOWED_REPEATS = new Set(['that', 'had', 'very', 'so', 'no', 'bye', 'ha', 'really', 'many', 'yeah', 'yes', 'well']);
const REPEATED_WORD = new RegExp(`${NOT_BEFORE}(${WORD})(?:[\\s,]+\\1${NOT_AFTER})+`, 'giu');

export function removeRepeatedWords(text: string): string {
  return text.replace(REPEATED_WORD, (whole, word: string) =>
    ALLOWED_REPEATS.has(word.toLowerCase()) ? whole : word,
  );
}

// 5. Spoken layout commands ---------------------------------------------------

const LINE_BREAK_MARK = '\u0001';
const PARAGRAPH_MARK = '\u0002';
const BULLET_MARK = '\u0003';

export function applySpokenCommands(text: string): string {
  return text
    .replace(/[\s,]*\b(?:new|next) paragraph\b[\s,.:]*/giu, PARAGRAPH_MARK)
    .replace(/[\s,]*\b(?:new|next) line\b[\s,.:]*/giu, LINE_BREAK_MARK)
    .replace(/[\s,]*\b(?:(?:new|next|another) )?bullet(?: point)?\b[\s,.:]*/giu, BULLET_MARK);
}

// 6. Spoken enumerations ------------------------------------------------------

const ORDINALS = [
  ['first', 'firstly', 'one', 'number one', '1'],
  ['second', 'secondly', 'two', 'number two', '2'],
  ['third', 'thirdly', 'three', 'number three', '3'],
  ['fourth', 'fourthly', 'four', 'number four', '4'],
  ['fifth', 'fifthly', 'five', 'number five', '5'],
  ['sixth', 'six', 'number six', '6'],
  ['seventh', 'seven', 'number seven', '7'],
  ['eighth', 'eight', 'number eight', '8'],
  ['ninth', 'nine', 'number nine', '9'],
  ['tenth', 'ten', 'number ten', '10'],
];

function ordinalPattern(position: number): string {
  return ORDINALS[position].map(word => word.replace(' ', '\\s+')).join('|');
}

/**
 * Finds "first X, second Y, third Z" (also "one", "number one", "firstly") and
 * returns the lead-in text and items. Needs at least two items in order, each
 * introduced at a clause boundary, so "first time" or "one of them" are ignored.
 */
export function extractEnumeration(text: string): { leadIn: string; items: string[]; trailing: string } | undefined {
  const boundary = '(?:^|[.,;:!?\\n]\\s*|\\s+and\\s+|\\s+then\\s+)';
  const firstMarker = new RegExp(`${boundary}(?:${ordinalPattern(0)})\\s*[,:.]\\s*`, 'iu');
  const start = firstMarker.exec(text);
  if (!start) {
    return undefined;
  }
  const leadIn = text.slice(0, start.index);
  let rest = text.slice(start.index + start[0].length);
  const items: string[] = [];
  for (let position = 1; position < ORDINALS.length; position += 1) {
    const marker = new RegExp(`(?:[.,;!?]\\s*|\\s+and\\s+|\\s+then\\s+)(?:and\\s+|then\\s+)?(?:${ordinalPattern(position)})\\s*[,:.]\\s*`, 'iu');
    const next = marker.exec(rest);
    if (!next) {
      break;
    }
    items.push(rest.slice(0, next.index));
    rest = rest.slice(next.index + next[0].length);
  }
  if (items.length === 0) {
    return undefined;
  }
  // The last item runs to the end of its sentence; anything after stays as prose.
  const lastItemEnd = rest.search(/[.!?](?:\s|$)/);
  const lastItem = lastItemEnd === -1 ? rest : rest.slice(0, lastItemEnd);
  const trailing = lastItemEnd === -1 ? '' : rest.slice(lastItemEnd + 1);
  items.push(lastItem);
  const cleaned = items.map(item => item.trim().replace(/^(?:and|then)\s+/i, '').replace(/[,;.\s]+$/, ''));
  if (cleaned.some(item => item.length === 0)) {
    return undefined;
  }
  return { leadIn, items: cleaned, trailing: trailing.trim() };
}

function capitaliseFirst(value: string): string {
  return value.replace(new RegExp(`^(\\s*)(\\p{Ll})${NOT_A_WEB_ADDRESS}`, 'u'), (_, space: string, letter: string) => space + letter.toUpperCase());
}

export function formatEnumerations(text: string): string {
  const enumeration = extractEnumeration(text);
  if (!enumeration) {
    return text;
  }
  const leadIn = enumeration.leadIn.trim().replace(/[,;.\s]+$/, '');
  const list = enumeration.items.map((item, index) => `${index + 1}. ${capitaliseFirst(item)}`).join('\n');
  const parts = [leadIn ? `${leadIn}:` : '', list, enumeration.trailing ? formatEnumerations(enumeration.trailing) : '']
    .filter(Boolean);
  return parts.join('\n');
}

// 7. Spacing, punctuation and capitalisation ---------------------------------

function tidyLine(line: string): string {
  return line
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    // A space after punctuation, except inside "https://".
    .replace(/([,;:])(?=[^\s\d/])/g, '$1 ')
    .replace(/,{2,}/g, ',')
    .replace(/([,;:])\s*([.!?])/g, '$2')
    .replace(/([.!?])\s*,/g, '$1')
    .replace(/\.{2,}(?!\.)/g, '.')
    .replace(/^[\s,.;:]+/, '')
    .trim();
}

function capitaliseSentences(line: string): string {
  return line
    .replace(new RegExp(`${NOT_BEFORE}i${NOT_AFTER}`, 'gu'), 'I')
    .replace(new RegExp(`${NOT_BEFORE}i(['’](?:m|ve|ll|d))${NOT_AFTER}`, 'gu'), 'I$1')
    .replace(SENTENCE_START, (_, prefix: string, letter: string) => prefix + letter.toUpperCase());
}

/** A lowercase letter starting a sentence, unless it starts a web address ("youtube.com"). */
const SENTENCE_START = new RegExp(`(^|[.!?]\\s+)(\\p{Ll})${NOT_A_WEB_ADDRESS}`, 'gu');

function finishLayout(text: string): string {
  const withBreaks = text
    .replace(new RegExp(`\\s*${PARAGRAPH_MARK}\\s*`, 'g'), '\n\n')
    .replace(new RegExp(`\\s*${LINE_BREAK_MARK}\\s*`, 'g'), '\n')
    .replace(new RegExp(`\\s*${BULLET_MARK}\\s*`, 'g'), '\n- ');
  const lines = withBreaks.split('\n');
  const output: string[] = [];
  lines.forEach((line, index) => {
    const listItem = line.match(/^\s*(- |\d+\. )(.*)$/);
    const nextIsListItem = /^\s*(?:- |\d+\. )/.test(lines[index + 1] ?? '');
    if (!listItem) {
      let prose = capitaliseSentences(tidyLine(line));
      // A short sentence right before a list is its heading: "Next steps." -> "Next steps:"
      const lastSentence = prose.split(/(?<=[.!?])\s+/).pop() ?? '';
      if (nextIsListItem && prose.endsWith('.') && lastSentence.split(/\s+/).length <= 4) {
        prose = `${prose.slice(0, -1)}:`;
      }
      output.push(prose);
      return;
    }
    const [, marker, body] = listItem;
    const item = capitaliseSentences(tidyLine(body));
    const sentences = item.split(/(?<=[.!?])\s+/);
    if (!nextIsListItem && sentences.length > 1) {
      // Whatever follows the last item's first sentence is prose after the list.
      output.push(marker + sentences[0].replace(/[.,;]$/, ''), '', sentences.slice(1).join(' '));
      return;
    }
    output.push(marker + (sentences.length === 1 ? item.replace(/[.,;]$/, '') : item));
  });
  return output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

export function formatTranscript(raw: string, options: FormattingOptions = DEFAULT_FORMATTING_OPTIONS): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  text = applyReplacements(text, options.replacements);
  text = lowercaseWebAddresses(joinSpokenWebAddresses(text));
  text = convertIndicNumbers(convertSpokenSymbols(text));
  if (options.removeFillerWords) {
    text = removeIndicFillers(removeFillerWords(text));
  }
  if (options.applySelfCorrections) {
    text = applySelfCorrections(text);
    text = applyThinkingAloudCleanup(text);
  }
  text = removeRepeatedWords(text);
  if (options.formatLists) {
    text = applySpokenCommands(text);
    text = text
      .split(new RegExp(`(${PARAGRAPH_MARK}|${LINE_BREAK_MARK}|${BULLET_MARK})`))
      .map(part => (part.length > 1 ? formatEnumerations(part.trim()) : part))
      .join('');
  }
  return finishLoneWebAddress(finishLayout(text));
}

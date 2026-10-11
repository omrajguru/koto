/**
 * Punctuation and signs said out loud: "open bracket next week close bracket" -> "(next week)",
 * "Control plus Windows" -> "Control + Windows", "is it ready question mark" -> "is it ready?".
 *
 * People often talk *about* punctuation ("the punctuation, like double quotes, is not nice"),
 * and that must stay words. So only unmistakable dictation commands are converted:
 * - brackets and quotes only as a complete pair ("open ... close", "quote ... unquote");
 * - sentence marks only where a sentence ends, and never after "the", "a", "this" and the like;
 * - "plus" only between keyboard keys (with a modifier such as Control) or between numbers.
 */

const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}])';

/**
 * Case-insensitive spelling of a pattern without the `i` flag. With `i` and `u` together,
 * `\p{Lu}` also matches lowercase letters, which the sentence-end check relies on.
 */
function anyCase(pattern: string): string {
  return pattern.replace(/[a-z]/g, letter => `[${letter}${letter.toUpperCase()}]`);
}

/** Words that make the next word a thing being talked about, not a command. */
const MENTION_WORDS = 'the|a|an|this|that|these|those|my|your|our|their|no|any|of|with|without|use|add|put|type|press|said|say';
const NOT_A_MENTION = `(?<!${NOT_WORD_BEFORE}(?:${anyCase(MENTION_WORDS)})\\s+)`;

interface Pair {
  open: string;
  close: string;
  opening: string;
  closing: string;
}

/** Checked in order: square before round, and "open quote" before the bare "quote". */
const PAIRS: Pair[] = [
  { open: 'open square bracket', close: 'close square bracket', opening: '[', closing: ']' },
  { open: 'open curly (?:bracket|brace)', close: 'close curly (?:bracket|brace)', opening: '{', closing: '}' },
  { open: 'open bracket|bracket open|open parenthesis|open paren', close: 'close bracket|bracket close|end bracket|close parenthesis|close paren', opening: '(', closing: ')' },
  { open: 'open (?:double )?quotes?|begin quote|start quote', close: 'close (?:double )?quotes?|end quote|unquote', opening: '"', closing: '"' },
  { open: 'quote', close: 'unquote|end quote', opening: '"', closing: '"' },
];

function convertPair(text: string, pair: Pair): string {
  const pattern = new RegExp(
    // Spaces and Saaras's commas before the opening command go; a full stop before it stays.
    `([\\s,]*)${NOT_WORD_BEFORE}(?:${anyCase(pair.open)})${NOT_WORD_AFTER}[\\s,.;:]*([\\s\\S]+?)[\\s,.;:]*${NOT_WORD_BEFORE}(?:${anyCase(pair.close)})${NOT_WORD_AFTER}(,?)`,
    'gu',
  );
  return text.replace(pattern, (_whole: string, before: string, inner: string, after: string, offset: number) => {
    const isAtStart = offset === 0 || /\n$/.test(text.slice(0, offset));
    // Commas on both sides are the pauses around the command ("launch, open bracket, ... close
    // bracket, is"); a comma only after it is real punctuation ("unquote, which").
    const trailing = after && !before.includes(',') ? after : '';
    return `${isAtStart ? '' : ' '}${pair.opening}${inner.trim()}${pair.closing}${trailing}`;
  });
}

const SENTENCE_MARKS: [string, string][] = [
  ['question mark', '?'],
  ['exclamation (?:mark|point)', '!'],
  ['full stop', '.'],
];

/**
 * "is it ready question mark" -> "is it ready?". Only at the end of a sentence: followed by
 * the end of the text, a line break, or a new sentence starting with a capital letter.
 */
function convertSentenceMarks(text: string): string {
  let result = text;
  for (const [spoken, mark] of SENTENCE_MARKS) {
    const pattern = new RegExp(
      `([\\p{L}\\p{N}"')\\]])[\\s,.]*${NOT_A_MENTION}${NOT_WORD_BEFORE}${anyCase(spoken)}${NOT_WORD_AFTER}[.!?,]*(?=\\s*$|\\s*\\n|\\s+["(]?\\p{Lu})`,
      'gu',
    );
    result = result.replace(pattern, (_, last: string) => `${last}${mark}`);
  }
  return result;
}

const MODIFIER_KEYS = ['ctrl', 'control', 'alt', 'shift', 'win', 'windows', 'cmd', 'command', 'option', 'fn'];
const OTHER_KEYS = ['tab', 'enter', 'return', 'esc', 'escape', 'delete', 'del', 'backspace', 'space', 'home', 'end', 'insert', 'up', 'down', 'left', 'right', 'f\\d{1,2}', '[a-z]', '\\d'];
const KEY = `(?:${[...MODIFIER_KEYS, ...OTHER_KEYS].join('|')})`;
const KEY_CHAIN = new RegExp(`${NOT_WORD_BEFORE}${KEY}(?:\\s+plus\\s+${KEY})+${NOT_WORD_AFTER}`, 'giu');
const MODIFIER = new RegExp(`${NOT_WORD_BEFORE}(?:${MODIFIER_KEYS.join('|')})${NOT_WORD_AFTER}`, 'iu');

/** "Control plus Shift plus T" -> "Control + Shift + T", when at least one key is a modifier. */
function convertKeyCombinations(text: string): string {
  return text.replace(KEY_CHAIN, chain => (MODIFIER.test(chain) ? chain.replace(/\s+plus\s+/giu, ' + ') : chain));
}

const NUMBER = '\\d[\\d,]*(?:\\.\\d+)?%?';
/** "into" is left out: "split 100 into 4 parts" is not a multiplication. */
const OPERATORS: [string, string][] = [
  ['plus', '+'],
  ['minus', '-'],
  ['times|multiplied by', '×'],
  ['divided by', '÷'],
  ['equals|is equal to', '='],
];

/** "2 plus 2 equals 4" -> "2 + 2 = 4". Only between numbers, so "plus, we need" stays. */
function convertArithmetic(text: string): string {
  let result = text;
  for (const [spoken, sign] of OPERATORS) {
    const pattern = new RegExp(`(${NUMBER})\\s+(?:${spoken})\\s+(?=\\d)`, 'giu');
    // Chains ("1 plus 2 plus 3") overlap, so apply until nothing changes.
    for (let pass = 0; pass < 5; pass += 1) {
      const next = result.replace(pattern, `$1 ${sign} `);
      if (next === result) {
        break;
      }
      result = next;
    }
  }
  return result;
}

const NAMED_SIGNS: [RegExp, string][] = [
  [new RegExp(`${NOT_WORD_BEFORE}c\\s+plus\\s+plus${NOT_WORD_AFTER}`, 'giu'), 'C++'],
  [new RegExp(`${NOT_WORD_BEFORE}and\\s+slash\\s+or${NOT_WORD_AFTER}`, 'giu'), 'and/or'],
  [new RegExp(`\\s+ampersand\\s+`, 'giu'), ' & '],
  [new RegExp(`${NOT_WORD_BEFORE}dot dot dot${NOT_WORD_AFTER}`, 'giu'), '...'],
];

/** Function words that cannot be a hashtag: "the hashtag is broken" stays as words. */
const NOT_A_TAG = '(?!(?:is|was|are|were|and|or|the|a|an|to|in|on|for|of|it|that|this|but|so|not)(?![\\p{L}\\p{N}]))';
/** "hashtag launch day" -> "#launch day": the tag is the single word after it. */
const NOT_A_NAMED_HASHTAG = `(?<!${NOT_WORD_BEFORE}(?:${anyCase('the|a|an|this|that|these|those|my|your|our|their|no|any')})\\s+)`;
const HASHTAG = new RegExp(`${NOT_A_NAMED_HASHTAG}${NOT_WORD_BEFORE}${anyCase('hash ?tag')}\\s+${NOT_A_TAG}([\\p{L}\\p{N}_]+)`, 'gu');

export function convertSpokenSymbols(text: string): string {
  let result = text;
  for (const pair of PAIRS) {
    result = convertPair(result, pair);
  }
  result = convertSentenceMarks(result);
  for (const [pattern, sign] of NAMED_SIGNS) {
    result = result.replace(pattern, sign);
  }
  result = convertKeyCombinations(result);
  result = convertArithmetic(result);
  result = result.replace(HASHTAG, (_, tag: string) => `#${tag}`);
  return result;
}

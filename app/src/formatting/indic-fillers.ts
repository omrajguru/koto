/**
 * Hindi and Marathi discourse words: "mhanje", "matlab", "toh", "na", "arre", "yaar", "bas".
 *
 * Each is filler in some sentences and meaning in others: "rocket mhanje viman" (X means Y),
 * "iska matlab", "tu aala toh sang" (then), "aao na" (softens a request), "na aana" (do not).
 * Removing a word that carries meaning is worse than leaving a filler in, so:
 * - the rules here remove only the unmistakable shape: a filler that opens a sentence and is
 *   followed by a pause (Saaras writes the pause as a comma), "Mhanje, mi yeu shaknar nahi";
 * - everything else is left to the AI polish step, which sees the whole sentence and is told
 *   the same examples (worker/src/polish.ts);
 * - `countAmbiguousIndicFillers` lets the "needs tidying" check notice when there are several.
 * Both English letters (Saaras translit) and Devanagari are covered.
 */

const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{M}\\p{N}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{M}\\p{N}])';

/** "I mean" / "that is" words. Filler when they open a thought, meaning between two words. */
const OPENING_FILLERS = ['mhanje', 'mhanaje', 'manje', 'matlab', 'matlb', 'म्हणजे', 'मतलब'];
/** Conjunctions kept when the filler after them goes: "Aani mhanje, ..." -> "Aani ...". */
const CONJUNCTIONS = ['aani', 'ani', 'aur', 'pan', 'par', 'and', 'but', 'आणि', 'और', 'पण', 'पर'];
/** "so": dropped only together with a filler that follows it ("Toh matlab, ..."). */
const SO_WORDS = ['toh', 'तो', 'तर'];

const OPENING_FILLER = new RegExp(
  `(^|[.!?।]\\s+|\\n\\s*)(?:(${CONJUNCTIONS.join('|')})\\s+)?(?:(?:${SO_WORDS.join('|')})\\s+)?(?:${OPENING_FILLERS.join('|')})${NOT_WORD_AFTER}\\s*,\\s*`,
  'giu',
);

/** Removes fillers that open a sentence and are followed by a pause. Nothing else. */
export function removeIndicFillers(text: string): string {
  return text.replace(OPENING_FILLER, (_, start: string, conjunction: string | undefined) =>
    conjunction ? `${start}${conjunction} ` : start,
  );
}

/**
 * Words that are often filler but can carry meaning. "toh" and "na" are left out: they carry
 * meaning far more often than not.
 */
const AMBIGUOUS_FILLER = new RegExp(
  `${NOT_WORD_BEFORE}(?:mhanje|mhanaje|manje|matlab|matlb|arre|yaar|म्हणजे|मतलब|अरे|यार)${NOT_WORD_AFTER}`,
  'giu',
);
/** Shapes where "matlab" or "mhanje" plainly means "meaning": "iska matlab", "mhanje kay?". */
const MEANING_SHAPES = new RegExp(
  `${NOT_WORD_BEFORE}(?:(?:iska|uska|jiska|kiska|tyacha|yacha|hyacha|ka|cha|इसका|उसका|याचा|त्याचा)\\s+matlab|matlab\\s+(?:kya|kay|hai|aahe)|mhanje\\s+(?:kay|kaay|kaya)|मतलब\\s+(?:क्या|है)|म्हणजे\\s+काय)${NOT_WORD_AFTER}`,
  'giu',
);

/** How many possible fillers remain, not counting uses that plainly mean "meaning". */
export function countAmbiguousIndicFillers(text: string): number {
  return (text.replace(MEANING_SHAPES, ' ').match(AMBIGUOUS_FILLER) ?? []).length;
}

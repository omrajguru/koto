/**
 * Hindi and Marathi numbers said as words, written as digits: "nau vaajta" -> "9 vaajta",
 * "saade paanch baje" -> "5:30 baje", "paanch sau rupaye" -> "500 rupaye". Saaras leaves them
 * as words in every mode ("Mi aaj raatri nau vaajta devila jaanar aahe").
 *
 * Many of these words mean something else too: "do" is English, "saath" is "with", "nav" is
 * "name", "ek divas" is "one day" as in "someday". So a number is converted only when a unit
 * follows it (o'clock, minutes, rupees, ...), never on its own. Covers English letters
 * (Saaras translit) and Devanagari.
 */

/** Spellings Saaras uses, Marathi and Hindi, in English letters and Devanagari. */
const NUMBER_WORDS: [number, string[]][] = [
  [1, ['ek', 'एक']],
  [2, ['do', 'don', 'दो', 'दोन']],
  [3, ['teen', 'tin', 'तीन']],
  [4, ['chaar', 'char', 'चार']],
  [5, ['paanch', 'panch', 'paach', 'pach', 'पाच', 'पांच', 'पाँच']],
  [6, ['chhah', 'chhe', 'chah', 'saha', 'छह', 'छः', 'सहा']],
  [7, ['saat', 'सात']],
  [8, ['aath', 'aat', 'आठ']],
  [9, ['nau', 'nav', 'नऊ', 'नौ']],
  [10, ['das', 'daha', 'दस', 'दहा']],
  [11, ['gyaarah', 'gyarah', 'akra', 'akraa', 'ग्यारह', 'अकरा']],
  [12, ['baarah', 'barah', 'baara', 'bara', 'बारह', 'बारा']],
  [13, ['terah', 'tera', 'teraa', 'तेरह', 'तेरा']],
  [14, ['chaudah', 'chauda', 'chaudaa', 'चौदह', 'चौदा']],
  [15, ['pandrah', 'pandra', 'pandhra', 'पंद्रह', 'पंधरा']],
  [16, ['solah', 'sola', 'solaa', 'सोलह', 'सोळा']],
  [17, ['satrah', 'satra', 'satraa', 'सत्रह', 'सतरा']],
  [18, ['athaarah', 'atharah', 'athra', 'athraa', 'अठारह', 'अठरा']],
  [19, ['unnees', 'unnis', 'ekonis', 'ekonees', 'उन्नीस', 'एकोणीस']],
  [20, ['bees', 'bis', 'vees', 'vis', 'बीस', 'वीस']],
  [25, ['pachchees', 'pachees', 'pachis', 'panchvees', 'pachvis', 'पच्चीस', 'पंचवीस']],
  [30, ['tees', 'tis', 'तीस']],
  [40, ['chaalees', 'chalees', 'chalis', 'chaalis', 'चालीस', 'चाळीस']],
  [50, ['pachaas', 'pachas', 'pannaas', 'pannas', 'पचास', 'पन्नास']],
  [60, ['saath', 'साठ']],
  [70, ['sattar', 'सत्तर']],
  [80, ['assi', 'aishi', 'ainshi', 'अस्सी', 'ऐंशी']],
  [90, ['nabbe', 'navvad', 'navad', 'नब्बे', 'नव्वद']],
];

/** Multiply what came before: "paanch sau" = 500, "do hazaar" = 2000. */
const MULTIPLIERS: [number, string[]][] = [
  [100, ['sau', 'shambhar', 'shambar', 'सौ', 'शंभर']],
  [1000, ['hazaar', 'hazar', 'hajaar', 'hajar', 'हज़ार', 'हजार']],
  [100000, ['lakh', 'laakh', 'लाख']],
  [10000000, ['crore', 'karod', 'karor', 'करोड़', 'कोटी']],
];

/** Half and quarter forms: "saade 9" = 9.5, "savva 9" = 9.25, "paune 9" = 8.75. */
const FRACTION_PREFIXES: [number, string[]][] = [
  [0.5, ['saade', 'saadhe', 'sadhe', 'sade', 'साडे', 'साढ़े', 'साढे']],
  [0.25, ['savva', 'sava', 'savaa', 'सव्वा', 'सवा']],
  [-0.25, ['paune', 'pavne', 'paavne', 'पावणे', 'पौने']],
];

/** Words that are already a fraction: "dedh" = 1.5, "adich" = 2.5. */
const FRACTION_WORDS: [number, string[]][] = [
  [1.5, ['dedh', 'didh', 'deedh', 'दीड', 'डेढ़', 'डेढ']],
  [2.5, ['adich', 'adhich', 'dhai', 'adhai', 'अडीच', 'ढाई']],
];

/** Units that make the word before them a number. Time of day writes halves as ":30". */
const TIME_OF_DAY = ['vaajta', 'vajta', 'vaajle', 'vajle', 'vaje', 'baje', 'bajke', 'वाजता', 'वाजले', 'वाजे', 'बजे', 'बजकर'];
const OTHER_UNITS = [
  'minute', 'minutes', 'minit', 'minat', 'minatat', 'minitat', 'mins', 'मिनिट', 'मिनिटे', 'मिनिटांत', 'मिनट',
  'ghanta', 'ghante', 'ghanton', 'taas', 'tasat', 'tasan', 'घंटा', 'घंटे', 'तास', 'तासात',
  'divas', 'divasat', 'divasaat', 'din', 'dino', 'दिवस', 'दिवसांत', 'दिन',
  'hafte', 'hafta', 'aathavde', 'aathavda', 'हफ्ते', 'आठवडे',
  'mahine', 'mahina', 'mahinyat', 'महीने', 'महिने',
  'saal', 'varsha', 'varshe', 'varshat', 'साल', 'वर्ष', 'वर्षे',
  'rupaye', 'rupay', 'rupee', 'rupees', 'rs', 'ruppe', 'रुपये', 'रुपए',
  'kilo', 'kg', 'km', 'litre', 'liter', 'किलो',
  'log', 'loka', 'lok', 'jan', 'jana', 'लोग', 'लोक', 'जण',
  'percent', 'takke', 'टक्के',
  'tarikh', 'taarikh', 'tareekh', 'तारीख',
];
/** "ek divas" and "ek din" usually mean "one day, someday", not a count. */
const NOT_AFTER_ONE = new Set(['divas', 'din', 'दिवस', 'दिन', 'saal', 'साल', 'varsha', 'वर्ष']);

function lookup(table: [number, string[]][]): Map<string, number> {
  const map = new Map<string, number>();
  for (const [value, words] of table) {
    for (const word of words) {
      map.set(word, value);
    }
  }
  return map;
}

const NUMBERS = lookup(NUMBER_WORDS);
const MULTIPLY = lookup(MULTIPLIERS);
const PREFIXES = lookup(FRACTION_PREFIXES);
const FRACTIONS = lookup(FRACTION_WORDS);
const TIME_UNITS = new Set(TIME_OF_DAY);
const UNITS = new Set([...TIME_OF_DAY, ...OTHER_UNITS]);

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokens(text: string): Token[] {
  return Array.from(text.matchAll(/[\p{L}\p{M}]+/gu), match => ({
    word: match[0].toLowerCase(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function formatValue(value: number, isTimeOfDay: boolean): string {
  if (isTimeOfDay && !Number.isInteger(value)) {
    const hours = Math.floor(value);
    return `${hours}:${String(Math.round((value - hours) * 60)).padStart(2, '0')}`;
  }
  return String(value);
}

/** Reads a spoken number starting at `index`: [prefix] (number | fraction word) [multiplier]. */
function readNumber(list: Token[], index: number): { value: number; next: number } | undefined {
  let position = index;
  const prefix = PREFIXES.get(list[position]?.word ?? '');
  if (prefix !== undefined) {
    position += 1;
  }
  let value = FRACTIONS.get(list[position]?.word ?? '');
  if (value === undefined) {
    const base = NUMBERS.get(list[position]?.word ?? '');
    if (base === undefined) {
      return undefined;
    }
    value = base + (prefix ?? 0);
  } else if (prefix !== undefined) {
    return undefined;
  }
  position += 1;
  const multiplier = MULTIPLY.get(list[position]?.word ?? '');
  if (multiplier !== undefined) {
    value *= multiplier;
    position += 1;
  }
  return { value, next: position };
}

export function convertIndicNumbers(text: string): string {
  const list = tokens(text);
  const replacements: { start: number; end: number; value: string }[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const number = readNumber(list, index);
    if (!number) {
      continue;
    }
    const unit = list[number.next];
    // Only words joined by a space count: "nau, vaajta" is not a time.
    const isAdjacent = unit && /^\s+$/.test(text.slice(list[number.next - 1].end, unit.start));
    if (!unit || !isAdjacent || !UNITS.has(unit.word)) {
      continue;
    }
    if (number.value === 1 && number.next === index + 1 && NOT_AFTER_ONE.has(unit.word)) {
      continue;
    }
    replacements.push({
      start: list[index].start,
      end: list[number.next - 1].end,
      value: formatValue(number.value, TIME_UNITS.has(unit.word)),
    });
    index = number.next - 1;
  }
  let result = text;
  for (const { start, end, value } of replacements.reverse()) {
    result = result.slice(0, start) + value + result.slice(end);
  }
  return result;
}

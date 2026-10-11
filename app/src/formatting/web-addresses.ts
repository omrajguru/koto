/**
 * Web and email addresses in dictation.
 *
 * Saaras usually writes an address it recognises ("youtube.com.", "icloud.com/mail."), but
 * spelled-out ones arrive as words ("ravi kumar dot com slash projects"). This joins those
 * into addresses, and the formatter uses `NOT_A_WEB_ADDRESS` so sentence capitalisation never
 * turns "youtube.com" into "Youtube.com". A dictation that is only an address loses its final
 * full stop, so it can be pasted straight into a browser or an email field.
 */

const TOP_LEVEL_DOMAINS = [
  'com', 'in', 'org', 'net', 'io', 'ai', 'dev', 'app', 'co', 'me', 'xyz', 'gov', 'edu', 'info', 'tv', 'so', 'gg',
  'ly', 'us', 'uk', 'cc', 'to', 'sh', 'fm', 'page', 'site', 'tech', 'store', 'online', 'live', 'design',
];
const TLD = `(?:${TOP_LEVEL_DOMAINS.join('|')})`;
const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?';
/** Mail providers: "ravi at gmail.com" is an email address, while "meet at google.com" is not. */
const MAIL_PROVIDERS = ['gmail', 'googlemail', 'yahoo', 'outlook', 'hotmail', 'live', 'icloud', 'me', 'proton', 'protonmail', 'pm', 'rediffmail', 'zoho', 'aol'];

/** A token that is a web or email address: "youtube.com", "a.b.co.in/x", "ravi@gmail.com", "https://x". */
const ADDRESS_TOKEN = new RegExp(
  `^(?:[a-z][a-z0-9+.-]*:\\/\\/\\S+|[^\\s@]+@${LABEL}(?:\\.${LABEL})*\\.${TLD}|(?:www\\.)?${LABEL}(?:\\.${LABEL})*\\.${TLD}(?:\\.(?:in|uk|au))?(?:[/?#]\\S*)?)$`,
  'iu',
);

/**
 * Regex source to place right after a captured letter that would be capitalised: fails when
 * that letter starts a web or email address.
 */
export const NOT_A_WEB_ADDRESS = `(?![\\p{L}\\p{N}._%+-]*(?:@|:\\/\\/|\\.${TLD}(?![\\p{L}\\p{N}])))`;

function joinSpokenDomain(spoken: string): string {
  return spoken.toLowerCase().replace(/\s+dot\s+/g, '.');
}

/**
 * "youtube dot com" -> "youtube.com". Only the single word before "dot" joins: whether "ravi
 * kumar dot com" means "ravikumar.com" cannot be told from the words, so that is left to
 * Saaras (which usually writes known sites itself) or the personal dictionary.
 */
const SPOKEN_DOMAIN = new RegExp(
  `(?<![\\p{L}\\p{N}])((?:www\\s+dot\\s+)?${LABEL}(?:\\s+dot\\s+${LABEL})*\\s+dot\\s+${TLD}(?:\\s+dot\\s+(?:in|uk|au))?)(?![\\p{L}\\p{N}])`,
  'giu',
);
const SPOKEN_SCHEME = /(?<![\p{L}\p{N}])(https?)\s*(?:colon|:)\s*(?:slash\s*slash|\/\/|forward slash forward slash)\s*/giu;
const SPOKEN_PATH = new RegExp(`(${LABEL}\\.${TLD}(?:\\.(?:in|uk|au))?)((?:\\s+(?:forward\\s+)?slash\\s+${LABEL})+)`, 'giu');
const SPOKEN_AT = '(?:at the rate(?: of)?|at sign|at symbol|@)';

export function joinSpokenWebAddresses(text: string): string {
  let result = text.replace(SPOKEN_SCHEME, (_, scheme: string) => `${scheme.toLowerCase()}://`);
  result = result.replace(SPOKEN_DOMAIN, spoken => joinSpokenDomain(spoken));
  result = result.replace(SPOKEN_PATH, (_, domain: string, path: string) =>
    domain + path.replace(/\s+(?:forward\s+)?slash\s+/giu, '/').toLowerCase(),
  );
  // "ravi at the rate gmail.com", and "ravi at gmail.com" for well-known mail providers.
  result = result.replace(
    new RegExp(`(?<![\\p{L}\\p{N}@.])(${LABEL}(?:[._]${LABEL})*)\\s+${SPOKEN_AT}\\s+(${LABEL}(?:\\.${LABEL})*\\.${TLD})(?![\\p{L}\\p{N}])`, 'giu'),
    (_, user: string, domain: string) => `${user.toLowerCase()}@${domain.toLowerCase()}`,
  );
  result = result.replace(
    new RegExp(`(?<![\\p{L}\\p{N}@.])(${LABEL}(?:[._]${LABEL})*)\\s+at\\s+((?:${MAIL_PROVIDERS.join('|')})\\.${TLD}(?:\\.(?:in|uk))?)(?![\\p{L}\\p{N}])`, 'giu'),
    (_, user: string, domain: string) => `${user.toLowerCase()}@${domain.toLowerCase()}`,
  );
  return result;
}

const WRITTEN_HOST = new RegExp(
  `(?<![\\p{L}\\p{N}@/.-])((?:https?:\\/\\/)?(?:${LABEL}\\.)+${TLD}(?:\\.(?:in|uk|au))?)(?![\\p{L}\\p{N}-])`,
  'giu',
);
const WRITTEN_EMAIL = new RegExp(`(?<![\\p{L}\\p{N}._%+-])[\\p{L}\\p{N}._%+-]+@(?:${LABEL}\\.)+${TLD}(?![\\p{L}\\p{N}-])`, 'giu');

/**
 * Saaras writes some sites with brand capitals ("YouTube.com"). Host names and email
 * addresses ignore case, so they are written in lowercase; paths keep theirs.
 */
export function lowercaseWebAddresses(text: string): string {
  return text.replace(WRITTEN_EMAIL, email => email.toLowerCase()).replace(WRITTEN_HOST, host => host.toLowerCase());
}

/** True when the whole dictation is one address, optionally followed by punctuation. */
export function isOnlyWebAddress(text: string): boolean {
  return ADDRESS_TOKEN.test(text.trim().replace(/[.,!?;:]+$/, ''));
}

/** "youtube.com." on its own becomes "youtube.com"; a sentence that ends in an address keeps its full stop. */
export function finishLoneWebAddress(text: string): string {
  return isOnlyWebAddress(text) ? text.trim().replace(/[.,!?;:]+$/, '') : text;
}

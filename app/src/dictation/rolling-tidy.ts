import { LONG_DICTATION_WORDS, wordCount } from '../formatting/polish-need';
import { applyWritingStyle } from '../formatting/writing-style';
import { preferencesStore } from '../storage/preferences';
import { type FinishedText, POLISH_TIME_LIMIT_MS, polishRuleText, tidyWithRules } from './text-finishing';

/**
 * Tidies a long dictation in parts while the person is still speaking, so only the last
 * part is left when they stop. Each part becomes its own paragraph.
 *
 * Segments (15 to 28 s of audio each) are transcribed while recording. Once the text not yet
 * tidied reaches PART_MINIMUM_WORDS and ends a sentence, it is tidied as one part, but only
 * after the next segment's text is known: a part never ends right before a correction
 * ("Sorry, Wednesday") or in the middle of a spoken list, which the rules need whole.
 */
export const PART_MINIMUM_WORDS = 40;
/** A part is tidied while the person keeps talking, so it can take longer than the final one. */
const PART_TIME_LIMIT_MS = 7000;
/** The final part of a long dictation is tidied even when it looks clean, if it is at least this long. */
const TAIL_MINIMUM_WORDS = 12;

/** The next segment continues (starts lowercase) or corrects the previous one, so they stay together. */
const STARTS_LOWERCASE = /^\p{Ll}/u;
const STARTS_WITH_CORRECTION = /^(?:sorry|no|nope|wait|actually|i mean|or rather|rather|scratch that|correction|instead)(?![\p{L}\p{N}])/iu;
/**
 * Spoken list markers the rules turn into lists ("First, ... Second, ..." at a clause start,
 * as in extractEnumeration) and layout commands; keep them in one part. "The second thing
 * is" is ordinary prose and does not count.
 */
const SPOKEN_LIST =
  /(?:(?:^|[.,;:!?]\s*|\s(?:and|then)\s+)(?:first|firstly|second|secondly|third|thirdly|number\s+(?:one|two|three)|one|two|three)\s*[,:.](?!\d))|(?<![\p{L}\p{N}])(?:bullet point|new line|new paragraph|next paragraph)(?![\p{L}\p{N}])/iu;

interface Part {
  ruleText: string;
  result: Promise<FinishedText>;
}

function join(parts: string[]): string {
  return parts.map(part => part.trim()).filter(Boolean).join(' ');
}

export class RollingTidy {
  private readonly jobs: Promise<string>[] = [];
  private readonly transcripts: string[] = [];
  private readonly parts: Part[] = [];
  /** First transcript not yet in a part. */
  private partStart = 0;
  private consuming: Promise<void> = Promise.resolve();
  private hasFailed = false;

  /** Adds the next segment's transcription, in recording order. */
  add(job: Promise<string>): void {
    this.jobs.push(job);
    this.consuming = this.consuming.then(() => this.consume());
  }

  private async consume(): Promise<void> {
    while (!this.hasFailed && this.transcripts.length < this.jobs.length) {
      try {
        this.transcripts.push((await this.jobs[this.transcripts.length]).trim());
      } catch {
        // The dictation reports the failure; nothing more to tidy.
        this.hasFailed = true;
        return;
      }
      this.cutPartIfReady();
    }
  }

  /** Tidies everything before the newest non-empty transcript, if it is a complete part. */
  private cutPartIfReady(): void {
    const newest = this.transcripts.length - 1;
    const following = this.transcripts[newest];
    if (!following || newest <= this.partStart) {
      return;
    }
    const raw = join(this.transcripts.slice(this.partStart, newest));
    if (
      wordCount(raw) < PART_MINIMUM_WORDS ||
      !/[.!?]["')\]]?$/.test(raw) ||
      SPOKEN_LIST.test(raw) ||
      SPOKEN_LIST.test(following) ||
      STARTS_LOWERCASE.test(following) ||
      STARTS_WITH_CORRECTION.test(following)
    ) {
      return;
    }
    const ruleText = tidyWithRules(raw);
    this.parts.push({ ruleText, result: polishRuleText(ruleText, { force: true, timeLimitMs: PART_TIME_LIMIT_MS }) });
    this.partStart = newest;
  }

  /**
   * Call once every segment has been added and has settled without failure. Waits at most
   * POLISH_TIME_LIMIT_MS for parts still being tidied (their rule-based text is used after
   * that) while the final part is tidied.
   */
  async finish(): Promise<FinishedText> {
    await this.consuming;
    const tailRaw = join(this.transcripts.slice(this.partStart));
    const totalWords = wordCount(join(this.transcripts));
    if (this.parts.length === 0) {
      return polishRuleText(tidyWithRules(tailRaw));
    }
    const tailRuleText = tidyWithRules(tailRaw);
    const isLong = totalWords >= LONG_DICTATION_WORDS;
    const tail = polishRuleText(tailRuleText, { force: isLong && wordCount(tailRuleText) >= TAIL_MINIMUM_WORDS });
    let expire: () => void = () => undefined;
    const deadline = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, POLISH_TIME_LIMIT_MS);
      expire = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    const finished = await Promise.all([
      ...this.parts.map(part => Promise.race([part.result, deadline.then(() => ({ text: part.ruleText }) as FinishedText)])),
      tail,
    ]);
    expire();
    // The style may have been switched mid-dictation; every paragraph follows the current one.
    const style = preferencesStore.get().writingStyle;
    const paragraphs = finished.map(piece => applyWritingStyle(piece.text, style).trim()).filter(Boolean);
    const unpolished = finished.map(piece => (piece.unpolishedText ?? piece.text).trim()).filter(Boolean);
    const text = paragraphs.join('\n\n');
    const unpolishedText = unpolished.join('\n\n');
    return finished.some(piece => piece.unpolishedText) ? { text, unpolishedText } : { text };
  }
}

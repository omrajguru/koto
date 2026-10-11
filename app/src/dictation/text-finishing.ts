import { polishText, warmPolish } from '../api/koto-api';
import { assessPolishNeed } from '../formatting/polish-need';
import { applyReplacements, formatTranscript } from '../formatting/transcript-formatter';
import { applyWritingStyle } from '../formatting/writing-style';
import { currentConnection } from '../storage/server-connection';
import { formattingOptions, preferencesStore } from '../storage/preferences';

/**
 * Turns a raw transcript into the text Koto inserts:
 * 1. rule-based clean-up (always, instant);
 * 2. the chosen writing style (rules);
 * 3. AI polish with Gemini, when a Gemini key is set and the result still reads like speech
 *    (or is long), and only if it answers within the time limit. Otherwise step 2's text is
 *    used, so the AI can never delay or lose a dictation.
 * Long dictations are tidied in parts while the person is still speaking (rolling-tidy.ts).
 */
export const POLISH_TIME_LIMIT_MS = 2500;
/** The server keeps the connection to Gemini warm for a few minutes after a request. */
const WARM_FOR_MS = 4 * 60 * 1000;

export interface FinishedText {
  text: string;
  /** Present when AI polish replaced the rule-based text, so history can show both. */
  unpolishedText?: string;
}

export interface PolishOptions {
  /** Polish even if the text looks clean (parts of long dictations). */
  force?: boolean;
  timeLimitMs?: number;
}

let lastWarmedAt = 0;

/** Called when recording starts. Cheap, and skipped when polish is off or recently warmed. */
export function warmPolishIfUseful(): void {
  const preferences = preferencesStore.get();
  const connection = currentConnection();
  if (preferences.polishMode === 'never' || !connection?.geminiApiKey || Date.now() - lastWarmedAt < WARM_FOR_MS) {
    return;
  }
  lastWarmedAt = Date.now();
  void warmPolish(connection).catch(() => {
    lastWarmedAt = 0;
  });
}

/** Steps 1 and 2: instant and always applied. */
export function tidyWithRules(rawTranscript: string): string {
  const preferences = preferencesStore.get();
  return applyWritingStyle(formatTranscript(rawTranscript, formattingOptions(preferences)), preferences.writingStyle);
}

/** Step 3 for text that has already been through the rules. Never throws. */
export async function polishRuleText(ruleText: string, options: PolishOptions = {}): Promise<FinishedText> {
  const preferences = preferencesStore.get();
  const connection = currentConnection();
  if (!ruleText || !connection?.geminiApiKey || preferences.polishMode === 'never') {
    return { text: ruleText };
  }
  if (!options.force && !assessPolishNeed(ruleText, preferences.polishMode).shouldPolish) {
    return { text: ruleText };
  }
  try {
    const result = await polishText({
      connection,
      text: ruleText,
      style: preferences.writingStyle,
      timeoutMs: options.timeLimitMs ?? POLISH_TIME_LIMIT_MS,
    });
    lastWarmedAt = Date.now();
    if (!result.isPolished || !result.text.trim()) {
      return { text: ruleText };
    }
    // Personal spellings and the style's rules win over the model's choices.
    const polished = applyWritingStyle(applyReplacements(result.text.trim(), preferences.replacements), preferences.writingStyle);
    return polished === ruleText ? { text: ruleText } : { text: polished, unpolishedText: ruleText };
  } catch {
    // Slow or unreachable: the rule-based text is already good enough to insert.
    return { text: ruleText };
  }
}

export async function finishText(rawTranscript: string, options: PolishOptions = {}): Promise<FinishedText> {
  return polishRuleText(tidyWithRules(rawTranscript), options);
}

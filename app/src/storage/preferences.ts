import type { IndicScript } from '../api/koto-api';
import type { PolishMode } from '../formatting/polish-need';
import type { FormattingOptions, WordReplacement } from '../formatting/transcript-formatter';
import type { WritingStyle } from '../formatting/writing-style';
import DesktopIntegration from '../native/NativeDesktopIntegration';
import { ObservableStore } from '../state/observable-store';

/** How long a voice note is kept after its text was delivered. Failed ones are always kept. */
export type VoiceNoteRetention = 'forever' | 'month' | 'week' | 'day';

export interface Preferences {
  /** Saaras language code, or 'unknown' to detect automatically. */
  languageCode: string;
  /** latin: "kal meeting hai"; native: Devanagari and other scripts; mixed: English words in English letters. */
  indicScript: IndicScript;
  removeFillerWords: boolean;
  applySelfCorrections: boolean;
  formatLists: boolean;
  /** Names and terms sent to Saaras as keyterms so they are spelled correctly. Saaras accepts up to 50. */
  vocabulary: string[];
  replacements: WordReplacement[];
  launchAtLogin: boolean;
  writingStyle: WritingStyle;
  /** auto: AI polish only when the text still reads like speech. */
  polishMode: PolishMode;
  voiceNoteRetention: VoiceNoteRetention;
  /** Microphone to record from; '' follows the Windows default. */
  microphoneId: string;
  /** Its name when last seen, for messages while it is unplugged. */
  microphoneName: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  languageCode: 'unknown',
  indicScript: 'latin',
  removeFillerWords: true,
  applySelfCorrections: true,
  formatLists: true,
  vocabulary: [],
  replacements: [],
  launchAtLogin: true,
  writingStyle: 'neutral',
  polishMode: 'auto',
  voiceNoteRetention: 'forever',
  microphoneId: '',
  microphoneName: '',
};

export const MAX_VOCABULARY_TERMS = 50;
const DOCUMENT_NAME = 'preferences.json';

export const preferencesStore = new ObservableStore<Preferences>(DEFAULT_PREFERENCES);

export async function loadPreferences(): Promise<void> {
  try {
    const stored = await DesktopIntegration.readDocument(DOCUMENT_NAME);
    if (stored) {
      preferencesStore.set({ ...DEFAULT_PREFERENCES, ...JSON.parse(stored) });
    }
  } catch (error) {
    console.warn('Preferences could not be read; using defaults.', error);
  }
}

export async function updatePreferences(change: Partial<Preferences>): Promise<void> {
  preferencesStore.set(current => ({ ...current, ...change }));
  await DesktopIntegration.writeDocument(DOCUMENT_NAME, JSON.stringify(preferencesStore.get()));
  if (change.launchAtLogin !== undefined) {
    await DesktopIntegration.setLaunchAtLogin(change.launchAtLogin).catch(error =>
      console.warn('Launch at login could not be changed.', error),
    );
  }
}

export function formattingOptions(preferences: Preferences): FormattingOptions {
  return {
    removeFillerWords: preferences.removeFillerWords,
    applySelfCorrections: preferences.applySelfCorrections,
    formatLists: preferences.formatLists,
    replacements: preferences.replacements,
  };
}

/** Vocabulary plus the written form of each replacement, deduplicated, capped at Saaras's limit. */
export function keytermsFor(preferences: Preferences): string[] {
  const terms = [...preferences.vocabulary, ...preferences.replacements.map(replacement => replacement.written)];
  const unique = Array.from(new Set(terms.map(term => term.trim()).filter(term => term.length > 0 && term.length <= 64)));
  return unique.slice(0, MAX_VOCABULARY_TERMS);
}

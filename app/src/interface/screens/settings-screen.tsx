import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { IndicScript } from '../../api/koto-api';
import {
  chooseMicrophone,
  isChosenMicrophoneMissing,
  microphoneOptions,
  microphonesStore,
  refreshMicrophones,
} from '../../audio/microphones';
import { backUpToCloud, backupStore, downloadBackup } from '../../backup/cloud-backup';
import type { PolishMode } from '../../formatting/polish-need';
import type { WritingStyle } from '../../formatting/writing-style';
import DesktopIntegration from '../../native/NativeDesktopIntegration';
import { connectionStore, forgetConnection } from '../../storage/server-connection';
import { pruneDeliveredAudio } from '../../storage/dictation-history';
import { preferencesStore, updatePreferences, type VoiceNoteRetention } from '../../storage/preferences';
import { useStore } from '../../state/observable-store';
import {
  appInfoStore,
  checkForUpdates,
  describeInstalledVersion,
  displayVersion,
  installUpdate,
  updateStore,
  type UpdateState,
} from '../../updates/app-updates';
import { ServerSettingsForm } from '../server-settings';
import { updateActionLabel } from '../update-notice';
import { formatTime } from './history-screen';
import { Action, Divider, Select, type SelectOption, Text, Toggle } from '../controls';
import { space } from '../theme';

const LANGUAGE_OPTIONS: SelectOption[] = [
  { value: 'unknown', label: 'Detect automatically' },
  { value: 'en-IN', label: 'English' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'bn-IN', label: 'Bengali' },
  { value: 'gu-IN', label: 'Gujarati' },
  { value: 'kn-IN', label: 'Kannada' },
  { value: 'ml-IN', label: 'Malayalam' },
  { value: 'mr-IN', label: 'Marathi' },
  { value: 'od-IN', label: 'Odia' },
  { value: 'pa-IN', label: 'Punjabi' },
  { value: 'ta-IN', label: 'Tamil' },
  { value: 'te-IN', label: 'Telugu' },
  { value: 'ur-IN', label: 'Urdu' },
  { value: 'as-IN', label: 'Assamese' },
  { value: 'ne-IN', label: 'Nepali' },
  { value: 'kok-IN', label: 'Konkani' },
  { value: 'mai-IN', label: 'Maithili' },
  { value: 'sa-IN', label: 'Sanskrit' },
];

const SCRIPT_OPTIONS: SelectOption[] = [
  { value: 'latin', label: 'English letters (kal meeting hai)' },
  { value: 'mixed', label: 'Mixed (English words in English letters)' },
  { value: 'native', label: 'Their own script (कल meeting है)' },
];

function describeUpdateState(update: UpdateState): string {
  switch (update.status) {
    case 'checking':
      return 'Checking for updates.';
    case 'upToDate':
      return 'Koto is up to date.';
    case 'available':
      return `Koto ${displayVersion(update.version)} is available.`;
    case 'installing':
      return 'Installing. Koto will close and reopen.';
    case 'failed':
      return update.message;
    case 'unsupported':
      return 'This development build does not update itself.';
    default:
      return '';
  }
}

function AboutSection() {
  const appInfo = useStore(appInfoStore);
  const update = useStore(updateStore);
  const status = describeUpdateState(update);
  return (
    <View style={styles.section}>
      <Text variant="heading">About</Text>
      {appInfo ? (
        <Text variant="mono" tone="secondary">
          {describeInstalledVersion(appInfo)} · {appInfo.architecture}
        </Text>
      ) : null}
      {status ? (
        <Text tone={update.status === 'failed' ? 'error' : 'secondary'} accessibilityLiveRegion="polite">
          {status}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {update.status === 'available' || (update.status === 'failed' && update.version) ? (
          <Action label={updateActionLabel()} variant="primary" onPress={() => void installUpdate()} />
        ) : (
          <Action
            label="Check for updates"
            isDisabled={update.status === 'checking' || update.status === 'installing' || update.status === 'unsupported'}
            onPress={() => void checkForUpdates({ isUserRequested: true })}
          />
        )}
      </View>
    </View>
  );
}

const WRITING_STYLE_OPTIONS: SelectOption[] = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
];

const WRITING_STYLE_DESCRIPTIONS: Record<WritingStyle, string> = {
  neutral: 'Written as you said it, cleaned up.',
  casual: 'For chat: “by the way” becomes BTW, and short messages drop the final full stop.',
  formal: 'For email and documents: no contractions, slang or chat abbreviations, and no “Okay.” or “So yeah.”',
};

const POLISH_OPTIONS: SelectOption[] = [
  { value: 'auto', label: 'When needed' },
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never' },
];

function WritingSection() {
  const preferences = useStore(preferencesStore);
  return (
    <View style={styles.section}>
      <Text variant="heading">Writing</Text>
      <Select
        label="Writing style"
        value={preferences.writingStyle}
        options={WRITING_STYLE_OPTIONS}
        onChange={value => void updatePreferences({ writingStyle: value as WritingStyle })}
      />
      <Text tone="secondary">
        {WRITING_STYLE_DESCRIPTIONS[preferences.writingStyle]} To switch while dictating, right-click the orb, or use
        Writing style in the tray icon's menu.
      </Text>
      <Select
        label="Tidy sentences with AI"
        value={preferences.polishMode}
        options={POLISH_OPTIONS}
        onChange={value => void updatePreferences({ polishMode: value as PolishMode })}
      />
      <Text tone="secondary">
        When a dictation still reads like speech after clean-up (restarts, trailing thoughts, long run-on sentences), it is
        sent to Google Gemini to restructure. If that takes longer than 2.5 seconds, the cleaned-up text is used instead.
        Needs a Gemini API key in Server settings.
      </Text>
    </View>
  );
}

const RETENTION_OPTIONS: SelectOption[] = [
  { value: 'forever', label: 'Forever' },
  { value: 'month', label: '30 days' },
  { value: 'week', label: '7 days' },
  { value: 'day', label: '1 day' },
];

function VoiceNotesSection() {
  const preferences = useStore(preferencesStore);
  const [folder, setFolder] = useState('');

  useEffect(() => {
    DesktopIntegration.getVoiceNotesFolder().then(setFolder, () => setFolder(''));
  }, []);

  return (
    <View style={styles.section}>
      <Text variant="heading">Voice notes</Text>
      <Select
        label="Keep voice notes"
        value={preferences.voiceNoteRetention}
        options={RETENTION_OPTIONS}
        onChange={voiceNoteRetention =>
          void updatePreferences({ voiceNoteRetention: voiceNoteRetention as VoiceNoteRetention }).then(() => pruneDeliveredAudio())
        }
      />
      <Text tone="secondary">
        Every recording is saved as a WAV file, about 2 MB per minute. Recordings that could not be transcribed are kept
        until you transcribe or delete them.
      </Text>
      {folder ? (
        <Text variant="mono" tone="secondary">
          {folder}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Action label="Open folder" onPress={() => DesktopIntegration.openVoiceNotesFolder()} />
      </View>
      <CloudBackup />
    </View>
  );
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB` : `${Math.round(bytes / (1024 * 1024))} MB`;
}

function CloudBackup() {
  const backup = useStore(backupStore);
  const isBusy = backup.phase !== 'idle';
  const status =
    backup.phase === 'backingUp'
      ? backup.total > 0
        ? `Backing up ${Math.min(backup.done + 1, backup.total)} of ${backup.total}. You can close this window; it continues in the background.`
        : 'Checking what is already backed up.'
      : backup.phase === 'preparingDownload'
        ? 'Preparing the download link.'
        : backup.message;
  const details = [
    backup.usedBytes !== undefined && backup.quotaBytes ? `${formatSize(backup.usedBytes)} of ${formatSize(backup.quotaBytes)} used` : '',
    backup.lastBackedUpAt ? `Last backed up ${formatTime(backup.lastBackedUpAt)}` : 'Not backed up yet',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.subsection}>
      <Text variant="label">Cloud backup</Text>
      <Text tone="secondary">
        Copies voice notes, history and preferences to the storage of your Koto server. Server settings and keys are never included. Deleting a voice note on this PC keeps its cloud copy.
      </Text>
      <Text variant="mono" tone="secondary">
        {details}
      </Text>
      {status ? <Text tone={backup.isError && !isBusy ? 'error' : 'secondary'}>{status}</Text> : null}
      <View style={styles.actionRow}>
        <Action label="Back up now" isDisabled={isBusy} onPress={() => void backUpToCloud()} />
        <Action label="Download backup (.zip)" isDisabled={isBusy} onPress={() => void downloadBackup()} />
      </View>
    </View>
  );
}

function MicrophoneSection() {
  const preferences = useStore(preferencesStore);
  const microphones = useStore(microphonesStore);
  const isMissing = isChosenMicrophoneMissing(microphones, preferences.microphoneId);

  useEffect(() => {
    // Also kept current by device-change events while Settings is open.
    void refreshMicrophones();
  }, []);

  return (
    <View style={styles.section}>
      <Select
        label="Microphone"
        value={preferences.microphoneId}
        options={microphoneOptions(microphones, preferences.microphoneId, preferences.microphoneName)}
        onChange={id => void chooseMicrophone(id)}
      />
      <Text tone={isMissing ? 'error' : 'secondary'}>
        {isMissing
          ? 'Not connected. Koto records with the Windows default until it is plugged back in, then switches back on its own.'
          : microphones.isLoaded && microphones.microphones.length === 0
            ? 'No microphone is connected.'
            : 'Also in the tray menu, and in the orb’s right-click menu while recording. A change applies from the next dictation.'}
      </Text>
    </View>
  );
}

export function SettingsScreen() {
  const preferences = useStore(preferencesStore);
  const connection = useStore(connectionStore);

  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <Text variant="title">Settings</Text>

      <MicrophoneSection />

      <View style={styles.section}>
        <Select
          label="Spoken language"
          value={preferences.languageCode}
          options={LANGUAGE_OPTIONS}
          onChange={languageCode => void updatePreferences({ languageCode })}
        />
        <Text tone="secondary">Detecting automatically works for mixed Hindi and English. Choose a language if words are being written in the wrong script.</Text>
        <Select
          label="Write Hindi, Marathi and other Indian languages in"
          value={preferences.indicScript}
          options={SCRIPT_OPTIONS}
          onChange={indicScript => void updatePreferences({ indicScript: indicScript as IndicScript })}
        />
        <Text tone="secondary">English dictation is written the same way whichever you choose.</Text>
      </View>

      <Divider />

      <WritingSection />

      <Divider />

      <View style={styles.section}>
        <Text variant="heading">Formatting</Text>
        <Toggle
          label="Remove filler words"
          description="Removes um, uh and similar sounds."
          isOn={preferences.removeFillerWords}
          onChange={removeFillerWords => void updatePreferences({ removeFillerWords })}
        />
        <Toggle
          label="Apply spoken corrections"
          description="When you correct yourself (“John, sorry, it’s not John, it’s Om”), only the corrected words are kept."
          isOn={preferences.applySelfCorrections}
          onChange={applySelfCorrections => void updatePreferences({ applySelfCorrections })}
        />
        <Toggle
          label="Format lists"
          description="Turns “first, second, third” into a numbered list, and “bullet point”, “new line” and “new paragraph” into layout."
          isOn={preferences.formatLists}
          onChange={formatLists => void updatePreferences({ formatLists })}
        />
      </View>

      <Divider />

      <VoiceNotesSection />

      <Divider />

      <View style={styles.section}>
        <Text variant="heading">System</Text>
        <Toggle
          label="Open at login"
          description="Koto runs in the background so the hotkey works without the window open."
          isOn={preferences.launchAtLogin}
          onChange={launchAtLogin => void updatePreferences({ launchAtLogin })}
        />
      </View>

      <Divider />

      <AboutSection />

      <Divider />

      <View style={styles.section}>
        <Text variant="heading">Server</Text>
        <ServerSettingsForm />
        {connection.status === 'ready' ? (
          <View style={styles.actions}>
            <Action label="Remove server settings" variant="destructive" onPress={() => void forgetConnection()} />
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.xxl, gap: space.xl, maxWidth: 720 },
  section: { gap: space.md },
  actions: { flexDirection: 'row' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  subsection: { gap: space.sm, marginTop: space.md },
});

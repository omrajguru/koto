import React, { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { ApiError, checkServer } from '../api/koto-api';
import { dictationService } from '../dictation/dictation-service';
import { historyStore } from '../storage/dictation-history';
import {
  connectionStore,
  describeConnectionProblem,
  normaliseConnection,
  saveConnection,
  type ServerConnection,
  SETTINGS_FIXABLE_FAILURE,
} from '../storage/server-connection';
import { useStore } from '../state/observable-store';
import { Action, Text, TextField } from './controls';
import { space } from './theme';

export const SETUP_GUIDE_URL = 'https://github.com/omrajguru/koto#set-up-your-server';

const EMPTY_CONNECTION: ServerConnection = { serverUrl: '', accessKey: '', sarvamApiKey: '', geminiApiKey: '' };

/** Recordings that failed only because the server was not set up, or a key was wrong, are transcribed again. */
function retryRecordingsAwaitingSettings(): void {
  const waiting = historyStore
    .get()
    .filter(record => record.status === 'failed' && record.audioPath && SETTINGS_FIXABLE_FAILURE.test(record.failureReason ?? ''));
  for (const record of waiting) {
    void dictationService.retry(record.id, 'saveOnly');
  }
}

type FormStatus = { status: 'editing' } | { status: 'checking' } | { status: 'saved'; hasBackup: boolean } | { status: 'failed'; message: string };

/** Server address, access key and API keys. Checked against the server before they are saved. */
export function ServerSettingsForm() {
  const saved = useStore(connectionStore);
  const [form, setForm] = useState<ServerConnection>(saved.status === 'ready' ? saved.connection : EMPTY_CONNECTION);
  const [formStatus, setFormStatus] = useState<FormStatus>({ status: 'editing' });
  const isChecking = formStatus.status === 'checking';

  const edit = (field: keyof ServerConnection) => (value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    if (formStatus.status !== 'checking') {
      setFormStatus({ status: 'editing' });
    }
  };

  const save = async () => {
    const connection = normaliseConnection(form);
    const problem = describeConnectionProblem(connection);
    if (problem) {
      setFormStatus({ status: 'failed', message: problem });
      return;
    }
    setFormStatus({ status: 'checking' });
    try {
      const server = await checkServer(connection);
      await saveConnection(connection);
      setForm(connection);
      setFormStatus({ status: 'saved', hasBackup: server.backup });
      retryRecordingsAwaitingSettings();
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 401
          ? 'The server did not accept this access key. Use the one you chose when deploying it.'
          : error instanceof Error
            ? error.message
            : 'Unable to reach your Koto server.';
      setFormStatus({ status: 'failed', message });
    }
  };

  return (
    <View style={styles.form}>
      <TextField
        label="Server address"
        value={form.serverUrl}
        onChangeText={edit('serverUrl')}
        placeholder="https://koto-server.example.workers.dev"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField label="Access key" value={form.accessKey} onChangeText={edit('accessKey')} secureTextEntry autoCorrect={false} />
      <TextField label="Sarvam API key" value={form.sarvamApiKey} onChangeText={edit('sarvamApiKey')} secureTextEntry autoCorrect={false} />
      <TextField
        label="Gemini API key (optional)"
        value={form.geminiApiKey}
        onChangeText={edit('geminiApiKey')}
        secureTextEntry
        autoCorrect={false}
      />
      <Text tone="secondary">
        Keys are kept in Windows Credential Manager on this PC and sent only to your server, which uses them for each request
        and stores none of them. Without a Gemini key, dictation is tidied by Koto&apos;s own rules.
      </Text>
      {formStatus.status === 'failed' ? (
        <Text tone="error" accessibilityLiveRegion="polite">
          {formStatus.message}
        </Text>
      ) : formStatus.status === 'saved' ? (
        <Text tone="secondary" accessibilityLiveRegion="polite">
          {formStatus.hasBackup ? 'Connected. Settings saved.' : 'Connected. Settings saved. Cloud backup is not set up on this server.'}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Action
          label={isChecking ? 'Connecting' : 'Save and connect'}
          variant="primary"
          isDisabled={isChecking}
          onPress={() => void save()}
        />
        <Action label="Server setup guide" variant="quiet" onPress={() => void Linking.openURL(SETUP_GUIDE_URL)} />
      </View>
    </View>
  );
}

/** First run: shown until a server is connected. Dictation still records meanwhile. */
export function SetupScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        <Text variant="title">Connect your server</Text>
        <Text variant="lede" tone="secondary" style={styles.lede}>
          Koto sends your speech to Sarvam through a small server in your own Cloudflare account. Deploy it from the setup
          guide, then enter its address and your keys. You can dictate before this is done; recordings are kept and
          transcribed once Koto is connected.
        </Text>
        <ServerSettingsForm />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.xxl, paddingVertical: space.xxl },
  content: { maxWidth: 560 },
  lede: { marginTop: space.sm, marginBottom: space.xl },
  form: { gap: space.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});

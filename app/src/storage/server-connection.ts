import DesktopIntegration from '../native/NativeDesktopIntegration';
import { ObservableStore } from '../state/observable-store';

/**
 * Where Koto sends audio and text: the person's own Koto server on Cloudflare, plus their
 * own Sarvam and Gemini keys. Everything is kept in Windows Credential Manager, never in
 * Koto's documents, so backups and history files never contain a key.
 */
export interface ServerConnection {
  /** For example https://koto-server.example.workers.dev */
  serverUrl: string;
  /** Chosen when the server was deployed. */
  accessKey: string;
  sarvamApiKey: string;
  /** Optional: without it, dictation is tidied by rules only. */
  geminiApiKey: string;
}

export type ConnectionState = { status: 'loading' } | { status: 'notSetUp' } | { status: 'ready'; connection: ServerConnection };

const SECRET_KEY = 'koto.server-connection';

/** Failure reasons that settings can fix; such recordings are transcribed again after saving. */
export const SETTINGS_FIXABLE_FAILURE = /koto settings/i;

export const connectionStore = new ObservableStore<ConnectionState>({ status: 'loading' });

/** Trims what was typed and removes a trailing slash, so pasted addresses work as they are. */
export function normaliseConnection(input: ServerConnection): ServerConnection {
  return {
    serverUrl: input.serverUrl.trim().replace(/\/+$/, ''),
    accessKey: input.accessKey.trim(),
    sarvamApiKey: input.sarvamApiKey.trim(),
    geminiApiKey: input.geminiApiKey.trim(),
  };
}

/** What is missing or wrong in the form, or undefined when it can be tried. */
export function describeConnectionProblem(connection: ServerConnection): string | undefined {
  if (!/^https:\/\/[^\s/]+\.[^\s/]+$/i.test(connection.serverUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(connection.serverUrl)) {
    return 'Enter the server address starting with https://, as shown on the server’s page in Cloudflare.';
  }
  if (connection.accessKey.length < 16) {
    return 'The access key is at least 16 characters. Use the one you chose when deploying the server.';
  }
  if (!connection.sarvamApiKey) {
    return 'Add your Sarvam API key. Koto uses it to turn speech into text.';
  }
  return undefined;
}

function isComplete(value: Partial<ServerConnection> | undefined): value is ServerConnection {
  return Boolean(value && value.serverUrl && value.accessKey && value.sarvamApiKey);
}

export async function loadConnection(): Promise<void> {
  try {
    const stored = await DesktopIntegration.readSecret(SECRET_KEY);
    const parsed = stored ? (JSON.parse(stored) as Partial<ServerConnection>) : undefined;
    if (isComplete(parsed)) {
      connectionStore.set({ status: 'ready', connection: { ...parsed, geminiApiKey: parsed.geminiApiKey ?? '' } });
      return;
    }
  } catch (error) {
    console.warn('Saved server settings could not be read.', error);
  }
  connectionStore.set({ status: 'notSetUp' });
}

export async function saveConnection(connection: ServerConnection): Promise<void> {
  await DesktopIntegration.writeSecret(SECRET_KEY, JSON.stringify(connection));
  connectionStore.set({ status: 'ready', connection });
}

export async function forgetConnection(): Promise<void> {
  await DesktopIntegration.deleteSecret(SECRET_KEY).catch(() => undefined);
  connectionStore.set({ status: 'notSetUp' });
}

export function currentConnection(): ServerConnection | undefined {
  const state = connectionStore.get();
  return state.status === 'ready' ? state.connection : undefined;
}

/** Resolves once the saved settings have been read at startup. */
export function connectionLoaded(): Promise<void> {
  if (connectionStore.get().status !== 'loading') {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const unsubscribe = connectionStore.subscribe(() => {
      if (connectionStore.get().status !== 'loading') {
        unsubscribe();
        resolve();
      }
    });
  });
}

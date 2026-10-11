import { LATEST_RELEASE_URL } from '../configuration/environment';
import { activityStore } from '../dictation/dictation-service';
import DesktopIntegration from '../native/NativeDesktopIntegration';
import { ObservableStore } from '../state/observable-store';

/**
 * In-app updates from Koto's GitHub releases. Each release carries a signed MSIX per
 * architecture (Koto-x64.msix, Koto-ARM64.msix); Windows downloads and installs it, closes
 * Koto and reopens it. Every build is signed with the same certificate, which is what lets
 * Windows accept a new version as an update to the installed one.
 */
export type UpdateState =
  | { status: 'unknown' }
  | { status: 'checking' }
  | { status: 'upToDate'; checkedAt: number }
  | { status: 'available'; version: string; notes: string }
  | { status: 'installing'; version: string }
  | { status: 'failed'; message: string; version?: string }
  /** Development builds have no package identity and cannot update themselves. */
  | { status: 'unsupported' };

export interface AppInfo {
  version: string;
  architecture: string;
  isPackaged: boolean;
}

export interface ReleaseOffer {
  version: string;
  notes: string;
  downloadUrl: string;
}

export const appInfoStore = new ObservableStore<AppInfo | undefined>(undefined);
export const updateStore = new ObservableStore<UpdateState>({ status: 'unknown' });

/** "1.0.12.0" -> "1.0.12". Builds always end in .0, so the fourth part is noise in the interface. */
export function displayVersion(version: string): string {
  return version.replace(/\.0$/, '');
}

export function describeInstalledVersion(info: AppInfo): string {
  return `Version ${displayVersion(info.version)}`;
}

/** Compares dotted versions numerically: 1.0.10 is newer than 1.0.9. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

interface GitHubRelease {
  tag_name?: string;
  body?: string | null;
  draft?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

/** The newer build for this PC in a GitHub release, if there is one. */
export function offerFromRelease(release: GitHubRelease, info: AppInfo): ReleaseOffer | undefined {
  const version = (release.tag_name ?? '').replace(/^v/, '');
  if (release.draft || !/^\d+(\.\d+){1,3}$/.test(version) || compareVersions(version, info.version) <= 0) {
    return undefined;
  }
  const assetName = `koto-${info.architecture}.msix`.toLowerCase();
  const asset = release.assets?.find(item => item.name?.toLowerCase() === assetName);
  if (!asset?.browser_download_url?.startsWith('https://')) {
    return undefined;
  }
  return { version, notes: (release.body ?? '').trim(), downloadUrl: asset.browser_download_url };
}

async function fetchLatestOffer(info: AppInfo): Promise<ReleaseOffer | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: { accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (response.status === 404) {
      // Nothing published yet.
      return undefined;
    }
    if (!response.ok) {
      throw new Error('Could not check for updates. Try again later.');
    }
    return offerFromRelease((await response.json()) as GitHubRelease, info);
  } catch (error) {
    throw error instanceof Error && error.message.startsWith('Could not') ? error : new Error('Could not check for updates. Check your connection.');
  } finally {
    clearTimeout(timeout);
  }
}

async function loadAppInfo(): Promise<AppInfo> {
  const cached = appInfoStore.get();
  if (cached) {
    return cached;
  }
  const parsed = JSON.parse(await DesktopIntegration.getAppInfo()) as Partial<AppInfo>;
  const info: AppInfo = {
    version: parsed.version ?? '0.0.0.0',
    architecture: parsed.architecture ?? 'x64',
    isPackaged: Boolean(parsed.isPackaged),
  };
  appInfoStore.set(info);
  return info;
}

/**
 * Checks for a newer build. Quiet by default: background checks never show errors,
 * since a missed check costs nothing. `isUserRequested` reports failures.
 */
export async function checkForUpdates({ isUserRequested = false } = {}): Promise<void> {
  const state = updateStore.get();
  if (state.status === 'checking' || state.status === 'installing') {
    return;
  }
  const info = await loadAppInfo();
  if (!info.isPackaged) {
    updateStore.set({ status: 'unsupported' });
    return;
  }
  updateStore.set({ status: 'checking' });
  try {
    const offer = await fetchLatestOffer(info);
    updateStore.set(
      offer ? { status: 'available', version: offer.version, notes: offer.notes } : { status: 'upToDate', checkedAt: Date.now() },
    );
  } catch (error) {
    if (isUserRequested) {
      updateStore.set({ status: 'failed', message: error instanceof Error ? error.message : 'Could not check for updates.' });
    } else {
      // Keep whatever was known before the failed background check.
      updateStore.set(state);
    }
  }
}

/** Installing restarts Koto, so it waits until no dictation is in progress. */
export function isSafeToRestart(): boolean {
  const activity = activityStore.get();
  return activity.phase === 'idle' && activity.processingCount === 0;
}

export async function installUpdate(): Promise<void> {
  const state = updateStore.get();
  if (state.status !== 'available' && state.status !== 'failed') {
    return;
  }
  const { version } = state;
  if (!isSafeToRestart()) {
    updateStore.set({ status: 'failed', message: 'Finish the current dictation, then update.', version });
    return;
  }
  const info = await loadAppInfo();
  updateStore.set({ status: 'installing', version: version ?? '' });
  try {
    // Asked again, in case a newer release appeared since the last check.
    const offer = await fetchLatestOffer(info);
    if (!offer) {
      updateStore.set({ status: 'upToDate', checkedAt: Date.now() });
      return;
    }
    await DesktopIntegration.installUpdate(offer.downloadUrl);
    // Normally unreachable: Windows closes Koto to install. If it deferred instead, the
    // new version starts the next time Koto opens.
    updateStore.set({
      status: 'failed',
      message: 'The update is ready and will be used the next time Koto opens.',
      version: offer.version,
    });
  } catch (error) {
    updateStore.set({
      status: 'failed',
      message: error instanceof Error ? error.message : 'The update could not be installed.',
      version,
    });
  }
}

/** Tells the native side this JavaScript started properly (it keeps the built-in bundle in use). */
export function confirmHealthyStart(): void {
  DesktopIntegration.confirmBundleHealthy();
}

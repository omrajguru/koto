const mockNative = {
  getAppInfo: jest.fn(async () => JSON.stringify({ version: '1.0.7.0', architecture: 'ARM64', isPackaged: true })),
  installUpdate: jest.fn(async () => undefined),
  confirmBundleHealthy: jest.fn(),
  onHotkey: jest.fn(),
  onAudioFrame: jest.fn(),
  onRecordingError: jest.fn(),
};
jest.mock('../src/native/NativeDesktopIntegration', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));

import { LATEST_RELEASE_URL } from '../src/configuration/environment';
import { activityStore } from '../src/dictation/dictation-service';
import {
  appInfoStore,
  checkForUpdates,
  compareVersions,
  describeInstalledVersion,
  displayVersion,
  installUpdate,
  offerFromRelease,
  updateStore,
} from '../src/updates/app-updates';

const RELEASE = {
  tag_name: 'v1.0.12',
  body: 'Faster pasting.',
  assets: [
    { name: 'Koto-x64.msix', browser_download_url: 'https://github.com/omrajguru/koto/releases/download/v1.0.12/Koto-x64.msix' },
    { name: 'Koto-ARM64.msix', browser_download_url: 'https://github.com/omrajguru/koto/releases/download/v1.0.12/Koto-ARM64.msix' },
  ],
};
const ARM64 = { version: '1.0.7.0', architecture: 'ARM64', isPackaged: true };

const mockFetch = jest.fn();

function respondWith(release: object, status = 200) {
  mockFetch.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => release });
}

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  appInfoStore.set(undefined);
  updateStore.set({ status: 'unknown' });
  activityStore.set({ phase: 'idle', processingCount: 0 });
});

it('shows versions without the trailing build part', () => {
  expect(displayVersion('1.0.12.0')).toBe('1.0.12');
  expect(displayVersion('1.2.0.0')).toBe('1.2.0');
  expect(describeInstalledVersion(ARM64)).toBe('Version 1.0.7');
});

it('compares versions numerically', () => {
  expect(compareVersions('1.0.10', '1.0.9.0')).toBeGreaterThan(0);
  expect(compareVersions('1.0.12', '1.0.12.0')).toBe(0);
  expect(compareVersions('1.0.7.0', '1.0.12')).toBeLessThan(0);
});

it('offers only a newer release with a package for this architecture', () => {
  expect(offerFromRelease(RELEASE, ARM64)).toEqual({
    version: '1.0.12',
    notes: 'Faster pasting.',
    downloadUrl: 'https://github.com/omrajguru/koto/releases/download/v1.0.12/Koto-ARM64.msix',
  });
  expect(offerFromRelease(RELEASE, { ...ARM64, version: '1.0.12.0' })).toBeUndefined();
  expect(offerFromRelease({ ...RELEASE, assets: RELEASE.assets.slice(0, 1) }, ARM64)).toBeUndefined();
  expect(offerFromRelease({ ...RELEASE, tag_name: 'nightly' }, ARM64)).toBeUndefined();
  expect(offerFromRelease({ ...RELEASE, draft: true }, ARM64)).toBeUndefined();
});

it('reports an available update from the latest release', async () => {
  respondWith(RELEASE);
  await checkForUpdates();
  expect(mockFetch).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.anything());
  expect(updateStore.get()).toEqual({ status: 'available', version: '1.0.12', notes: 'Faster pasting.' });
});

it('reports up to date, including when nothing is published yet', async () => {
  respondWith({ ...RELEASE, tag_name: 'v1.0.7' });
  await checkForUpdates();
  expect(updateStore.get().status).toBe('upToDate');
  respondWith({ message: 'Not Found' }, 404);
  await checkForUpdates();
  expect(updateStore.get().status).toBe('upToDate');
});

it('treats development builds as unable to update', async () => {
  mockNative.getAppInfo.mockResolvedValueOnce(JSON.stringify({ version: '0.0.0.0', architecture: 'x64', isPackaged: false }));
  await checkForUpdates();
  expect(updateStore.get().status).toBe('unsupported');
  expect(mockFetch).not.toHaveBeenCalled();
});

it('stays quiet when a background check fails, but reports a requested one', async () => {
  mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
  await checkForUpdates();
  expect(updateStore.get().status).toBe('unknown');

  mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
  await checkForUpdates({ isUserRequested: true });
  expect(updateStore.get()).toEqual({ status: 'failed', message: 'Could not check for updates. Check your connection.' });
});

it('installs the package for this architecture from the newest release', async () => {
  respondWith(RELEASE);
  await checkForUpdates();
  respondWith({ ...RELEASE, tag_name: 'v1.0.13' });
  await installUpdate();
  expect(mockNative.installUpdate).toHaveBeenCalledWith('https://github.com/omrajguru/koto/releases/download/v1.0.12/Koto-ARM64.msix');
});

it('waits for dictation to finish before restarting', async () => {
  respondWith(RELEASE);
  await checkForUpdates();
  activityStore.set({ phase: 'idle', processingCount: 1 });
  await installUpdate();
  expect(mockNative.installUpdate).not.toHaveBeenCalled();
  expect(updateStore.get()).toMatchObject({ status: 'failed', message: expect.stringMatching(/finish the current dictation/i) });

  // The update is still offered, so it can be retried once dictation is done.
  activityStore.set({ phase: 'idle', processingCount: 0 });
  respondWith(RELEASE);
  await installUpdate();
  expect(mockNative.installUpdate).toHaveBeenCalledTimes(1);
});

it('shows why Windows refused an update', async () => {
  respondWith(RELEASE);
  await checkForUpdates();
  respondWith(RELEASE);
  mockNative.installUpdate.mockRejectedValueOnce(new Error('Windows does not trust the certificate this update is signed with.'));
  await installUpdate();
  expect(updateStore.get()).toMatchObject({ status: 'failed', version: '1.0.12', message: expect.stringMatching(/certificate/) });
});

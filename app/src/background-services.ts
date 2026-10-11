import { loadBackupState } from './backup/cloud-backup';
import { dictationService } from './dictation/dictation-service';
import DesktopIntegration from './native/NativeDesktopIntegration';
import { loadConnection } from './storage/server-connection';
import { loadHistory, pruneDeliveredAudio } from './storage/dictation-history';
import { loadPreferences, preferencesStore } from './storage/preferences';
import { checkForUpdates, confirmHealthyStart } from './updates/app-updates';

const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Starts everything that must run whether or not the main window is open.
 * Called once from index.js, before any React component mounts.
 */
export function startBackgroundServices(): void {
  // The hotkey works immediately; stored data loads alongside it.
  dictationService.start();
  void (async () => {
    await Promise.all([loadPreferences(), loadConnection(), loadHistory(), loadBackupState()]);
    DesktopIntegration.setWritingStyle(preferencesStore.get().writingStyle);
    // This JavaScript started and loaded its data.
    confirmHealthyStart();
    await pruneDeliveredAudio();
    // Keep the OS login item in step with the stored preference (first launch defaults to on).
    await DesktopIntegration.setLaunchAtLogin(preferencesStore.get().launchAtLogin).catch(() => undefined);
    await checkForUpdates();
  })();
  // The tray and orb menus show the current style as checked.
  let syncedStyle = preferencesStore.get().writingStyle;
  preferencesStore.subscribe(() => {
    const style = preferencesStore.get().writingStyle;
    if (style !== syncedStyle) {
      syncedStyle = style;
      DesktopIntegration.setWritingStyle(style);
    }
  });
  setInterval(() => {
    void pruneDeliveredAudio();
    void checkForUpdates();
  }, MAINTENANCE_INTERVAL_MS);
}

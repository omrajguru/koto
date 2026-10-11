import { ApiError, transcribeSegment } from '../api/koto-api';
import { decodeBase64, encodeBase64 } from '../audio/base64';
import { type AudioSegment, containsSpeech, segmentRecording, SpeechSegmenter } from '../audio/speech-segmenter';
import { normaliseSpeech } from '../audio/speech-level';
import { bytesToSamples, encodeWave, SAMPLE_RATE } from '../audio/wave';
import DesktopIntegration from '../native/NativeDesktopIntegration';
import { connectionLoaded, currentConnection, SETTINGS_FIXABLE_FAILURE } from '../storage/server-connection';
import { type DictationRecord, historyStore, saveRecord, updateRecord } from '../storage/dictation-history';
import { isWritingStyle, WRITING_STYLE_LABELS } from '../formatting/writing-style';
import { keytermsFor, preferencesStore, updatePreferences } from '../storage/preferences';
import { ObservableStore } from '../state/observable-store';
import { RollingTidy } from './rolling-tidy';
import { isChosenMicrophoneMissing, microphonesStore, startMicrophoneSync } from '../audio/microphones';
import { warmPolishIfUseful } from './text-finishing';

/**
 * Owns the dictation lifecycle. Runs from app start, independent of any
 * window, so dictation keeps working while the main window is closed.
 *
 * Hotkey behaviour:
 * - Hold the hotkey to talk; release to insert.
 * - Double-tap it to dictate hands-free; press it again (or click the orb) to finish.
 * - A single quick tap is ignored. Esc cancels.
 *
 * Nothing is lost on failure:
 * - Audio is written to disk natively while recording.
 * - A history record is saved before transcription starts.
 * - The transcript is saved before it is pasted.
 * - If pasting is unsafe or fails, the text is left on the clipboard.
 */

/** A press shorter than this is a tap rather than a hold. */
const TAP_THRESHOLD_MS = 300;
/** Time allowed between the release of the first tap and the second press. */
const DOUBLE_TAP_WINDOW_MS = 400;
const MINIMUM_RECORDING_SECONDS = 0.3;
/** Cancelled recordings longer than this are kept in history in case the cancel was a mistake. */
const KEEP_CANCELLED_AFTER_SECONDS = 2;
const MAXIMUM_RECORDING_MS = 20 * 60 * 1000;
const NOTICE_DURATION_MS = 2600;
const RETRY_DELAYS_MS = [800, 2500];

export type RecordingMode = 'hold' | 'handsFree';
/** paste: into the focused app. copy: onto the clipboard. saveOnly: kept in history only. */
type Delivery = 'paste' | 'copy' | 'saveOnly';
export type DictationPhase = 'idle' | 'starting' | 'listening' | 'awaitingSecondTap' | 'handsFree';

export interface DictationActivity {
  phase: DictationPhase;
  /** Dictations being transcribed or inserted. */
  processingCount: number;
}

export const activityStore = new ObservableStore<DictationActivity>({ phase: 'idle', processingCount: 0 });

class SegmentFailure extends Error {
  /** Fixed in Settings (server, access key or Sarvam key), not by retrying. */
  readonly needsSettings: boolean;

  constructor(message: string, needsSettings = false) {
    super(message);
    this.needsSettings = needsSettings;
  }
}

interface ActiveRecording {
  id: string;
  startedAt: number;
  audioPath: Promise<string>;
  segmenter: SpeechSegmenter;
  segmentJobs: Promise<string>[];
  /** Tidies long dictation in parts while it is still being recorded. */
  tidy: RollingTidy;
  totalSamples: number;
  isCancelled: boolean;
  maximumTimer?: ReturnType<typeof setTimeout>;
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function wait(ms: number): Promise<void> {
  return new Promise(done => setTimeout(done, ms));
}

/** Sends one segment, retrying network failures, server errors and rate limits. */
async function transcribeWithRetry(segment: AudioSegment): Promise<string> {
  if (!segment.containsSpeech) {
    return '';
  }
  // Quiet speech (a distant laptop microphone) is raised so Saaras hears it clearly.
  const audio = encodeBase64(encodeWave(normaliseSpeech(segment.samples)));
  // Right after launch the saved settings may still be loading.
  await connectionLoaded();
  const preferences = preferencesStore.get();
  for (let attempt = 0; ; attempt += 1) {
    const connection = currentConnection();
    if (!connection) {
      throw new SegmentFailure('Connect your server in Koto settings to transcribe this recording.', true);
    }
    try {
      return await transcribeSegment({
        connection,
        audio,
        languageCode: preferences.languageCode,
        keyterms: keytermsFor(preferences),
        script: preferences.indicScript,
      });
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthenticated) {
        // The server's message names the key it did not accept and ends "Check it in Koto settings."
        throw new SegmentFailure(SETTINGS_FIXABLE_FAILURE.test(error.message) ? error.message : `${error.message} Check Koto settings.`, true);
      }
      const isTransient = !(error instanceof ApiError) || error.isTransient;
      if (!isTransient || attempt >= RETRY_DELAYS_MS.length) {
        throw new SegmentFailure(error instanceof Error ? error.message : 'Transcription failed.');
      }
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

function joinTranscripts(parts: string[]): string {
  return parts.map(part => part.trim()).filter(Boolean).join(' ');
}

class DictationService {
  /** The recording the hotkey currently controls. */
  private recording: ActiveRecording | undefined;
  /** The recording receiving audio frames. Outlives `recording` until capture has fully stopped. */
  private capturing: ActiveRecording | undefined;
  private pendingStop: Promise<void> = Promise.resolve();
  private pressedAt = 0;
  private doubleTapTimer: ReturnType<typeof setTimeout> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private notice: { state: 'notice' | 'error'; message: string } | undefined;
  /** Insertions run one at a time, in the order dictations finished. */
  private insertionQueue: Promise<unknown> = Promise.resolve();
  private isStarted = false;

  start(): void {
    if (this.isStarted) {
      return;
    }
    this.isStarted = true;
    DesktopIntegration.onHotkey(event => this.handleHotkey(event));
    DesktopIntegration.onAudioFrame(frame => this.handleAudioFrame(frame));
    DesktopIntegration.onRecordingError(message => this.handleRecordingError(message));
    // Style picked from the tray menu or the orb's right-click menu; applies to the dictation in progress.
    DesktopIntegration.onWritingStyleChange(style => {
      if (isWritingStyle(style)) {
        void updatePreferences({ writingStyle: style });
      }
    });
    // Keeps the orb's style label current if the style changes while recording.
    preferencesStore.subscribe(() => this.refreshOverlay());
    // The chosen microphone, kept in sync in real time; the orb says when it comes and goes.
    microphonesStore.subscribe(() => this.refreshOverlay());
    startMicrophoneSync((isConnected, name) =>
      this.showNotice('notice', isConnected ? `${name} connected.` : `${name} disconnected. Using the Windows default.`),
    );
    DesktopIntegration.startHotkeyListener();
  }

  // Hotkey -----------------------------------------------------------------

  private handleHotkey(event: string): void {
    const { phase } = activityStore.get();
    switch (event) {
      case 'pressed':
        if (phase === 'idle') {
          // Recording starts on the first press either way, so nothing said right away is lost.
          this.pressedAt = Date.now();
          void this.beginRecording('hold');
        } else if (phase === 'awaitingSecondTap') {
          this.clearDoubleTapTimer();
          this.setPhase('handsFree');
        } else if (phase === 'handsFree') {
          void this.finishRecording();
        }
        break;
      case 'released':
        if (phase === 'listening' || phase === 'starting') {
          if (Date.now() - this.pressedAt < TAP_THRESHOLD_MS) {
            // A quick tap: hands-free if a second tap follows, otherwise it was accidental.
            this.setPhase('awaitingSecondTap');
            this.doubleTapTimer = setTimeout(() => {
              this.doubleTapTimer = undefined;
              if (activityStore.get().phase === 'awaitingSecondTap') {
                void this.cancelRecording();
              }
            }, DOUBLE_TAP_WINDOW_MS);
          } else {
            void this.finishRecording();
          }
        }
        break;
      case 'toggle':
        if (phase === 'idle') {
          void this.beginRecording('handsFree');
        } else {
          void this.finishRecording();
        }
        break;
      case 'cancelled':
        if (phase !== 'idle') {
          void this.cancelRecording();
        }
        break;
    }
  }

  private clearDoubleTapTimer(): void {
    if (this.doubleTapTimer) {
      clearTimeout(this.doubleTapTimer);
      this.doubleTapTimer = undefined;
    }
  }

  // Recording --------------------------------------------------------------

  private async beginRecording(mode: RecordingMode): Promise<void> {
    this.setPhase('starting');
    // Wake the AI polish path while the person speaks, so it is quick when they finish.
    warmPolishIfUseful();
    const recording: ActiveRecording = {
      id: createId(),
      startedAt: Date.now(),
      audioPath: Promise.resolve(''),
      segmenter: new SpeechSegmenter(),
      segmentJobs: [],
      tidy: new RollingTidy(),
      totalSamples: 0,
      isCancelled: false,
    };
    // A previous recording may still be delivering its final frames. Start only after it has
    // fully stopped, so its tail never lands in this recording.
    recording.audioPath = this.pendingStop.then(() => {
      this.capturing = recording;
      return DesktopIntegration.startRecording();
    });
    this.recording = recording;
    try {
      await recording.audioPath;
    } catch (error) {
      if (this.recording === recording) {
        this.recording = undefined;
        this.setPhase('idle');
      }
      if (this.capturing === recording) {
        this.capturing = undefined;
      }
      this.showNotice('error', error instanceof Error ? error.message : 'The microphone could not be started.');
      return;
    }
    // The hotkey may have been released (hands-free tap) or the recording finished while starting.
    if (this.recording !== recording) {
      return;
    }
    if (activityStore.get().phase === 'starting') {
      this.setPhase(mode === 'handsFree' ? 'handsFree' : 'listening');
    }
    recording.maximumTimer = setTimeout(() => {
      if (this.recording === recording) {
        void this.finishRecording();
      }
    }, MAXIMUM_RECORDING_MS);
  }

  private handleAudioFrame(frame: string): void {
    // Frames keep arriving briefly after the hotkey is released; they belong to the
    // recording being captured, which may no longer be the active one.
    const recording = this.capturing;
    if (!recording || recording.isCancelled) {
      return;
    }
    const samples = bytesToSamples(decodeBase64(frame));
    recording.totalSamples += samples.length;
    for (const segment of recording.segmenter.push(samples)) {
      const job = transcribeWithRetry(segment);
      job.catch(() => undefined); // Awaited later; avoid unhandled rejection warnings meanwhile.
      recording.segmentJobs.push(job);
      recording.tidy.add(job);
    }
  }

  private handleRecordingError(message: string): void {
    // Capture has stopped (device unplugged, permission revoked, sleep). Keep what was recorded.
    if (this.recording) {
      this.showNotice('error', message);
      void this.finishRecording();
    }
  }

  private async stopCapture(recording: ActiveRecording): Promise<string> {
    this.clearDoubleTapTimer();
    if (recording.maximumTimer) {
      clearTimeout(recording.maximumTimer);
    }
    if (this.recording === recording) {
      this.recording = undefined;
      // The hotkey is free for the next dictation while this one is transcribed.
      this.setPhase('idle');
    }
    const stop = (async () => {
      try {
        await recording.audioPath;
      } catch {
        return '';
      }
      try {
        // Resolves after the final frame has been emitted, and events arrive in order,
        // so every frame of this recording has been handled once this returns.
        return await DesktopIntegration.stopRecording();
      } catch {
        return recording.audioPath.catch(() => '');
      }
    })();
    this.pendingStop = stop.then(
      () => undefined,
      () => undefined,
    );
    const audioPath = await stop;
    if (this.capturing === recording) {
      this.capturing = undefined;
    }
    return audioPath;
  }

  private async cancelRecording(): Promise<void> {
    const recording = this.recording;
    if (!recording) {
      return;
    }
    recording.isCancelled = true;
    const audioPath = await this.stopCapture(recording);
    const durationSeconds = recording.totalSamples / SAMPLE_RATE;
    if (durationSeconds >= KEEP_CANCELLED_AFTER_SECONDS && audioPath) {
      await saveRecord({
        id: recording.id,
        createdAt: new Date(recording.startedAt).toISOString(),
        durationSeconds,
        status: 'failed',
        text: '',
        rawTranscript: '',
        audioPath,
        failureReason: 'Cancelled. The recording is kept here in case you need it.',
      });
    } else if (audioPath) {
      await DesktopIntegration.deleteAudioFile(audioPath).catch(() => undefined);
    }
    this.refreshOverlay();
  }

  private async finishRecording(): Promise<void> {
    const recording = this.recording;
    if (!recording) {
      return;
    }
    this.changeProcessingCount(1);
    try {
      const audioPath = await this.stopCapture(recording);
      // stopRecording resolves after the final frame has been delivered, so the remainder is complete.
      const remainder = recording.segmenter.flush();
      if (remainder) {
        const job = transcribeWithRetry(remainder);
        job.catch(() => undefined);
        recording.segmentJobs.push(job);
        recording.tidy.add(job);
      }
      const durationSeconds = recording.totalSamples / SAMPLE_RATE;
      if (durationSeconds < MINIMUM_RECORDING_SECONDS) {
        if (audioPath) {
          await DesktopIntegration.deleteAudioFile(audioPath).catch(() => undefined);
        }
        return;
      }
      const record: DictationRecord = {
        id: recording.id,
        createdAt: new Date(recording.startedAt).toISOString(),
        durationSeconds,
        status: 'transcribing',
        text: '',
        rawTranscript: '',
        audioPath,
      };
      await saveRecord(record);
      await this.completeDictation(record, recording.segmentJobs, recording.tidy, 'paste');
    } finally {
      this.changeProcessingCount(-1);
    }
  }

  // Transcription and insertion -------------------------------------------

  private async completeDictation(
    record: DictationRecord,
    segmentJobs: Promise<string>[],
    tidy: RollingTidy,
    delivery: Delivery,
  ): Promise<void> {
    const results = await Promise.allSettled(segmentJobs);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    const transcripts = results.map(result => (result.status === 'fulfilled' ? result.value : ''));
    const rawTranscript = joinTranscripts(transcripts);

    if (failure) {
      const reason = failure.reason instanceof Error ? failure.reason.message : 'Transcription failed.';
      const needsSettings = failure.reason instanceof SegmentFailure && failure.reason.needsSettings;
      await updateRecord(record.id, { status: 'failed', rawTranscript, failureReason: reason });
      if (needsSettings) {
        // The recording is transcribed automatically once the settings are saved.
        this.showNotice('error', 'Check Koto settings to transcribe. The recording is saved.');
        DesktopIntegration.showMainWindow();
      } else {
        this.showNotice('error', 'Transcription failed. The recording is saved in Koto.');
      }
      return;
    }

    // Rules always; AI polish when needed (always for long dictation), within its time limit.
    const { text, unpolishedText } = await tidy.finish();
    if (!text) {
      await updateRecord(record.id, { status: 'empty', rawTranscript });
      this.showNotice('notice', 'No speech detected.');
      return;
    }
    // Saved before any attempt to paste, so a failed paste cannot lose the text.
    await updateRecord(record.id, { text, rawTranscript, unpolishedText });

    if (delivery === 'saveOnly') {
      await updateRecord(record.id, { status: 'saved' });
      return;
    }
    const insertion = this.insertionQueue.then(() =>
      delivery === 'paste' ? this.insertIntoFocusedApp(record.id, text) : this.copyToClipboard(record.id, text),
    );
    this.insertionQueue = insertion.catch(() => undefined);
    await insertion;
  }

  private async insertIntoFocusedApp(recordId: string, text: string): Promise<void> {
    try {
      const outcome = await DesktopIntegration.insertText(text);
      if (outcome === 'pasted') {
        await updateRecord(recordId, { status: 'inserted' });
        this.refreshOverlay();
      } else {
        await updateRecord(recordId, { status: 'copied' });
        this.showNotice('notice', 'Copied to clipboard. Paste where you need it.');
      }
    } catch (error) {
      console.warn('Insertion failed; copying instead.', error);
      await this.copyToClipboard(recordId, text);
    }
  }

  private async copyToClipboard(recordId: string, text: string): Promise<void> {
    try {
      await DesktopIntegration.copyText(text);
      await updateRecord(recordId, { status: 'copied' });
      this.showNotice('notice', 'Copied to clipboard.');
    } catch {
      await updateRecord(recordId, { status: 'copied', failureReason: 'Could not reach the clipboard. Copy the text from Koto.' });
      this.showNotice('error', 'Saved in Koto. Open Koto to copy it.');
    }
  }

  /**
   * Transcribes a saved recording again. Focus is elsewhere by now, so the result is never
   * pasted: 'copy' when the person asked for it, 'saveOnly' for automatic retries so several
   * of them do not overwrite the clipboard one after another.
   */
  async retry(recordId: string, delivery: Exclude<Delivery, 'paste'> = 'copy'): Promise<void> {
    const record = historyStore.get().find(existing => existing.id === recordId);
    if (!record?.audioPath) {
      return;
    }
    await updateRecord(recordId, { status: 'transcribing', failureReason: undefined });
    this.changeProcessingCount(1);
    try {
      const bytes = decodeBase64(await DesktopIntegration.readAudioFile(record.audioPath));
      // Skip the header. An unfinished header (app quit mid-recording) is ignored the same way.
      const samples = bytesToSamples(bytes.subarray(44));
      if (!containsSpeech(samples)) {
        await updateRecord(recordId, { status: 'empty' });
        return;
      }
      const jobs = segmentRecording(samples).map(segment => transcribeWithRetry(segment));
      const tidy = new RollingTidy();
      jobs.forEach(job => {
        job.catch(() => undefined);
        tidy.add(job);
      });
      await this.completeDictation({ ...record, durationSeconds: samples.length / SAMPLE_RATE }, jobs, tidy, delivery);
    } catch (error) {
      await updateRecord(recordId, {
        status: 'failed',
        failureReason: error instanceof Error ? error.message : 'The recording could not be read.',
      });
    } finally {
      this.changeProcessingCount(-1);
    }
  }

  // Overlay ----------------------------------------------------------------

  private setPhase(phase: DictationPhase): void {
    activityStore.set(current => ({ ...current, phase }));
    this.refreshOverlay();
  }

  private changeProcessingCount(delta: number): void {
    activityStore.set(current => ({ ...current, processingCount: Math.max(0, current.processingCount + delta) }));
    this.refreshOverlay();
  }

  private showNotice(state: 'notice' | 'error', message: string): void {
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
    }
    this.notice = { state, message };
    this.refreshOverlay();
    this.noticeTimer = setTimeout(() => {
      this.notice = undefined;
      this.refreshOverlay();
    }, NOTICE_DURATION_MS);
  }

  /** Shown beside the orb while recording: a non-default style, and "Default mic" while the chosen microphone is unplugged. */
  private styleLabel(): string {
    const style = preferencesStore.get().writingStyle;
    const parts = [
      style === 'neutral' ? '' : WRITING_STYLE_LABELS[style],
      // Recording from the Windows default because the chosen microphone is unplugged.
      isChosenMicrophoneMissing() ? 'Default mic' : '',
    ];
    return parts.filter(Boolean).join(' · ');
  }

  /** Recording states take priority over notices, which take priority over processing. */
  private refreshOverlay(): void {
    const { phase, processingCount } = activityStore.get();
    if (phase === 'listening' || phase === 'starting' || phase === 'awaitingSecondTap') {
      DesktopIntegration.setOverlayState('listening', this.styleLabel());
    } else if (phase === 'handsFree') {
      DesktopIntegration.setOverlayState('handsFree', this.styleLabel());
    } else if (this.notice) {
      DesktopIntegration.setOverlayState(this.notice.state, this.notice.message);
    } else if (processingCount > 0) {
      DesktopIntegration.setOverlayState('processing', '');
    } else {
      DesktopIntegration.setOverlayState('hidden', '');
    }
  }
}

export const dictationService = new DictationService();

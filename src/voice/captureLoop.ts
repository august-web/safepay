import {
  AudioModule,
  RecordingPresets,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { Platform } from 'react-native';

import { transcribeFile, type TranscribeFailure } from '../services/labSpeech';
import { isSpeakingSync } from '../services/speech';
import { beginMicSession, endMicSession, isClipPlaying } from './voicePack';

/**
 * Rolling capture loop for the HCI Lab ASR.
 *
 * The lab gateway is REST (record a file, upload it) and the free tier allows
 * only 10 ASR requests per day, so a permanently-open streaming session is
 * impossible. This loop instead records in bounded windows, keeps every
 * window local unless the meter sees real speech, finalises on trailing
 * silence, and only then uploads exactly one utterance. Silent windows cost
 * nothing, and the 15 s cap keeps an upload well inside the gateway's
 * 120 s / 10 MB limits.
 */

/** Why capture can fail; gateway failures pass through from transcribeFile. */
export type CaptureFailure = TranscribeFailure | 'permission' | 'unavailable';

export interface CaptureLoopHandlers {
  /** Final transcript of one uploaded utterance. */
  onTranscript: (transcript: string) => void;
  /** A window produced no transcript; the caller decides to keep or stop. */
  onFailure: (reason: CaptureFailure) => void;
}

export interface CaptureLoop {
  /**
   * Attaches the callbacks. The loop is created without any (a React component
   * cannot hand it ref-reading closures during render), so this runs in an
   * effect before `start` is ever reachable.
   */
  setHandlers: (handlers: CaptureLoopHandlers) => void;
  /** Opens the microphone (requesting permission on first use). */
  start: () => void;
  /**
   * Closes the microphone. With `flush` (the default) a window that already
   * heard speech still finishes uploading; `flush: false` aborts it now.
   */
  stop: (options?: { flush?: boolean }) => void;
  /** Cancels everything and delivers nothing further (use on unmount). */
  dispose: () => void;
  isRunning: () => boolean;
}

/** Hard ceiling on one window - battery, upload size, and latency all prefer short. */
const WINDOW_SECONDS = 15;
const WINDOW_CAP_MS = WINDOW_SECONDS * 1_000;

/** A window with no speech this long is thrown away locally, at zero quota cost. */
const NO_SPEECH_DISCARD_MS = 4_000;

/** Trailing silence that finalises an utterance. */
const TRAILING_SILENCE_MS = 1_300;

/** Metering sample interval. */
const POLL_MS = 150;

/** Meter reading above this counts as speech (dBFS; silence sits near -160). */
const SPEECH_DBFS = -38;

/** Beat between windows so the recorder file is released before the next prepare. */
const RESTART_GAP_MS = 200;

/** Quiet gate: never open the mic while the app's own voice is on the speaker. */
const QUIET_POLL_MS = 200;
const QUIET_DEADLINE_MS = 5_000;

/**
 * Mirrors expo-audio's internal `createRecordingOptions` (what the public
 * `useAudioRecorder` hook passes to the native recorder) so a directly
 * constructed recorder gets the same platform block - plus metering, which
 * the silence detection depends on.
 */
function recorderOptions(): Partial<RecordingOptions> {
  const preset = RecordingPresets.HIGH_QUALITY;
  const platform =
    Platform.OS === 'ios' ? preset.ios : Platform.OS === 'android' ? preset.android : preset.web;
  return {
    extension: preset.extension,
    sampleRate: preset.sampleRate,
    numberOfChannels: preset.numberOfChannels,
    bitRate: preset.bitRate,
    isMeteringEnabled: true,
    ...platform,
  };
}

export function createCaptureLoop(): CaptureLoop {
  let running = false;
  /** Bumped on start/dispose; async work from an older generation is dropped. */
  let generation = 0;
  let recorder: AudioRecorder | null = null;
  let micHeld = false;
  let gapTimer: ReturnType<typeof setTimeout> | null = null;
  let liveHandlers: CaptureLoopHandlers = { onTranscript: () => {}, onFailure: () => {} };

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  function releaseMic(): void {
    if (!micHeld) return;
    micHeld = false;
    endMicSession();
  }

  async function stopRecorder(): Promise<void> {
    const active = recorder;
    if (active == null) return;
    try {
      await active.stop();
    } catch {
      // Already stopped, or never prepared - the native reset path covers both.
    }
  }

  function endSession(): void {
    if (gapTimer != null) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
    void stopRecorder();
    releaseMic();
    recorder = null;
  }

  function scheduleWindow(gen: number): void {
    if (!running || gen !== generation) {
      endSession();
      return;
    }
    gapTimer = setTimeout(() => {
      gapTimer = null;
      void runWindow(gen);
    }, RESTART_GAP_MS);
  }

  async function closeWindow(gen: number, active: AudioRecorder): Promise<void> {
    try {
      await active.stop();
    } catch {
      // Native auto-stop (forDuration) may have closed it already.
    }
    if (gen !== generation) return; // Disposed while stopping.

    const uri = active.uri;
    if (uri == null || uri.length === 0) {
      liveHandlers.onFailure('empty');
      scheduleWindow(gen);
      return;
    }

    const result = await transcribeFile(uri);
    if (gen !== generation) return; // Disposed while uploading.

    if (result.ok) {
      liveHandlers.onTranscript(result.transcript);
    } else {
      liveHandlers.onFailure(result.reason);
    }
    scheduleWindow(gen);
  }

  async function runWindow(gen: number): Promise<void> {
    const active = recorder;
    if (active == null || !running || gen !== generation) {
      endSession();
      return;
    }

    // Quiet gate: an open window cannot hear over our own clip, so wait for
    // the speaker to clear (with a deadline, so a wedged state cannot stall).
    const quietDeadline = Date.now() + QUIET_DEADLINE_MS;
    while ((isClipPlaying() || isSpeakingSync()) && Date.now() < quietDeadline) {
      await delay(QUIET_POLL_MS);
      if (!running || gen !== generation) {
        endSession();
        return;
      }
    }

    // A previous window's stop must be fully done before the next prepare -
    // the native recorder throws if it is still prepared when we re-arm it.
    await stopRecorder();
    if (!running || gen !== generation) {
      endSession();
      return;
    }

    try {
      await active.prepareToRecordAsync();
    } catch {
      liveHandlers.onFailure('unavailable');
      scheduleWindow(gen);
      return;
    }
    if (!running || gen !== generation) {
      endSession();
      return;
    }

    try {
      active.record({ forDuration: WINDOW_SECONDS });
    } catch {
      liveHandlers.onFailure('unavailable');
      scheduleWindow(gen);
      return;
    }

    const startedAt = Date.now();
    let speechSeen = false;
    let lastSpeechAt = 0;
    // Loudest sample in the window, for the diagnostics line on discard.
    let peakDbfs = -160;
    let meterSeen = false;

    while (gen === generation) {
      await delay(POLL_MS);
      if (gen !== generation) return; // Disposed; teardown already ran.

      const now = Date.now();

      // The app's own voice: never upload our own clip as the user's words.
      if (isClipPlaying() || isSpeakingSync()) {
        await stopRecorder();
        scheduleWindow(gen);
        return;
      }

      const status = active.getStatus();
      const level = status.metering;
      if (level != null) {
        meterSeen = true;
        if (level > peakDbfs) peakDbfs = level;
      }
      if (level != null && level > SPEECH_DBFS) {
        speechSeen = true;
        lastSpeechAt = now;
      }

      // stop() during the wait: flush what was already said, else just close.
      if (!running) break;
      if (!speechSeen && now - startedAt >= NO_SPEECH_DISCARD_MS) {
        await stopRecorder();
        scheduleWindow(gen);
        return;
      }
      if (speechSeen && now - lastSpeechAt >= TRAILING_SILENCE_MS) break;
      if (now - startedAt >= WINDOW_CAP_MS) break;
      // The native forDuration stop (or a stolen mic) closed the window early.
      if (!status.isRecording && now - startedAt > POLL_MS * 2) break;
    }

    if (gen !== generation) return; // Disposed during the loop.
    if (!speechSeen) {
      console.log(
        `[SikaVoice window] silent ${
          meterSeen ? `(peak ${peakDbfs.toFixed(0)} dB)` : '(no metering)'
        } - discarded`,
      );
      await stopRecorder();
      scheduleWindow(gen);
      return;
    }
    console.log(`[SikaVoice window] speech heard (peak ${peakDbfs.toFixed(0)} dB) - uploading`);
    await closeWindow(gen, active);
  }

  async function runSession(gen: number): Promise<void> {
    if (Platform.OS === 'web') {
      liveHandlers.onFailure('unavailable');
      running = false;
      return;
    }

    let granted = false;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      granted = permission.granted;
    } catch {
      granted = false;
    }
    if (gen !== generation || !running) return;
    if (!granted) {
      liveHandlers.onFailure('permission');
      if (gen === generation) running = false;
      return;
    }

    try {
      // AudioRecorder is a class on the native module object, not a static
      // module export - same construction expo-audio's own useAudioRecorder uses.
      // eslint-disable-next-line import/namespace
      recorder = new AudioModule.AudioRecorder(recorderOptions());
    } catch {
      liveHandlers.onFailure('unavailable');
      running = false;
      return;
    }

    // Hold the mic session for the loop's whole run so clips keep playing on
    // the loudspeaker while capture is armed (Android would otherwise route
    // media to the earpiece once a recording session is open).
    micHeld = true;
    beginMicSession();
    scheduleWindow(gen);
  }

  function start(): void {
    if (running) return;
    generation += 1;
    running = true;
    endSession();
    void runSession(generation);
  }

  function stop(options?: { flush?: boolean }): void {
    const flush = options?.flush ?? true;
    if (!running) {
      // Nothing armed; only a hard stop needs to sweep leftovers.
      if (!flush) endSession();
      return;
    }
    running = false;
    if (flush) {
      // The active window (if any) finishes and uploads, then tears down via
      // scheduleWindow; a quiet gate or gap timer notices `running` on its own.
      return;
    }
    // Hard abort: drop in-flight work and release the mic immediately.
    generation += 1;
    endSession();
  }

  function dispose(): void {
    running = false;
    generation += 1;
    endSession();
  }

  return {
    setHandlers: (handlers) => {
      liveHandlers = handlers;
    },
    start,
    stop,
    dispose,
    isRunning: () => running,
  };
}

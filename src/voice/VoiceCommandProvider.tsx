import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Platform } from 'react-native';

import { repeatLastAnnouncement } from '../a11y/announcer';
import { getAppLanguage, type AppLanguage } from '../i18n';
import { stopSpeaking, isSpeaking } from '../services/speech';
import { hapticError, hapticTick } from '../services/haptics';
import { commandVocabulary, matchVoiceIntent, type VoiceIntent } from './commands';
import { sayKeyAsync } from './say';
import {
  beginMicSession,
  endMicSession,
  isSelfVoiceAudible,
  stopVoiceClip,
} from './voicePack';

type VoiceCommandContextValue = {
  /** True while the microphone session is live. */
  listening: boolean;
  /** True when the platform recogniser can be used on this device. */
  available: boolean;
  /** Set when voice input cannot run: `permission` or `unavailable`. */
  blockedReason: 'permission' | 'unavailable' | null;
  /** Last final transcript this session, for the on-screen transcript line. */
  lastTranscript: string | null;
  toggleListening: () => void;
  startListening: () => void;
  stopListening: () => void;
  /**
   * Routes the mic's NEXT utterance to `handler` (screen dictation, P2).
   * One utterance is consumed; call endDictation to release (it also fires
   * on unmount via useScreenDictation's cleanup).
   */
  beginDictation: (handler: (transcript: string, isFinal: boolean) => void) => void;
  endDictation: () => void;
  /** True while a screen owns the next utterance for dictation. */
  dictationActive: boolean;
};

const VoiceCommandContext = createContext<VoiceCommandContextValue | null>(null);

/**
 * Recogniser locales per app language, most preferred first.
 *
 * Android's recogniser has no Akan, Ewe or Ga language pack (probing the TECNO
 * showed `ee-GH` fails with "Failed to get language pack: error 12", which
 * silently killed voice input). Each language therefore lists Ghanaian English
 * as the practical fallback, and `resolveRecognitionLocale` checks the device
 * before opening the session so we never request a locale the engine cannot
 * serve. English commands work in every language, and native-language phrases
 * are matched from the transcript with fuzzy folding, so the recogniser's
 * English spelling drift still lands.
 */
const PREFERRED_RECOGNITION_LOCALES: Record<AppLanguage, string[]> = {
  tw: ['ak-GH', 'en-GH', 'en-US', 'en-GB'],
  ee: ['ee-GH', 'en-GH', 'en-US', 'en-GB'],
  // Ga has no recogniser locale, and 'ga' is Irish on Android - never request it.
  ga: ['en-GH', 'en-US', 'en-GB'],
  pcm: ['en-GH', 'en-US', 'en-GB'],
  en: ['en-GH', 'en-US', 'en-GB'],
};

/** Absolute ceiling on the locale probe so the mic never waits on it. */
const LOCALE_PROBE_TIMEOUT_MS = 2_500;

/** How long we keep waiting for our own voice to finish before starting anyway. */
const VOICE_CLEAR_TIMEOUT_MS = 4_000;

/** Poll interval while waiting for the app's own voice to finish. */
const VOICE_CLEAR_POLL_MS = 150;

/** How long after a command we reject its exact duplicate finals. */
const DUPLICATE_WINDOW_MS = 4_000;

/** How long we remember the transcript of something the mic heard from us. */
const ECHO_RECALL_MS = 8_000;

/** A session that dies within this window counts as a failed start. */
const SHORT_SESSION_MS = 5_000;

/** Short release gap before Android 12 accepts the next recognizer session. */
const SESSION_RESCUE_DELAY_MS = 250;

/** Delay before retrying when the recogniser service reports it is busy. */
const BUSY_RETRY_MS = 1_500;

/** Grace after a rescue before we accept the service is really gone. */
const RESCUE_GRACE_MS = 15_000;

/** After this many consecutive failed starts the loop gives up and speaks once. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Android 12 can leave the best transcript as a partial result. */
const PARTIAL_RESULT_FALLBACK_MS = 350;

/**
 * Runs `go` once the app's own voice is off the speaker (or the deadline
 * passes, so a wedged audio state can never block the mic permanently).
 */
function startWhenQuiet(deadline: number, go: () => void): void {
  void (async () => {
    const speaking = (await isSpeaking().catch(() => false)) || isSelfVoiceAudible();
    if (!speaking || Date.now() >= deadline) {
      go();
      return;
    }
    setTimeout(() => startWhenQuiet(deadline, go), VOICE_CLEAR_POLL_MS);
  })();
}

/** Letters only, lower-cased, keeping Ghanaian orthography ranges. */
function normalizeTranscript(text: string): string {
  return text.toLowerCase().replace(/[^a-z\u0100-\u036f]/g, '');
}

/** Duplicate/echo test: equal, or one contains the other when long enough. */
function sameSpokenWords(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
}

const localeCache = new Map<AppLanguage, Promise<string>>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('locale-probe-timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Picks the best locale the device can actually recognise.
 *
 * Order: an installed locale (works offline) beats a supported-but-not-installed
 * one (server-backed), and an exact match beats a same-language prefix. If the
 * probe itself fails (Android 12 or below, or a slow service), we fall back to
 * en-US, which every recogniser ships offline.
 */
async function resolveRecognitionLocale(language: AppLanguage): Promise<string> {
  const candidates = PREFERRED_RECOGNITION_LOCALES[language] ?? ['en-US'];

  try {
    const { locales, installedLocales } = await withTimeout(
      ExpoSpeechRecognitionModule.getSupportedLocales({}),
      LOCALE_PROBE_TIMEOUT_MS,
    );
    const installed = new Set(installedLocales);
    const supported = new Set(locales);

    const findPrefix = (set: Set<string>, base: string): string | null => {
      for (const locale of set) {
        if (locale.startsWith(`${base}-`) || locale === base) return locale;
      }
      return null;
    };

    for (const candidate of candidates) {
      if (installed.has(candidate)) return candidate;
    }
    for (const candidate of candidates) {
      const base = candidate.split('-')[0];
      const prefix = findPrefix(installed, base);
      if (prefix != null) return prefix;
    }
    for (const candidate of candidates) {
      if (supported.has(candidate)) return candidate;
    }
    for (const candidate of candidates) {
      const base = candidate.split('-')[0];
      const prefix = findPrefix(supported, base);
      if (prefix != null) return prefix;
    }
  } catch {
    // Probe unavailable - fall through to the universal default.
  }
  // Android 12 returns no locale probe data even when its online recognizer
  // can serve Ghanaian English. Prefer the regional model for Ghanaian app
  // languages; openMicSession retries with en-US if the service rejects it.
  return language === 'en' ? 'en-US' : 'en-GH';
}

function requestRecognitionLocale(language: AppLanguage): Promise<string> {
  let resolved = localeCache.get(language);
  if (resolved == null) {
    resolved = resolveRecognitionLocale(language);
    localeCache.set(language, resolved);
    // Never cache a failure: clear it so the next attempt probes again.
    void resolved.catch(() => localeCache.delete(language));
  }
  return resolved;
}

function isRecogniserUsable(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/**
 * Anything that owns the microphone's transcripts while it is active.
 * `VoiceFlowController` implements it for money flows; onboarding implements
 * its own sink so setup can never reach transaction code.
 */
export interface TranscriptSink {
  isActive(): boolean;
  /** @returns true when the transcript was consumed. */
  handleTranscript(transcript: string): boolean;
}

export interface VoiceCommandProviderProps {
  children: React.ReactNode;
  /** Called with the recognised intent; the caller performs the action. */
  onIntent: (intent: VoiceIntent) => void;
  /** Receives the raw transcript of every final result, for diagnostics. */
  onTranscript?: (transcript: string) => void;
  /**
   * Active conversational flow. When present it consumes every transcript
   * first (answers to its spoken questions); commands pass through otherwise.
   */
  flowController?: TranscriptSink | null;
  /**
   * When true the mic session is kept alive for as long as the app runs: one
   * continuous session, no re-arm cycle. This is the blind-user mode - the
   * microphone is simply always on.
   */
  alwaysOn?: boolean;
  /** When true, the listener starts as soon as this provider mounts. */
  autoStart?: boolean;
}

export function VoiceCommandProvider({
  children,
  onIntent,
  onTranscript,
  flowController,
  alwaysOn = true,
  autoStart = false,
}: VoiceCommandProviderProps) {
  const [listening, setListening] = useState(false);
  const [available] = useState(() => isRecogniserUsable());
  const [blockedReason, setBlockedReason] = useState<'permission' | 'unavailable' | null>(
    isRecogniserUsable() ? null : 'unavailable',
  );
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  /** Live mirror of the flow controller prop for the stable event handlers. */
  const flowRef = useRef<TranscriptSink | null>(null);
  useEffect(() => {
    flowRef.current = flowController ?? null;
  }, [flowController]);

  /** Mirror of `alwaysOn` for the event handlers, which capture stale props. */
  const alwaysOnRef = useRef(alwaysOn);
  const wantListeningRef = useRef(false);
  /** Stable ref so rescues always call the live closure. */
  const startListeningRef = useRef<(announce: boolean) => void>(() => {});
  const mountedRef = useRef(true);
  /** Consecutive failed starts; reset whenever a session actually opens. */
  const failureCountRef = useRef(0);
  const rescueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Date.now() of the last successful session start - detects a dead service. */
  const lastSessionStartAtRef = useRef(0);
  /** Last transcript we acted on, to reject the recogniser's duplicate finals. */
  const lastAcceptedRef = useRef<{ text: string; at: number } | null>(null);
  /** Transcripts the mic picked up from our own clips - never act on them. */
  const echoTranscriptsRef = useRef<{ text: string; at: number }[]>([]);
  /** Latest non-final transcript, used by Android 12's speech-end fallback. */
  const partialTranscriptRef = useRef<string | null>(null);
  const partialResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Active screen-dictation sink; set via beginDictation (P2). */
  const dictationHandlerRef = useRef<((transcript: string, isFinal: boolean) => void) | null>(null);
  const [dictationActive, setDictationActive] = useState(false);

  const beginDictation = useCallback(
    (handler: (transcript: string, isFinal: boolean) => void) => {
      dictationHandlerRef.current = handler;
      setDictationActive(true);
    },
    [],
  );

  const endDictation = useCallback(() => {
    dictationHandlerRef.current = null;
    setDictationActive(false);
  }, []);

  useEffect(() => {
    alwaysOnRef.current = alwaysOn;
  }, [alwaysOn]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      wantListeningRef.current = false;
      if (rescueTimerRef.current != null) {
        clearTimeout(rescueTimerRef.current);
        rescueTimerRef.current = null;
      }
      if (partialResultTimerRef.current != null) {
        clearTimeout(partialResultTimerRef.current);
      }
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // The native recognizer may already be closed during app teardown.
      }
      endMicSession();
    };
  }, []);

  /**
   * Says a clip at the next quiet moment and resolves only after the clip has
   * finished playing, so `then` runs when the mic would no longer hear us.
   * Every other clip in the app (screens, announcer) stamps the same echo
   * clock in voicePack, so the permanent mic is protected app-wide.
   */
  const sayAtQuiet = useCallback((key: string, then?: () => void): void => {
    startWhenQuiet(Date.now() + VOICE_CLEAR_TIMEOUT_MS, () => {
      void (async () => {
        await sayKeyAsync(key).catch(() => false);
        then?.();
      })();
    });
  }, []);

  /**
   * Resurrects the continuous session if Android killed it. One mic session is
   * supposed to last the app's whole run, but the service can still drop it
   * (battery savers, another app grabbing the mic). This is the watchdog.
   * Starts that never open (or die instantly) count toward the failure cap so
   * a dead recogniser cannot spin forever.
   */
  const scheduleRescue = useCallback(
    (delayMs: number) => {
      if (!wantListeningRef.current || !alwaysOnRef.current || !mountedRef.current) return;
      if (!isRecogniserUsable()) return;
      if (rescueTimerRef.current != null) return; // Already scheduled.

      const sessionEverOpened = lastSessionStartAtRef.current > 0;
      const sessionIsFresh =
        sessionEverOpened && Date.now() - lastSessionStartAtRef.current < RESCUE_GRACE_MS;
      if (!sessionIsFresh) {
        failureCountRef.current += 1;
        if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
          wantListeningRef.current = false;
          sayAtQuiet('voice.failed');
          return;
        }
      }

      rescueTimerRef.current = setTimeout(() => {
        rescueTimerRef.current = null;
        if (!wantListeningRef.current || !alwaysOnRef.current || !mountedRef.current) return;
        startWhenQuiet(Date.now() + VOICE_CLEAR_TIMEOUT_MS, () => {
          void (async () => {
            try {
              ExpoSpeechRecognitionModule.stop();
            } catch {
              // Not running - exactly what we hoped.
            }
            // Give the service a beat to release the old session.
            await new Promise((resolve) => setTimeout(resolve, 300));
            if (!wantListeningRef.current || !mountedRef.current) return;
            startListeningRef.current?.(false);
          })();
        });
      }, delayMs);
    },
    [sayAtQuiet],
  );

  useSpeechRecognitionEvent('start', () => {
    setListening(true);
    // A session opened, so the last start attempt worked.
    failureCountRef.current = 0;
    lastSessionStartAtRef.current = Date.now();
  });

  useSpeechRecognitionEvent('end', () => {
    // Android 12 ends its recognizer session after each utterance even though
    // the app is still in always-on mode. Keep the control visibly active while
    // the short replacement session is being opened.
    setListening(wantListeningRef.current && alwaysOnRef.current);
    endMicSession();
    // A continuous session should never end on its own while the app runs. If
    // it does (service killed, Android <= 12 falling back to one-shot), bring
    // the mic straight back - the user never asked for silence. A session that
    // died almost immediately also counts as a failed start, so a flapping
    // service hits the failure cap instead of draining the battery.
    if (lastSessionStartAtRef.current > 0 && Date.now() - lastSessionStartAtRef.current < SHORT_SESSION_MS) {
      failureCountRef.current += 1;
    }
    scheduleRescue(SESSION_RESCUE_DELAY_MS);
  });

  const handleFinal = useCallback(
    (transcript: string) => {
      // A screen that armed dictation gets the utterance - commands are off.
      if (dictationHandlerRef.current != null) return;
      const now = Date.now();

      // Echo guard 1: a clip is on the speaker right now, or just finished -
      // whatever the mic heard in this window is us, not the user.
      if (isSelfVoiceAudible()) {
        if (transcript.trim().length > 0) {
          echoTranscriptsRef.current.push({ text: normalizeTranscript(transcript), at: now });
          echoTranscriptsRef.current = echoTranscriptsRef.current.filter(
            (entry) => now - entry.at < ECHO_RECALL_MS,
          );
        }
        return;
      }

      // Echo guard 2: a late final for something we said. Recogniser latency
      // can deliver our own clip's words well after the echo window, so they
      // are matched by content for a while longer.
      const normalized = normalizeTranscript(transcript);
      const heardFromUs = echoTranscriptsRef.current.some(
        (entry) => now - entry.at < ECHO_RECALL_MS && sameSpokenWords(entry.text, normalized),
      );
      if (heardFromUs) return;

      // Duplicate guard: the recogniser can emit the same final twice; only
      // the first may act. Time-based, because with one permanent session
      // there is no "new session" moment to reset a per-session flag.
      const accepted = lastAcceptedRef.current;
      if (
        accepted != null &&
        now - accepted.at < DUPLICATE_WINDOW_MS &&
        sameSpokenWords(normalizeTranscript(accepted.text), normalized)
      ) {
        return;
      }

      if (transcript.trim().length === 0) {
        void hapticError();
        sayAtQuiet('voice.notHeard');
        return;
      }

      lastAcceptedRef.current = { text: transcript, at: now };
      onTranscript?.(transcript);

      // Conversational flow first: when a flow is active it owns every
      // transcript - the user is answering a spoken question ("how much?"),
      // not issuing a navigation command. A suspended flow consumes nothing
      // (its own prompts are on the speaker) but still blocks command use.
      if (flowRef.current?.isActive()) {
        flowRef.current.handleTranscript(transcript);
        return;
      }

      const intent = matchVoiceIntent(transcript);
      if (intent == null) {
        // Stay in the loop; a correction must not close the microphone.
        void hapticError();
        // No clip exists for the raw transcript, so the correction comes from
        // the vcmd clip set - never an English-accented TTS reading.
        sayAtQuiet('vcmd.notCommandNative');
        return;
      }

      void hapticTick();

      if (intent === 'stop') {
        stopSpeaking();
        sayAtQuiet('voice.stopped');
        return;
      }
      if (intent === 'repeat') {
        if (!repeatLastAnnouncement()) {
          sayAtQuiet('voice.nothingToRepeat');
        }
        return;
      }
      onIntent(intent);
    },
    [onTranscript, onIntent, sayAtQuiet],
  );

  useSpeechRecognitionEvent('speechend', () => {
    // Android 12's recogniser may emit the useful transcript as partial and
    // then skip the final callback. Give a real final result time to arrive,
    // then promote the last partial exactly once.
    if (partialResultTimerRef.current != null || partialTranscriptRef.current == null) return;
    partialResultTimerRef.current = setTimeout(() => {
      partialResultTimerRef.current = null;
      const transcript = partialTranscriptRef.current;
      partialTranscriptRef.current = null;
      if (transcript != null) handleFinal(transcript);
    }, PARTIAL_RESULT_FALLBACK_MS);
  });

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript ?? '';
    if (event.isFinal === true) {
      partialTranscriptRef.current = null;
      if (partialResultTimerRef.current != null) {
        clearTimeout(partialResultTimerRef.current);
        partialResultTimerRef.current = null;
      }
      setLastTranscript(transcript);
      // Screen dictation owns the utterance when armed: fill the form, never
      // run commands with it (saying an amount mid-form must not navigate).
      const dictation = dictationHandlerRef.current;
      if (dictation != null) {
        dictation(transcript, true);
        return;
      }
      handleFinal(transcript);
    } else if (dictationHandlerRef.current != null) {
      // Interim transcript: the visible "voice input active" preview.
      dictationHandlerRef.current(transcript, false);
    } else if (transcript.trim().length > 0) {
      partialTranscriptRef.current = transcript;
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    // With one continuous session an error does not end listening - it is a
    // pothole on the road. Keep the session alive; only a dead service gets a
    // rescue. Nothing is announced here: the mic is still live and would hear
    // (and obey) our own error message.
    const code = String(event.error ?? '');
    if (code === 'no-speech' || code === 'speech-timeout') return;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      setBlockedReason('permission');
      wantListeningRef.current = false;
      sayAtQuiet('voice.permissionDenied');
      return;
    }
    if (code === 'busy' || code === 'audio-capture') {
      // Transient hardware contention - the rescue watchdog will re-arm.
      failureCountRef.current += 1;
      scheduleRescue(BUSY_RETRY_MS);
      return;
    }
    if (code === 'language-not-supported') {
      localeCache.delete(getAppLanguage());
      localeCache.set(getAppLanguage(), Promise.resolve('en-US'));
      scheduleRescue(BUSY_RETRY_MS);
      return;
    }
    scheduleRescue(SESSION_RESCUE_DELAY_MS);
  });

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Already stopped.
    }
    setListening(false);
  }, []);

  /**
   * Everything that touches the recogniser, run once the speaker is clear.
   * Hoisted so boot, the mic button and the rescue watchdog all share the
   * exact same ordering: permission -> locale -> loudspeaker mode -> start.
   */
  const openMicSession = useCallback(async (): Promise<void> => {
    let requestedLocale = 'en-US';
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setBlockedReason('permission');
        wantListeningRef.current = false;
        sayAtQuiet('voice.permissionDenied');
        return;
      }
      setBlockedReason(null);

      requestedLocale = await requestRecognitionLocale(getAppLanguage());
      // The session lives as long as the app does, so the loudspeaker routing
      // is held for the whole run - clips stay audible while the mic is open.
      beginMicSession();
      ExpoSpeechRecognitionModule.start({
        lang: requestedLocale,
        interimResults: false,
        maxAlternatives: 5,
        // THE core of the always-on mic: one session that survives silence and
        // keeps listening after every utterance, instead of ending after the
        // first result (Android 13+; older devices fall back to the watchdog).
        continuous: true,
        addsPunctuation: false,
        contextualStrings: commandVocabulary(),
      });
      setListening(true);
    } catch (error) {
      endMicSession();
      const message = String((error as Error)?.message ?? error ?? '');
      if (message.includes('language') && requestedLocale !== 'en-US') {
        localeCache.delete(getAppLanguage());
        localeCache.set(getAppLanguage(), Promise.resolve('en-US'));
        if (wantListeningRef.current && mountedRef.current) {
          startListeningRef.current?.(false);
        }
        return;
      }
      if (message.includes('busy') || message.includes('client')) {
        // The recogniser is still tearing the previous session down. Retry -
        // this is what keeps the always-on mic alive on real hardware.
        failureCountRef.current += 1;
        scheduleRescue(BUSY_RETRY_MS);
        return;
      }
      setBlockedReason('unavailable');
      wantListeningRef.current = false;
      sayAtQuiet('voice.notAvailable');
    }
  }, [sayAtQuiet, scheduleRescue]);

  const startListening = useCallback(
    (announce = true) => {
      void hapticTick();
      wantListeningRef.current = true;

      if (!isRecogniserUsable()) {
        setBlockedReason('unavailable');
        sayAtQuiet('voice.notAvailable');
        return;
      }

      // The mic must never hear the app's own voice: wait for anything on the
      // speaker (the boot welcome included) to finish before the session opens.
      startWhenQuiet(Date.now() + VOICE_CLEAR_TIMEOUT_MS, () => {
        if (!wantListeningRef.current || !mountedRef.current) return;
        stopSpeaking();
        stopVoiceClip();
        lastAcceptedRef.current = null;
        echoTranscriptsRef.current = [];
        const begin = () => void openMicSession();
        if (announce) sayAtQuiet('voice.listening', begin);
        else begin();
      });
    },
    [openMicSession, sayAtQuiet],
  );

  useEffect(() => {
    startListeningRef.current = (announce: boolean) => startListening(announce);
  }, [startListening]);

  // Auto-start once on mount when requested (app launch, per brief).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    const timer = setTimeout(() => {
      if (mountedRef.current) startListening();
    }, 600);
    return () => clearTimeout(timer);
  }, [autoStart, startListening]);

  const toggleListening = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, startListening, stopListening]);

  const value = useMemo<VoiceCommandContextValue>(
    () => ({
      listening,
      available,
      blockedReason,
      lastTranscript,
      toggleListening,
      startListening: () => startListening(),
      stopListening,
      beginDictation,
      endDictation,
      dictationActive,
    }),
    [
      available,
      beginDictation,
      blockedReason,
      dictationActive,
      endDictation,
      listening,
      lastTranscript,
      startListening,
      stopListening,
      toggleListening,
    ],
  );

  return <VoiceCommandContext.Provider value={value}>{children}</VoiceCommandContext.Provider>;
}

export function useVoiceCommands(): VoiceCommandContextValue {
  const context = useContext(VoiceCommandContext);
  if (context == null) {
    throw new Error('useVoiceCommands must be used inside VoiceCommandProvider');
  }
  return context;
}

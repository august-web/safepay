import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { repeatLastAnnouncement } from '../a11y/announcer';
import { lastSpoken } from '../a11y/spokenHistory';
import { labSpeechConfigured } from '../services/labSpeech';
import { stopSpeaking, isSpeaking } from '../services/speech';
import { hapticError, hapticTick } from '../services/haptics';
import { createCaptureLoop, type CaptureFailure } from './captureLoop';
import { matchVoiceIntent, type VoiceIntent } from './commands';
import { sayKeyAsync } from './say';
import { isSelfVoiceAudible, stopVoiceClip } from './voicePack';

type VoiceCommandContextValue = {
  /** True while the microphone is armed for capture. */
  listening: boolean;
  /** True when this device can run the HCI Lab speech backend. */
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

/** How long we keep waiting for our own voice to finish before starting anyway. */
const VOICE_CLEAR_TIMEOUT_MS = 4_000;

/** Poll interval while waiting for the app's own voice to finish. */
const VOICE_CLEAR_POLL_MS = 150;

/** How long we remember the transcript of something the mic heard from us. */
const ECHO_RECALL_MS = 8_000;

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

/** Word tokens for the content-based own-voice test (Ghanaian ranges kept). */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\u0100-\u036f ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Echo guard 3: decides whether a transcript is recogniser drift of a sentence
 * we just spoke. The per-session echo memory is small, so a clip that reached
 * the microphone just before it closed can come back seconds later as a "user
 * answer" inside a flow. This guard matches against the spoken history
 * instead, which survives everything. Conservative on purpose: at least five
 * shared words AND most of the utterance overlapping, so a user repeating a
 * short command ("me sika a aka") right after we taught it is never swallowed.
 */
function isOwnVoiceDrift(transcript: string, spoken: string | null): boolean {
  if (spoken == null) return false;
  const heard = wordsOf(transcript);
  if (heard.length < 5) return false;
  const spokenWords = new Set(wordsOf(spoken));
  const overlap = heard.filter((word) => spokenWords.has(word)).length;
  return overlap >= 5 && overlap / heard.length >= 0.6;
}

/** Duplicate/echo test: equal, or one contains the other when long enough. */
function sameSpokenWords(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
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
  /** When true, the listener starts as soon as this provider mounts. */
  autoStart?: boolean;
}

export function VoiceCommandProvider({
  children,
  onIntent,
  onTranscript,
  flowController,
  autoStart = false,
}: VoiceCommandProviderProps) {
  const [available] = useState(() => Platform.OS !== 'web' && labSpeechConfigured());
  const [listening, setListening] = useState(false);
  const [blockedReason, setBlockedReason] = useState<'permission' | 'unavailable' | null>(
    Platform.OS !== 'web' && labSpeechConfigured() ? null : 'unavailable',
  );
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  /** Live mirror of the flow controller prop for the stable event handlers. */
  const flowRef = useRef<TranscriptSink | null>(null);
  useEffect(() => {
    flowRef.current = flowController ?? null;
  }, [flowController]);

  const wantListeningRef = useRef(false);
  const mountedRef = useRef(true);
  /** Transcripts the mic picked up from our own clips - never act on them. */
  const echoTranscriptsRef = useRef<{ text: string; at: number }[]>([]);
  /** Active screen-dictation sink; set via beginDictation (P2). */
  const dictationHandlerRef = useRef<((transcript: string, isFinal: boolean) => void) | null>(null);
  const [dictationActive, setDictationActive] = useState(false);

  /**
   * Latest handlers for the capture loop, which is created once and must keep
   * calling into current state (props can change between mount and capture).
   */
  const handleTranscriptRef = useRef<(transcript: string) => void>(() => {});
  const handleFailureRef = useRef<(reason: CaptureFailure) => void>(() => {});

  const [loop] = useState(() => createCaptureLoop());

  // Handlers are attached here, not at construction: a component cannot pass
  // ref-reading closures into a render-time initializer.
  useEffect(() => {
    loop.setHandlers({
      onTranscript: (transcript) => handleTranscriptRef.current(transcript),
      onFailure: (reason) => handleFailureRef.current(reason),
    });
  }, [loop]);

  /** Stable ref so dictation can arm the loop without a dependency cycle. */
  const startListeningRef = useRef<((announce: boolean) => void) | null>(null);

  const beginDictation = useCallback(
    (handler: (transcript: string, isFinal: boolean) => void) => {
      dictationHandlerRef.current = handler;
      setDictationActive(true);
      // Dictation cannot wait for a manual mic tap (onboarding arms it on its
      // first step), so arm capture now if it is not already running.
      if (available && !loop.isRunning() && !wantListeningRef.current) {
        startListeningRef.current?.(false);
      }
    },
    [available, loop],
  );

  const endDictation = useCallback(() => {
    dictationHandlerRef.current = null;
    setDictationActive(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      wantListeningRef.current = false;
      loop.dispose();
    };
  }, [loop]);

  /**
   * Says a clip at the next quiet moment and resolves only after the clip has
   * finished playing, so `then` runs when the mic would no longer hear us.
   * Every other clip in the app (screens, announcer) stamps the same echo
   * clock in voicePack, so the capture loop is protected app-wide.
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
   * A capture window produced no transcript. Permission, configuration and
   * gateway-quota failures are terminal - swallowing them would spin the
   * microphone forever - while network and server hiccups only speak and let
   * the loop roll into the next window.
   */
  const handleFailure = useCallback(
    (reason: CaptureFailure) => {
      console.log(`[SikaVoice asr] ${reason}`);
      void hapticError();

      const stopForGood = (): void => {
        wantListeningRef.current = false;
        setListening(false);
        loop.stop({ flush: false });
      };

      switch (reason) {
        case 'permission':
          setBlockedReason('permission');
          stopForGood();
          sayAtQuiet('voice.permissionDenied');
          return;
        case 'unavailable':
        case 'no-key':
          setBlockedReason('unavailable');
          stopForGood();
          sayAtQuiet(reason === 'no-key' ? 'voice.failed' : 'voice.notAvailable');
          return;
        case 'auth':
        case 'quota':
          // Configuration/allowance problem, not a dead microphone: leave the
          // mic tappable so a fixed key or a fresh quota works on the next try.
          stopForGood();
          sayAtQuiet(reason === 'quota' ? 'voice.quota' : 'voice.failed');
          return;
        case 'offline':
        case 'timeout':
          sayAtQuiet('voice.network');
          return;
        case 'empty':
          sayAtQuiet('voice.notHeard');
          return;
        default:
          // server / too-big: our side of the wire; keep listening.
          sayAtQuiet('voice.failed');
          return;
      }
    },
    [loop, sayAtQuiet],
  );

  const handleFinal = useCallback(
    (transcript: string) => {
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

      // Echo guard 2: a late transcript for something we said. Upload latency
      // can deliver our own clip's words well after the echo window, so they
      // are matched by content for a while longer.
      const normalized = normalizeTranscript(transcript);
      const heardFromUs = echoTranscriptsRef.current.some(
        (entry) => now - entry.at < ECHO_RECALL_MS && sameSpokenWords(entry.text, normalized),
      );
      if (heardFromUs) return;

      // Echo guard 3: a transcript for a sentence spoken before the window
      // opened - matched against the spoken history (spans every window).
      if (isOwnVoiceDrift(transcript, lastSpoken())) return;

      console.log(`[SikaVoice heard] "${transcript}"`);
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
      console.log(`[SikaVoice intent] "${transcript}" -> ${intent ?? 'none'}`);
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

  /** A transcript from the loop: dictation first (commands are off while armed). */
  const handleTranscript = useCallback(
    (transcript: string) => {
      setLastTranscript(transcript);
      const dictation = dictationHandlerRef.current;
      if (dictation != null) {
        dictation(transcript, true);
        return;
      }
      handleFinal(transcript);
    },
    [handleFinal],
  );

  useEffect(() => {
    handleTranscriptRef.current = handleTranscript;
  }, [handleTranscript]);

  useEffect(() => {
    handleFailureRef.current = handleFailure;
  }, [handleFailure]);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    // Words already spoken into an open window still get uploaded - the tap
    // ends listening, it does not throw the user's sentence away.
    loop.stop({ flush: true });
    setListening(false);
  }, [loop]);

  const startListening = useCallback(
    (announce = true) => {
      void hapticTick();
      wantListeningRef.current = true;

      if (!available) {
        setBlockedReason('unavailable');
        sayAtQuiet('voice.notAvailable');
        return;
      }

      setBlockedReason(null);
      // The mic must never hear the app's own voice: wait for anything on the
      // speaker (the boot welcome included) to clear before arming capture.
      startWhenQuiet(Date.now() + VOICE_CLEAR_TIMEOUT_MS, () => {
        if (!wantListeningRef.current || !mountedRef.current) return;
        stopSpeaking();
        stopVoiceClip();
        echoTranscriptsRef.current = [];
        const begin = (): void => {
          setListening(true);
          loop.start();
        };
        if (announce) sayAtQuiet('voice.listening', begin);
        else begin();
      });
    },
    [available, loop, sayAtQuiet],
  );

  useEffect(() => {
    startListeningRef.current = startListening;
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

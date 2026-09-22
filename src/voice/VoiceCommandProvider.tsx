import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { repeatLastAnnouncement } from '../a11y/announcer';
import { i18n, getAppLanguage, type AppLanguage } from '../i18n';
import { speak } from '../services/speech';
import { hapticError, hapticTick } from '../services/haptics';
import { stopSpeaking } from '../services/speech';
import { commandVocabulary, matchVoiceIntent, type VoiceIntent } from './commands';
import { sayKey } from './say';

type VoiceCommandContextValue = {
  /** True while the microphone is open. */
  listening: boolean;
  /** True when the platform recogniser can be used on this device. */
  available: boolean;
  /** Set when voice input cannot run: `permission` or `unavailable`. */
  blockedReason: 'permission' | 'unavailable' | null;
  toggleListening: () => void;
  startListening: () => void;
  stopListening: () => void;
};

const VoiceCommandContext = createContext<VoiceCommandContextValue | null>(null);

/**
 * Recogniser locale per app language.
 *
 * Android's recogniser has no Akan or Ewe model, so Twi/Ewe requests fall back
 * to the platform default and Ghanaian English phrases still match. English
 * commands work in every language, which is why they are always in the grammar.
 */
const RECOGNITION_LOCALES: Record<AppLanguage, string> = {
  tw: 'ak-GH',
  ee: 'ee-GH',
  ga: 'en-GH',
  pcm: 'en-GH',
  en: 'en-GH',
};

function isRecogniserUsable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export interface VoiceCommandProviderProps {
  children: React.ReactNode;
  /** Called with the recognised intent; the caller performs the action. */
  onIntent: (intent: VoiceIntent) => void;
  /** Receives the raw transcript of every final result, for diagnostics. */
  onTranscript?: (transcript: string) => void;
}

export function VoiceCommandProvider({
  children,
  onIntent,
  onTranscript,
}: VoiceCommandProviderProps) {
  const [listening, setListening] = useState(false);
  const [available] = useState(() => isRecogniserUsable());
  const [blockedReason, setBlockedReason] = useState<'permission' | 'unavailable' | null>(
    isRecogniserUsable() ? null : 'unavailable',
  );

  /** One action per recognition session, so a late result cannot act twice. */
  const handledRef = useRef(false);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));

  const handleTranscript = useCallback(
    (transcript: string, isFinal: boolean) => {
      if (!isFinal || handledRef.current) return;
      onTranscript?.(transcript);

      const intent = matchVoiceIntent(transcript);
      if (intent == null) {
        handledRef.current = true;
        void hapticError();
        if (transcript.trim().length === 0) {
          sayKey('voice.notHeard');
        } else {
          // Contains the recognised text, so there is no clip for it.
          speak(
            i18n.t('voice.unknown', { text: transcript.trim() }),
            getAppLanguage(),
          );
        }
        return;
      }

      handledRef.current = true;
      void hapticTick();

      if (intent === 'stop') {
        stopSpeaking();
        sayKey('voice.stopped');
        return;
      }
      if (intent === 'repeat') {
        if (!repeatLastAnnouncement()) {
          sayKey('voice.nothingToRepeat');
        }
        return;
      }
      onIntent(intent);
    },
    [onIntent, onTranscript],
  );

  useSpeechRecognitionEvent('result', (event) => {
    handleTranscript(event.results?.[0]?.transcript ?? '', event.isFinal === true);
  });

  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    const code = String(event.error ?? '');
    if (code === 'no-speech' || code === 'speech-timeout') {
      sayKey('voice.noSpeech');
      return;
    }
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      setBlockedReason('permission');
      sayKey('voice.permissionDenied');
      return;
    }
    sayKey('voice.failed');
  });

  const stopListening = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Already stopped.
    }
    setListening(false);
  }, []);

  const startListening = useCallback(async () => {
    if (!isRecogniserUsable()) {
      setBlockedReason('unavailable');
      sayKey('voice.notAvailable');
      return;
    }

    void hapticTick();
    // Listening while the app talks means the microphone hears SikaVoice itself.
    stopSpeaking();
    handledRef.current = false;

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setBlockedReason('permission');
        sayKey('voice.permissionDenied');
        return;
      }
      setBlockedReason(null);

      sayKey('voice.listening');
      ExpoSpeechRecognitionModule.start({
        lang: RECOGNITION_LOCALES[getAppLanguage()] ?? 'en-GH',
        interimResults: true,
        maxAlternatives: 5,
        continuous: false,
        addsPunctuation: false,
        contextualStrings: commandVocabulary(),
      });
      setListening(true);
    } catch {
      setBlockedReason('unavailable');
      sayKey('voice.notAvailable');
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (listening) stopListening();
    else void startListening();
  }, [listening, startListening, stopListening]);

  // Never leave the microphone open when this tree goes away.
  useEffect(() => {
    return () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Not started.
      }
    };
  }, []);

  const value = useMemo<VoiceCommandContextValue>(
    () => ({
      listening,
      available,
      blockedReason,
      toggleListening,
      startListening: () => void startListening(),
      stopListening,
    }),
    [available, blockedReason, listening, startListening, stopListening, toggleListening],
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

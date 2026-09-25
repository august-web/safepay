import { useCallback, useEffect, useRef, useState } from 'react';

import { useVoiceCommands } from './VoiceCommandProvider';

/**
 * Screen-level voice dictation (P2).
 *
 * The always-on microphone session is shared app-wide, so this hook does NOT
 * open a second recogniser (two sessions would fight over the service).
 * Instead it arms "dictation mode" on the provider: the next utterance the
 * permanent mic hears is routed here as form input instead of being matched
 * as a command.
 *
 * Behaviour per the demo requirements:
 *  - ONE spoken utterance per arming ("send 50 cedis to Ama").
 *  - Interim results stream into `preview` so there is a visibly working
 *    "voice input active" state while the user speaks.
 *  - The final transcript is handed to `onFinal` once; dictation then ends
 *    automatically, so the spoken read-back can never loop back into the
 *    form through the mic.
 */
export function useScreenDictation(onFinal: (transcript: string) => void): {
  /** True while the mic is capturing the dictation utterance. */
  dictationActive: boolean;
  /** Live transcript preview (interim while speaking, final after). */
  preview: string | null;
  /** Arms one-shot dictation. Safe to call again; rearms. */
  startDictation: () => void;
  /** Cancels dictation without applying anything. */
  stopDictation: () => void;
} {
  const { beginDictation, endDictation } = useVoiceCommands();
  const [dictationActive, setDictationActive] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  /** Keeps the newest callback without re-arming when the screen re-renders. */
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const handleEvent = useCallback((transcript: string, isFinal: boolean) => {
    if (isFinal) {
      setPreview(transcript);
      // One utterance per arming: end first so the read-back we are about to
      // speak cannot be re-captured, then hand the transcript over.
      endDictation();
      onFinalRef.current(transcript);
    } else {
      setPreview(transcript);
    }
  }, [endDictation]);

  const startDictation = useCallback(() => {
    setPreview(null);
    setDictationActive(true);
    beginDictation(handleEvent);
  }, [beginDictation, handleEvent]);

  const stopDictation = useCallback(() => {
    setDictationActive(false);
    endDictation();
  }, [endDictation]);

  // Leaving the screen must never leave dictation armed against the next
  // user utterance on some other screen.
  useEffect(() => {
    return () => {
      endDictation();
    };
  }, [endDictation]);

  return { dictationActive, preview, startDictation, stopDictation };
}

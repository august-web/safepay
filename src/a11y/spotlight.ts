import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { isSpeakingSync } from '../services/speech';
import { isSelfVoiceAudible } from '../voice/voicePack';

/**
 * "The screen follows the ear."
 *
 * One element at a time owns the spotlight: the thing the app is speaking, or
 * the thing the user just touched. Everything else recedes, so a low-vision user
 * who has lost the screen reader's focus frame can still find where the audio
 * is, and a sighted helper sees the same position the blind user hears.
 *
 * RN cannot observe VoiceOver / TalkBack element focus from JavaScript, so this
 * is driven by the app's own output and by touch - never claimed to track the
 * OS cursor.
 */

let activeId: string | null = null;
const listeners = new Set<() => void>();

export function getSpotlight(): string | null {
  return activeId;
}

export function setSpotlight(id: string | null): void {
  if (activeId === id) return;
  activeId = id;
  for (const listener of listeners) listener();
}

/** Clears the spotlight only if `id` still owns it, so a newer element wins. */
export function releaseSpotlight(id: string): void {
  if (activeId === id) setSpotlight(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSpotlight(): string | null {
  return useSyncExternalStore(subscribe, getSpotlight);
}

const TICK_MS = 150;
/**
 * Clips report their own busy state, so the light can end with the last
 * syllable. Channels that report nothing (live-region announcements) fall back
 * to this grace window, and CAP_TICKS is the ceiling that stops any element
 * holding the screen forever.
 */
const GRACE_TICKS = 5;
const CAP_TICKS = 80;

/** Returns a `light(id)` function: put the screen on `id` while it is audible. */
export function useEarLight(): (id: string) => void {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current != null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stop();
      setSpotlight(null);
    };
  }, [stop]);

  return useCallback(
    (id: string) => {
      stop();
      setSpotlight(id);
      let ticks = 0;
      timer.current = setInterval(() => {
        ticks += 1;
        const busy = isSelfVoiceAudible() || isSpeakingSync();
        if (ticks > CAP_TICKS || (!busy && ticks > GRACE_TICKS)) {
          stop();
          releaseSpotlight(id);
        }
      }, TICK_MS);
    },
    [stop],
  );
}

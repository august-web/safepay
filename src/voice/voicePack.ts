import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

import type { AppLanguage } from '../i18n';
import { setClipPlaybackMode } from '../../modules/audio-route';
import { VOICE_CLIP_COUNTS, VOICE_CLIPS } from './voicePack.generated';

/**
 * Bundled native voice clips.
 *
 * Google's on-device TTS ships no Akan, Ewe or Ga voice, so Twi and Ewe text
 * was being read by an English voice. All fixed phrases and composed sentences
 * for these languages are pre-rendered from Meta's MMS models by
 * `scripts/generate-voice-clips.py` and played from the app bundle: no network,
 * no API key, no English accent.
 */

let currentPlayer: AudioPlayer | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Echo suppression for the always-on microphone.
 *
 * The mic is live for the app's whole run, so it hears every prompt and
 * confirmation the app itself plays. Every clip playback stamps this clock;
 * the recogniser's finals are dropped until well after the last clip ends,
 * because what the mic picks up in that window is us, not the user.
 */
let lastClipEndedAt = 0;
/**
 * Short blanket tail: anything finalised DURING playback is echo (dropped and
 * remembered by content); the tail only covers the finalisation latency of a
 * clip that ended a moment ago. Late echo is caught by content matching in
 * the provider, so this tail must stay short or real answers get eaten.
 */
const ECHO_TAIL_MS = 400;

/** True while the continuous mic would still hear our own recent clip. */
export function inEchoWindow(): boolean {
  return Date.now() - lastClipEndedAt < ECHO_TAIL_MS;
}

/** Count of active recognition sessions that need loudspeaker routing. */
let micSessionCount = 0;

/**
 * Android routes media audio to the earpiece while a recognition session is
 * open, which would make every prompt inaudible for a blind user. During a
 * session we hold `MODE_IN_COMMUNICATION` + speakerphone so clips stay on the
 * loudspeaker, then restore normal routing when the session ends.
 */
export function beginMicSession(): void {
  micSessionCount += 1;
  if (micSessionCount === 1 && Platform.OS === 'android') {
    setClipPlaybackMode(true);
  }
}

export function endMicSession(): void {
  micSessionCount = Math.max(0, micSessionCount - 1);
  if (micSessionCount === 0 && Platform.OS === 'android') {
    setClipPlaybackMode(false);
  }
}

/**
 * Audio mode for the app: clips must play even with the ringer off, and must
 * mix over anything else playing (never duck another app's media silently).
 */
export async function configureVoiceAudioMode(): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    // Web/iOS quirks - best effort, clips still play with defaults.
  }
}

export function hasVoiceClip(key: string, language: AppLanguage): boolean {
  return VOICE_CLIPS[language]?.[key] != null;
}

/** How many clips ship for a language - shown in Settings diagnostics. */
export function voiceClipCount(language: AppLanguage): number {
  return VOICE_CLIP_COUNTS[language] ?? 0;
}

/** True while a clip is on the speaker - used to keep the mic from hearing us. */
export function isClipPlaying(): boolean {
  return currentPlayer != null;
}

/**
 * Combined self-voice guard for recognition results: a clip is on the speaker
 * right now, or one just finished and the mic may still be picking up its
 * tail. Used to drop echo transcripts from the continuous session.
 */
export function isSelfVoiceAudible(): boolean {
  return isClipPlaying() || inEchoWindow();
}

export function stopVoiceClip(): void {
  if (fallbackTimer != null) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  const player = currentPlayer;
  if (player != null) lastClipEndedAt = Date.now();
  currentPlayer = null;
  if (player == null) return;
  try {
    player.pause();
    player.remove();
  } catch {
    // Already released.
  }
}

/**
 * Plays the clip for a key.
 *
 * @returns true when a clip existed and playback started (or completed),
 *   false when this language has no clip, so the caller can use device TTS.
 */
export function playVoiceClip(key: string, language: AppLanguage): Promise<boolean> {
  const source = VOICE_CLIPS[language]?.[key];
  if (source == null) return Promise.resolve(false);

  stopVoiceClip();

  return new Promise<boolean>((resolve) => {
    try {
      const player = createAudioPlayer(source);
      currentPlayer = player;

      let settled = false;
      const finish = (played: true) => {
        if (settled) return;
        settled = true;
        if (fallbackTimer != null) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        try {
          player.remove();
        } catch {
          // Already released.
        }
        if (currentPlayer === player) currentPlayer = null;
        lastClipEndedAt = Date.now();
        resolve(played);
      };

      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) finish(true);
      });

      player.play();

      // Safety net: clips are short; never hang a composed sentence on one.
      fallbackTimer = setTimeout(() => finish(true), 15_000);
    } catch {
      resolve(false);
    }
  });
}

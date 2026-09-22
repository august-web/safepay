import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import type { AppLanguage } from '../i18n';
import { VOICE_CLIP_COUNTS, VOICE_CLIPS } from './voicePack.generated';

/**
 * Bundled native voice clips.
 *
 * Google's on-device TTS ships no Akan, Ewe or Ga voice, so without this the
 * Twi and Ewe text a user hears is read by an English voice. The fixed phrases
 * they hear most are pre-rendered from Meta's MMS models by
 * `scripts/generate-voice-clips.py` and played from the app bundle: no network,
 * no API key, and correct pronunciation.
 *
 * Dynamic sentences (amounts, recipients) have no clip and fall back to device
 * TTS - see `sayKey` in `./say`.
 */

let currentPlayer: AudioPlayer | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

export function hasVoiceClip(key: string, language: AppLanguage): boolean {
  return VOICE_CLIPS[language]?.[key] != null;
}

/** How many clips ship for a language - shown in Settings diagnostics. */
export function voiceClipCount(language: AppLanguage): number {
  return VOICE_CLIP_COUNTS[language] ?? 0;
}

export function stopVoiceClip(): void {
  if (fallbackTimer != null) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  const player = currentPlayer;
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
      const finish = (played: boolean) => {
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
        resolve(played);
      };

      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) finish(true);
      });

      player.play();

      // Safety net: a clip is only a few seconds long, so never hang the caller.
      fallbackTimer = setTimeout(() => finish(true), 15_000);
    } catch {
      resolve(false);
    }
  });
}

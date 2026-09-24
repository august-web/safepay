import { AccessibilityInfo, Platform } from 'react-native';

import { getAppLanguage } from '../i18n';
import { speak, stopSpeaking } from '../services/speech';
import { needsOwnVoice } from './screenReader';
import { lastSpoken, lastSpokenClip, rememberSpoken } from './spokenHistory';
import { hasVoiceClip, playVoiceClip } from '../voice/voicePack';
import { hasNativeVoicePack } from '../voice/commandText';

/**
 * Central announcer for state changes, per the SikaVoice brief:
 * screen-reader users must never be left waiting silently.
 *
 * Two channels, chosen automatically:
 *  1. A screen reader (TalkBack / VoiceOver) is running - post to the live
 *     region so the user hears one voice, with their own speech settings.
 *  2. No screen reader - the live region is a black hole, so the app speaks
 *     through its own output. Without this, a blind user who has not enabled
 *     TalkBack (the common case on a first install) heard nothing at all.
 *
 * Voice policy: for languages with a native clip pack (Twi, Ewe) the app NEVER
 * hands the sentence to device TTS - there is no Akan/Ewe/Gã voice on the
 * phone, so TTS reads the orthography with an English accent. Fixed phrases
 * replay their recorded clip; dynamic sentences are composed from native
 * number/name clips at their call sites via `sayPlan`/`speakMoney`. If a piece
 * has no clip, this function deliberately says nothing rather than playing the
 * wrong voice - and logs so the gap is visible during development.
 */
export function announce(message: string, assertive = false): void {
  if (message == null || message.trim().length === 0) return;

  const language = getAppLanguage();
  rememberSpoken(message);

  if (needsOwnVoice()) {
    if (hasNativeVoicePack(language)) {
      // Clip pack covers this language: dynamic text is composed upstream
      // (sayPlan/speakMoney). Raw text here has no clip - stay silent.
      console.warn('[SikaVoice] no native clip for announcement in', language, '-', message);
      return;
    }
    speak(message, language);
    return;
  }

  if (Platform.OS === 'ios') {
    // iOS honors priority through the announcement queue; keep it simple.
    void AccessibilityInfo.announceForAccessibility(message);
    return;
  }
  void AccessibilityInfo.announceForAccessibility(message);
  void assertive; // Android's API does not expose urgency levels; kept for call-site clarity.
}

export function announceError(message: string): void {
  announce(message);
}

export function announceSuccess(message: string): void {
  announce(message);
}

/** Which channel currently carries spoken output - used by Settings diagnostics. */
export function voiceChannel(): 'screenReader' | 'tts' {
  return needsOwnVoice() ? 'tts' : 'screenReader';
}

/** Plays a recorded clip through the announce history so "repeat" can replay it. */
export function announceClip(key: string): void {
  const language = getAppLanguage();
  if (!hasVoiceClip(key, language)) {
    console.warn('[SikaVoice] missing clip announced:', key, language);
    return;
  }
  stopSpeaking();
  rememberSpoken(key, key);
  void playVoiceClip(key, language);
}

/**
 * Re-speaks the last thing the app said, however it was said (announcement,
 * native clip or composed plan), so "repeat" works after a balance read-back.
 */
export function repeatLastAnnouncement(): boolean {
  const previous = lastSpoken();
  if (previous == null) return false;

  const language = getAppLanguage();
  const clip = lastSpokenClip();
  if (clip != null && hasVoiceClip(clip, language)) {
    stopSpeaking();
    rememberSpoken(previous, clip);
    void playVoiceClip(clip, language);
    return true;
  }

  // Composed plans record their full sentence; a whole sentence has no single
  // clip, so for native-pack languages we cannot replay it - say so honestly
  // rather than switching to an English voice.
  if (hasNativeVoicePack(language)) return false;

  announce(previous);
  return true;
}

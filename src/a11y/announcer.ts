import { AccessibilityInfo, Platform } from 'react-native';

import { getAppLanguage } from '../i18n';
import { speak, stopSpeaking } from '../services/speech';
import { needsOwnVoice } from './screenReader';
import { lastSpoken, lastSpokenClip, rememberSpoken } from './spokenHistory';
import { hasVoiceClip, playVoiceClip } from '../voice/voicePack';

/**
 * Central announcer for state changes, per the SikaVoice brief:
 * screen-reader users must never be left waiting silently.
 *
 * Two channels, chosen automatically:
 *  1. A screen reader (TalkBack / VoiceOver) is running - post to the live
 *     region so the user hears one voice, with their own speech settings.
 *  2. No screen reader - the live region is a black hole, so the app speaks
 *     through its own TTS engine. Without this, a blind user who has not
 *     enabled TalkBack (the common case on a first install) heard nothing at
 *     all: every success, error and read-back was silent.
 */
export function announce(message: string, assertive = false): void {
  if (message == null || message.trim().length === 0) return;

  rememberSpoken(message);

  if (needsOwnVoice()) {
    speak(message, getAppLanguage());
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

/**
 * Re-speaks the last thing the app said, however it was said (announcement,
 * native clip or direct TTS), so "repeat" works after a balance read-back too.
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

  announce(previous);
  return true;
}

import { rememberSpoken } from '../a11y/spokenHistory';
import { getAppLanguage, i18n, type AppLanguage } from '../i18n';
import { speak, stopSpeaking } from '../services/speech';
import { hasVoiceClip, playVoiceClip, stopVoiceClip } from './voicePack';

export interface SayOptions {
  language?: AppLanguage;
  /** Text used if there is no clip: the translated string, or a template result. */
  fallbackText?: string;
  rate?: number;
}

/**
 * Says an i18n string, preferring the bundled native clip.
 *
 * Clips exist only for fixed phrases. Anything dynamic - an amount, a recipient
 * name, an error reason - has no clip, so this degrades to device TTS rather
 * than staying silent.
 *
 * @returns 'clip' or 'tts', so callers can report which voice was used.
 */
export function sayKey(key: string, options: SayOptions = {}): 'clip' | 'tts' {
  const language = options.language ?? getAppLanguage();
  const text = options.fallbackText ?? i18n.t(key);

  if (hasVoiceClip(key, language)) {
    // Device TTS and a clip must never overlap.
    stopSpeaking();
    rememberSpoken(text, key);
    void playVoiceClip(key, language).then((played) => {
      // A failed clip falls back to speech rather than leaving a silence.
      if (!played) speak(text, language, options.rate);
    });
    return 'clip';
  }

  stopVoiceClip();
  speak(text, language, options.rate);
  return 'tts';
}

/** Stops both voices. */
export function stopAllVoices(): void {
  stopSpeaking();
  stopVoiceClip();
}

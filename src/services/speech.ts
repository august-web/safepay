import * as Speech from 'expo-speech';

import type { AppLanguage } from '../i18n';
import { rememberSpoken } from '../a11y/spokenHistory';
import { getCachedSettings } from './settings';

/**
 * Maps app languages to BCP-47 voice locales available on device.
 *
 * Android's TTS engine answers `isLanguageAvailable` for these and expo-speech
 * falls back to the device default locale when a language pack is missing, so
 * a missing Twi/Ewe/Ga voice degrades to intelligible speech rather than
 * silence.
 */
const SPEECH_LOCALES: Record<AppLanguage, string> = {
  tw: 'ak-GH', // Akan (Ghana)
  ee: 'ee-GH', // Ewe (Ghana)
  ga: 'ga-GH', // Gã (Ghana)
  pcm: 'en-GH', // Ghanaian Pidgin - rendered with West African English cadence
  en: 'en-GH',
};

/** Voices we have confirmed exist on this device, resolved once per locale. */
const resolvedLocales = new Map<string, string | null>();

let engineProbe: Promise<void> | null = null;

/**
 * Asks the engine which languages it actually has. Used to pick a locale that
 * will produce sound instead of trusting the request blindly.
 */
async function probeEngine(): Promise<void> {
  if (engineProbe != null) return engineProbe;
  engineProbe = (async () => {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      for (const voice of voices) {
        const language = (voice.language ?? '').replace('_', '-');
        if (language.length === 0) continue;
        resolvedLocales.set(language.toLowerCase(), voice.identifier);
        const short = language.split('-')[0]?.toLowerCase();
        if (short != null && !resolvedLocales.has(short)) {
          resolvedLocales.set(short, voice.identifier);
        }
      }
    } catch {
      // Engine unavailable (web, missing speech services): keep the request as-is.
    }
  })();
  return engineProbe;
}

/** Kicks off the voice probe early so the first utterance is not delayed. */
export function warmUpSpeech(): void {
  void probeEngine();
}

/**
 * Picks the best voice for a locale: exact match, then language-only match,
 * then undefined so the engine uses its own default voice.
 */
function pickVoice(locale: string): string | undefined {
  return resolvedLocales.get(locale.toLowerCase()) ?? undefined;
}

/**
 * Speaks `text` aloud through the device TTS engine.
 *
 * Always resolves the previous utterance first: `Speech.stop()` is asynchronous
 * on Android, and speaking in the same tick can be swallowed by the engine -
 * which sounds exactly like "the voice does not work".
 */
export type SpeakHandlers = {
  onStart?: () => void;
  /** Fired when the utterance finishes normally. */
  onDone?: () => void;
  /** Fired when the utterance is interrupted (a newer utterance or stop()). */
  onStopped?: () => void;
  onError?: (error: Error) => void;
};

export function speak(
  text: string,
  language: AppLanguage = 'tw',
  overrideRate?: number,
  handlers?: SpeakHandlers,
): void {
  const trimmed = text?.trim();
  if (trimmed == null || trimmed.length === 0) {
    handlers?.onDone?.();
    return;
  }

  const rate = overrideRate ?? getCachedSettings().speechRate ?? 0.85;
  const locale = SPEECH_LOCALES[language] ?? SPEECH_LOCALES.en;
  const voice = pickVoice(locale);
  // Recorded so a spoken "repeat" can replay the last read-back.
  rememberSpoken(trimmed);

  void (async () => {
    try {
      await Speech.stop();
    } catch {
      // Nothing was speaking.
    }
    Speech.speak(trimmed, {
      language: locale,
      ...(voice != null ? { voice } : {}),
      rate,
      pitch: 1.0,
      volume: 1.0,
      onStart: handlers?.onStart,
      onDone: handlers?.onDone,
      onStopped: handlers?.onStopped,
      onError: (error: Error) => {
        // Surface engine failures instead of failing silently.
        console.warn('[SikaVoice speech] utterance failed', error?.message ?? error);
        handlers?.onError?.(error);
      },
    });
  })();
}

export function stopSpeaking(): void {
  try {
    void Speech.stop();
  } catch {
    // Engine not initialised yet.
  }
}

export type VoiceStatus = {
  /** Locale we asked for, e.g. `ee-GH`. */
  requested: string;
  /** Voice identifier the engine will use, or null when it falls back. */
  voice: string | null;
  /** False until the engine has answered the voice probe. */
  ready: boolean;
};

/**
 * What the engine will actually speak with.
 *
 * Google TTS ships no Akan/Ewe/Gã voices, so Twi text on most phones is read
 * by the device's default (usually English) voice. Surfacing that in Settings
 * keeps the gap visible instead of hiding it behind a locale code.
 */
export function voiceStatusFor(language: AppLanguage): VoiceStatus {
  const requested = SPEECH_LOCALES[language] ?? SPEECH_LOCALES.en;
  return {
    requested,
    voice: pickVoice(requested) ?? null,
    ready: resolvedLocales.size > 0,
  };
}

export function isSpeaking(): Promise<boolean> {
  try {
    return Speech.isSpeakingAsync();
  } catch {
    return Promise.resolve(false);
  }
}

/** Locale currently used for a language - shown in Settings diagnostics. */
export function speechLocaleFor(language: AppLanguage): string {
  return SPEECH_LOCALES[language] ?? SPEECH_LOCALES.en;
}

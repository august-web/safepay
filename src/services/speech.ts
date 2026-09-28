import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

import type { AppLanguage } from '../i18n';
import { rememberSpoken } from '../a11y/spokenHistory';
import { getCachedSettings } from './settings';
import { labAltApiKey, labSpeechConfigured } from './labSpeech';
import { TTS_DAILY_LIMIT, synthesizeTts, synthesizeTtsPublic, ttsRemaining } from './labTts';

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

/**
 * Synchronous snapshot of "the app is speaking right now", for the capture
 * loop's VAD - `isSpeakingAsync()` asks the engine, which is too slow to call
 * between sample windows. Set when the utterance is handed to the engine and
 * cleared by its callbacks; the blanket cap clears it even if the engine never
 * reports back, so a TTS failure can never leave the microphone deaf.
 */
let speakingSync = false;
let speakingCapTimer: ReturnType<typeof setTimeout> | null = null;
const SPEAKING_CAP_MS = 15_000;

export function isSpeakingSync(): boolean {
  return speakingSync;
}

function clearSpeakingSync(): void {
  speakingSync = false;
  if (speakingCapTimer != null) {
    clearTimeout(speakingCapTimer);
    speakingCapTimer = null;
  }
}

function markSpeakingSync(): void {
  clearSpeakingSync();
  speakingSync = true;
  speakingCapTimer = setTimeout(clearSpeakingSync, SPEAKING_CAP_MS);
}

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

    // Hold the mic-VAD flag through the Lab network round-trip (and through
    // the device fallback) so the capture loop's quiet gate keeps the mic shut
    // while we are still deciding how to speak.
    markSpeakingSync();

    // Lab TTS first for Ghanaian languages: native voice where device TTS
    // would read Twi/Ewe/Ga orthography with an English accent. On any Lab
    // failure the call falls through to device TTS below, so a quota/network
    // problem never silences the app - the previous device-only behaviour is
    // preserved. The capture loop's quiet gate already waits on
    // `isSpeakingSync()` (which Lab playback sets), so the mic never hears us.
    if (LAB_TTS_LANGUAGES.has(language)) {
      const played = await speakViaLab(trimmed, language, handlers);
      if (played) return;
      // Lab unavailable / quota used / no key: native voice via the public
      // GhanaNLP endpoint (unauthenticated, audio/wav). We try it before device
      // TTS so a Ghanaian language never degrades to an English accent until
      // both native paths have failed; device TTS remains the last resort.
      const playedPub = await speakViaPublic(trimmed, language, handlers);
      if (playedPub) return;
    }

    markSpeakingSync();
    Speech.speak(trimmed, {
      language: locale,
      ...(voice != null ? { voice } : {}),
      rate,
      pitch: 1.0,
      volume: 1.0,
      onStart: () => {
        markSpeakingSync();
        handlers?.onStart?.();
      },
      onDone: () => {
        clearSpeakingSync();
        handlers?.onDone?.();
      },
      onStopped: () => {
        clearSpeakingSync();
        handlers?.onStopped?.();
      },
      onError: (error: Error) => {
        // Surface engine failures instead of failing silently.
        clearSpeakingSync();
        console.warn('[SikaVoice speech] utterance failed', error?.message ?? error);
        handlers?.onError?.(error);
      },
    });
  })();
}

/** Languages the HCI Lab can speak natively; device TTS reads them with an English accent. */
const LAB_TTS_LANGUAGES: ReadonlySet<AppLanguage> = new Set<AppLanguage>(['tw', 'ee', 'ga']);

export function stopSpeaking(): void {
  clearSpeakingSync();
  stopLabPlayer();
  try {
    void Speech.stop();
  } catch {
    // Engine not initialised yet.
  }
}

/** State for a Lab-synthesised WAV played through expo-audio. */
let labPlayer: AudioPlayer | null = null;
let labCapTimer: ReturnType<typeof setTimeout> | null = null;

function stopLabPlayer(): void {
  if (labCapTimer != null) {
    clearTimeout(labCapTimer);
    labCapTimer = null;
  }
  const player = labPlayer;
  labPlayer = null;
  if (player == null) return;
  try {
    player.pause();
    player.remove();
  } catch {
    // Already released.
  }
}

/** Uint8Array -> base64 via the global `btoa` (always present on RN/Hermes). */
function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as unknown as { btoa?: (input: string) => string };
  const encode = g.btoa;
  if (typeof encode !== 'function') {
    throw new Error('btoa is not available in this runtime');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return encode(binary);
}

/**
 * Plays a Lab-synthesised WAV from the given bytes, mapping completion onto the
 * `SpeakHandlers` contract so callers sequence the same as device TTS. Returns
 * true only when playback was handed off (and `onDone`/`onStopped` will fire);
 * false when the Lab path could not start, so the caller falls back.
 */
async function playLabWav(
  wav: Uint8Array,
  handlers?: SpeakHandlers,
): Promise<boolean> {
  const cacheDir = FileSystem.cacheDirectory;
  if (cacheDir == null) {
    console.warn('[SikaVoice tts] no cache directory, falling back to device');
    return false;
  }
  // cacheDirectory is already a file:// URI; prefixing it again makes the
  // native writer reject the path ("...isn't writable") and silently fall back.
  const fileUri = `${cacheDir}tts-${Date.now()}.wav`;
  try {
    await FileSystem.writeAsStringAsync(fileUri, bytesToBase64(wav), {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (error) {
    console.warn('[SikaVoice tts] cache write failed, falling back to device:', error);
    return false;
  }

  stopLabPlayer();
  const player = createAudioPlayer({ uri: fileUri });
  labPlayer = player;
  markSpeakingSync();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (done: boolean) => {
      if (settled) return;
      settled = true;
      if (labCapTimer != null) {
        clearTimeout(labCapTimer);
        labCapTimer = null;
      }
      try {
        player.remove();
      } catch {
        // Already released.
      }
      if (labPlayer === player) labPlayer = null;
      clearSpeakingSync();
      void FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
      resolve(done);
      if (done) handlers?.onDone?.();
      else handlers?.onStopped?.();
    };

    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) finish(true);
    });

    player.play();
    // Safety net: never hold the mic-VAD flag on a stuck Lab playback - same
    // 15s cap as the clip player.
    labCapTimer = setTimeout(() => finish(false), SPEAKING_CAP_MS);
  });
}

/**
 * Tries the HCI Lab TTS gateway for `language` (native voice for Ghanaian
 * languages). Returns true if a WAV was played; false to let the caller fall
 * back to device TTS. Any failure is logged and swallowed as a fallback.
 */
async function speakViaLab(
  text: string,
  language: AppLanguage,
  handlers?: SpeakHandlers,
): Promise<boolean> {
  try {
    const result = await synthesizeTts({ text, language });
    if (!result.ok) {
      console.log(
        `[SikaVoice tts] lab unavailable (${result.reason}); device fallback for ${language}`,
      );
      return false;
    }
    return playLabWav(result.wav, handlers);
  } catch (error) {
    console.log('[SikaVoice tts] lab attempt threw, falling back to device:', error);
    return false;
  }
}

/**
 * Tier-3 native fallback: the public GhanaNLP Translator TTS endpoint
 * (translate.ghananlp.org/api/tts). Shares the WAV playback contract with the
 * Lab path via `playLabWav`; returns false when this also fails (network off,
 * 429, malformed response) so device TTS is the never-break last resort.
 */
async function speakViaPublic(
  text: string,
  language: AppLanguage,
  handlers?: SpeakHandlers,
): Promise<boolean> {
  try {
    const result = await synthesizeTtsPublic({ text, language });
    if (!result.ok) {
      console.log(
        `[SikaVoice tts] public unavailable (${result.reason}); device fallback for ${language}`,
      );
      return false;
    }
    return playLabWav(result.wav, handlers);
  } catch (error) {
    console.log('[SikaVoice tts] public attempt threw, falling back to device:', error);
    return false;
  }
}

export type TtsVoiceStatus = {
  /**
   * Which native-accent path handles this language: the Lab gateway (keyed +
   * quota-metered), the public GhanaNLP endpoint (unauthenticated fallback), or
   * the device engine (no native model exists, or all native paths unreachable).
   */
  channel: 'lab' | 'public' | 'device';
  keyPresent: boolean;
  used: number;
  limit: number;
  remaining: number;
};

/**
 * Reports which TTS path Settings should show for `language`:
 *  - 'lab'    : native Lab voice (key configured + daily quota remaining)
 *  - 'public' : native voice via the public GhanaNLP endpoint (Lab key absent
 *               or quota spent) - English-accented device TTS is avoided
 *  - 'device' : no native model exists for this language (e.g. en/pcm)
 */
export async function ttsVoiceStatusFor(
  language: AppLanguage,
): Promise<TtsVoiceStatus> {
  const keyPresent = labSpeechConfigured() || labAltApiKey() != null;
  const remaining = await ttsRemaining();
  const used = Math.max(0, TTS_DAILY_LIMIT - remaining);
  const nativeCapable = LAB_TTS_LANGUAGES.has(language);
  let channel: TtsVoiceStatus['channel'];
  if (keyPresent && remaining > 0 && nativeCapable) channel = 'lab';
  else if (nativeCapable) channel = 'public';
  else channel = 'device';
  return {
    channel,
    keyPresent,
    used,
    limit: TTS_DAILY_LIMIT,
    remaining,
  };
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

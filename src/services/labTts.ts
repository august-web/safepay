import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AppLanguage } from '../i18n';
import {
  labAltApiKey,
  labAltBaseUrl,
  labApiKey,
  labBaseUrl,
} from './labSpeech';

/**
 * University of Ghana HCI Lab TTS (text-to-speech).
 *
 * Phase II of the MTN Tɛkyerɛma Pa programme requires ASR/TTS to run on the
 * lab's APIs, so this replaces the Meta-MMS-rendered voice clips and device
 * `expo-speech` for the dynamic sentences (balances, amounts, recipient
 * names) that have no pre-rendered clip. The gateway endpoint is
 * `POST /api/v1/tts` on the same host as `labSpeech.ts`; the live API returns
 * a RIFF/WAVE buffer.
 *
 * Free-tier quotas are tight (15 TTS requests/day, 5/min), so callers should
 * prefer the pre-rendered native clips in `src/voice/voicePack.ts` and only
 * drop to Lab TTS for text that has no clip. A 15/day local meter (the same
 * pattern as `labSpeech.ts` ASR) lets Settings report head-room so the demo
 * never surprise-fails on the hackathon floor.
 */

/** Free-tier TTS allowance per calendar day; a server 429 is the source of truth. */
export const TTS_DAILY_LIMIT = 15;

const USAGE_KEY = 'safepay.ttsUsage';

export type SynthesisFailure =
  | 'no-key'
  | 'offline'
  | 'timeout'
  | 'auth'
  | 'quota'
  | 'empty'
  | 'server';

export type SynthesisResult =
  | { ok: true; wav: Uint8Array }
  | { ok: false; reason: SynthesisFailure; status?: number };

const UPLOAD_TIMEOUT_MS = 20_000;

/** Recoverable server-side failures that may differ between Lab subscriptions. */
const RETRYABLE_REASONS: ReadonlySet<SynthesisFailure> =
  new Set<SynthesisFailure>(['quota', 'auth', 'server', 'timeout']);

type UsageRecord = { date: string; count: number };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

let cachedUsage: UsageRecord | null = null;

async function loadUsage(): Promise<UsageRecord> {
  if (cachedUsage != null && cachedUsage.date === today()) return cachedUsage;
  cachedUsage = { date: today(), count: 0 };
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    if (raw != null) {
      const parsed = JSON.parse(raw) as Partial<UsageRecord>;
      cachedUsage = {
        date: typeof parsed.date === 'string' ? parsed.date : today(),
        count: typeof parsed.count === 'number' ? parsed.count : 0,
      };
      // Counts only apply to the day they were accrued on.
      if (cachedUsage.date !== today()) cachedUsage = { date: today(), count: 0 };
    }
  } catch {
    // Corrupt or unreadable ledger: start the day clean.
  }
  return cachedUsage;
}

/** True when today's local ledger says an upload is still within quota. */
export async function ttsRemaining(): Promise<number> {
  const usage = await loadUsage();
  return Math.max(0, TTS_DAILY_LIMIT - usage.count);
}

/** Counts one request that reached the server (a response of any status). */
async function recordUsage(): Promise<void> {
  const usage = await loadUsage();
  const next = { date: today(), count: usage.count + 1 };
  cachedUsage = next;
  try {
    await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(next));
  } catch {
    // Best effort; a lost write only ever costs an extra upload attempt.
  }
}

const TTS_BODY = {
  model_type: 'ss',
  speaker: 'PT',
};

async function synthOnce(
  baseUrl: string,
  key: string,
  text: string,
  language: string,
): Promise<SynthesisResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/v1/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...TTS_BODY,
        language,
        text,
      }),
      signal: controller.signal,
    });

    // Every HTTP response counts against the daily ledger - including 429s and
    // 5xx - so the local meter stays honest about how close we are.
    await recordUsage();

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'auth', status: response.status };
    }
    if (response.status === 429) {
      return { ok: false, reason: 'quota', status: response.status };
    }
    if (!response.ok) {
      return { ok: false, reason: 'server', status: response.status };
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) return { ok: false, reason: 'empty' };
    return { ok: true, wav: new Uint8Array(arrayBuffer) };
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    console.log(
      `[SikaVoice tts] upload threw ${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? ''} (text ${text.slice(0, 32)})`,
    );
    return { ok: false, reason: aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/** Maps the app language to the code the Lab TTS gateway expects. */
export function toGhanaNlpLanguage(language: AppLanguage): string {
  switch (language) {
    case 'tw':
      return 'tw';
    case 'ee':
      return 'ee';
    case 'ga':
      // Canonical GhanaNLP code is `gaa`; `ga` is the app label only. The
      // smoke cases used `ga` as a case label but the Lab gateway was never
      // sent it (ASR auto-detects); `gaa` matches the GhanaNLP-Dart enum.
      return 'gaa';
    case 'pcm':
      // The lab gateway has no Pidgin model; fall back to English pronunciation.
      return 'en';
    case 'en':
      return 'en';
    default:
      return 'en';
  }
}

/**
 * Sends `text` to the HCI Lab TTS gateway for `language` and returns the raw
 * WAV bytes (or a typed failure). Prefer the pre-rendered clips in
 * `src/voice/voicePack.ts` for fixed strings; only callers with genuinely
 * dynamic text (Live Region read-backs, dictation, amount composition) should
 * land here.
 *
 * Lab voice first, alternate Lab subscription second: if the primary gateway
 * returns a recoverable failure (quota/auth/server/timeout) and an
 * `EXPO_PUBLIC_SPEECH_API_KEY_ALT` + `_BASE_URL_ALT` pair is configured, one
 * retry is attempted on the alternate endpoint - no new dependency required.
 */
export async function synthesizeTts(params: {
  text: string;
  language: AppLanguage;
}): Promise<SynthesisResult> {
  const primaryKey = labApiKey();
  if (primaryKey == null) {
    // Primary key missing/placeholder; fall back to the alternate endpoint.
    const altBase = labAltBaseUrl();
    const altKey = labAltApiKey();
    if (altBase == null || altKey == null) {
      return { ok: false, reason: 'no-key' };
    }
    if ((await ttsRemaining()) <= 0) return { ok: false, reason: 'quota' };
    const language = toGhanaNlpLanguage(params.language);
    return synthOnce(altBase, altKey, params.text, language);
  }

  if ((await ttsRemaining()) <= 0) return { ok: false, reason: 'quota' };
  const language = toGhanaNlpLanguage(params.language);

  const primary = await synthOnce(labBaseUrl(), primaryKey, params.text, language);
  if (primary.ok) return primary;
  if (RETRYABLE_REASONS.has(primary.reason)) {
    const altBase = labAltBaseUrl();
    const altKey = labAltApiKey();
    if (altBase != null && altKey != null) {
      const alt = await synthOnce(altBase, altKey, params.text, language);
      if (alt.ok) return alt;
    }
  }
    return primary;
}

const PUBLIC_TTS_BASE = 'https://translate.ghananlp.org';

/**
 * Unauthenticated native-voice fallback: the public GhanaNLP Translator TTS
 * endpoint (`POST /api/tts` on translate.ghananlp.org). Returns a RIFF/WAVE
 * buffer with no key and no quota. SafePay's 15/day Lab meter is intentionally
 * NOT charged here - this is a separate GhanaNLP service - so a Ghanaian
 * utterance still speaks in a native accent even when no Lab key is configured
 * or the Lab quota is spent, and never degrades to an English-accented device
 * voice until both native paths (Lab + public) have failed.
 *
 * Contract verified live against the public endpoint:
 * `{"text":...,"language":"tw"}`            -> 200 audio/wav (RIFF WAVE)
 * `{"text":...,"language":"gaa"}`           -> 200 audio/wav (RIFF WAVE)
 * `{"text":...,"language":"ee"}`            -> 200 audio/wav (RIFF WAVE)
 * `{"text":...,"language":"ga"}`            -> 400 VALIDATION_FAILED (`ga` is wrong)
 */
export async function synthesizeTtsPublic(
  params: { text: string; language: AppLanguage },
): Promise<SynthesisResult> {
  const language = toGhanaNlpLanguage(params.language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(`${PUBLIC_TTS_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: params.text, language }),
      signal: controller.signal,
    });

    // The public endpoint has its own rate-limit; treat 429 as a soft miss so we
    // degrade to device TTS instead of spinning or retrying.
    if (response.status === 429) {
      return { ok: false, reason: 'quota', status: response.status };
    }
    if (!response.ok) {
      return { ok: false, reason: 'server', status: response.status };
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) return { ok: false, reason: 'empty' };
    return { ok: true, wav: new Uint8Array(arrayBuffer) };
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    console.log(
      `[SikaVoice tts] public synthesis threw ${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? ''} (text ${params.text.slice(0, 32)})`,
    );
    return { ok: false, reason: aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

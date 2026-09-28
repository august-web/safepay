import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * University of Ghana HCI Lab speech gateway (ASR + TTS).
 *
 * Phase II of the MTN Tɛkyerɛma Pa programme requires ASR/TTS to run on the
 * lab's APIs, so this replaces both the on-device recogniser and the
 * Meta-MMS-rendered voice clips. The gateway is REST: an utterance is
 * recorded to a file, uploaded, and the transcript comes back in the response.
 *
 * Free-tier quotas are tight (10 ASR requests/day), so callers must gate
 * uploads behind local VAD - see `src/voice/captureLoop.ts`.
 */

const DEFAULT_BASE_URL = 'https://lab-subscription-platform.vercel.app';

/** Free-tier ASR allowance per calendar day; server 429s are the source of truth. */
export const ASR_DAILY_LIMIT = 10;

const USAGE_KEY = 'safepay.asrUsage';

/**
 * The `.env.example` placeholder is not a URL. Treat any non-URL value as
 * unset so a half-filled `.env` still talks to the real gateway.
 */
function resolveBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/.+/.test(value) ? value : DEFAULT_BASE_URL;
}

export function labBaseUrl(): string {
  return resolveBaseUrl(process.env.EXPO_PUBLIC_SPEECH_API_BASE_URL);
}

function apiKey(): string | null {
  const value = process.env.EXPO_PUBLIC_SPEECH_API_KEY?.trim();
  if (value == null || value.length === 0) return null;
  if (value.startsWith('your_')) return null;
  return value;
}

export function labSpeechConfigured(): boolean {
  return apiKey() != null;
}

export type TranscribeFailure =
  | 'no-key'
  | 'offline'
  | 'timeout'
  | 'auth'
  | 'quota'
  | 'too-big'
  | 'empty'
  | 'server';

export type TranscribeResult =
  | { ok: true; transcript: string }
  | { ok: false; reason: TranscribeFailure; status?: number };

/** Parses whichever envelope the gateway uses; the live API uses `transcription`. */
function parseTranscript(body: unknown): string | null {
  if (typeof body === 'string') return body.trim().length > 0 ? body : null;
  if (body == null || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const nested = record.result ?? record.data;
  const candidates = [
    record.transcription,
    record.transcript,
    record.text,
    typeof nested === 'object' && nested != null
      ? (nested as Record<string, unknown>).transcript
      : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

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
export async function asrRemaining(): Promise<number> {
  const usage = await loadUsage();
  return Math.max(0, ASR_DAILY_LIMIT - usage.count);
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

const UPLOAD_TIMEOUT_MS = 45_000;

/**
 * Uploads a recorded utterance and returns its transcript.
 *
 * Every request that got an HTTP response is counted against the daily ledger,
 * including 429s and 5xx - only a request that never reached the server
 * (offline, DNS failure) is free, because the quota was not consumed.
 */
export async function transcribeFile(uri: string): Promise<TranscribeResult> {
  const key = apiKey();
  if (key == null) return { ok: false, reason: 'no-key' };

  if ((await asrRemaining()) <= 0) return { ok: false, reason: 'quota' };

  const form = new FormData();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    // Expo's fetch (the SDK 57 global) serialises FormData on the JS side and
    // only accepts Blob parts; React Native's {uri, name, type} file part
    // throws 'Unsupported FormDataPart implementation'. Read the recording
    // through the same fetch - it serves file:// URLs - and upload the bytes.
    const recording = await fetch(uri);
    if (!recording.ok) return { ok: false, reason: 'empty' };
    form.append('file', await recording.blob(), 'utterance.m4a');

    const response = await fetch(`${labBaseUrl()}/api/v1/asr`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });

    await recordUsage();

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: 'auth', status: response.status };
    }
    if (response.status === 429) {
      return { ok: false, reason: 'quota', status: response.status };
    }
    if (response.status === 413) {
      return { ok: false, reason: 'too-big', status: response.status };
    }
    if (!response.ok) {
      return { ok: false, reason: 'server', status: response.status };
    }

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    const transcript = parseTranscript(parsed);
    if (transcript == null) return { ok: false, reason: 'empty' };
    return { ok: true, transcript };
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    // On-device failures are otherwise indistinguishable ('offline' covers
    // everything from DNS to a local file-read refusal); keep the cause.
    console.log(
      `[SikaVoice asr] upload threw ${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? ''} (uri ${uri})`,
    );
    return { ok: false, reason: aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

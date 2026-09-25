import { rememberSpoken } from '../a11y/spokenHistory';
import { getAppLanguage, i18n, type AppLanguage } from '../i18n';
import { stopSpeaking } from '../services/speech';
import { hasVoiceClip, playVoiceClip, stopVoiceClip } from './voicePack';
import { hasNativeVoicePack } from './commandText';
import {
  moneyClipKeys,
  numberClipKeys,
  phoneClipKeys,
} from './commandText';

export type SayPart =
  | { kind: 'key'; key: string }
  | { kind: 'text'; text: string }
  | { kind: 'name'; name: string }
  | { kind: 'money'; amount: number }
  | { kind: 'number'; value: number }
  | { kind: 'phone'; phone: string };

export type SayPlan = SayPart[];

/** Small pause between composed segments, so numbers do not blur together. */
const SEGMENT_GAP_MS = 220;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hasClip(key: string, language: AppLanguage): boolean {
  return hasVoiceClip(key, language);
}

/** Clip key for a person name: "Kwame Mensah" -> `name.kwame_mensah`. */
export function nameClipKey(name: string): string {
  return `name.${name.trim().toLowerCase().replace(/\s+/g, '_')}`;
}

/** True when every key in the plan has a clip in this language's pack. */
export function canSpeakPlan(plan: SayPlan, language: AppLanguage): boolean {
  if (!hasNativeVoicePack(language)) return false;
  return plan.every((part) => {
    switch (part.kind) {
      case 'key':
        return hasVoiceClip(part.key, language);
      case 'name':
        return hasVoiceClip(nameClipKey(part.name), language);
      case 'money':
        return moneyClipKeys(part.amount, language).every((k) => hasVoiceClip(k, language));
      case 'number':
        return numberClipKeys(part.value).every((k) => hasVoiceClip(k, language));
      case 'phone':
        return phoneClipKeys(part.phone).every((k) => hasVoiceClip(k, language));
      case 'text':
        return false;
    }
  });
}

export function planClipKeys(plan: SayPlan, language: AppLanguage): string[] {
  const keys: string[] = [];
  for (const part of plan) {
    switch (part.kind) {
      case 'key':
        keys.push(part.key);
        break;
      case 'money':
        keys.push(...moneyClipKeys(part.amount, language));
        break;
      case 'number':
        keys.push(...numberClipKeys(part.value));
        break;
      case 'phone':
        keys.push(...phoneClipKeys(part.phone));
        break;
      case 'text':
        break;
    }
  }
  return keys;
}

/** The English sentence a plan represents, for the "repeat" history. */
export function planText(plan: SayPlan): string {
  return plan
    .map((part) => {
      switch (part.kind) {
        case 'key':
          return i18n.t(part.key);
        case 'text':
          return part.text;
        case 'name':
          return part.name;
        case 'money':
          return `GH₵ ${part.amount.toFixed(2)}`;
        case 'number':
          return String(part.value);
        case 'phone':
          return part.phone;
      }
    })
    .filter((s) => s.trim().length > 0)
    .join(' ');
}

/**
 * Plays a whole plan from the native clip pack.
 *
 * Each segment is awaited before the next starts, and a failed clip falls back
 * to the per-part TTS path rather than leaving the user in silence mid-sentence.
 */
export async function playPlan(plan: SayPlan, language: AppLanguage): Promise<boolean> {
  if (!canSpeakPlan(plan, language)) return false;

  stopSpeaking();
  stopVoiceClip();

  for (const part of plan) {
    let keys: string[];
    switch (part.kind) {
      case 'key':
        keys = [part.key];
        break;
      case 'name':
        keys = [nameClipKey(part.name)];
        break;
      case 'money':
        keys = moneyClipKeys(part.amount, language);
        break;
      case 'number':
        keys = numberClipKeys(part.value);
        break;
      case 'phone':
        keys = phoneClipKeys(part.phone);
        break;
      case 'text':
        return false; // Cannot compose free text - caller decides the fallback.
    }

    for (const key of keys) {
      if (!hasVoiceClip(key, language)) return false;
      const played = await playVoiceClip(key, language);
      if (!played) return false;
      await sleep(SEGMENT_GAP_MS);
    }
  }
  return true;
}

export interface SayOptions {
  language?: AppLanguage;
  /** Text used if there is no clip: the translated string, or a template result. */
  fallbackText?: string;
  rate?: number;
}

/**
 * Says an i18n string from the native clip pack, in the user's language.
 *
 * For languages with a native pack (Twi, Ewe) there is no English-accent
 * fallback: the phrase is only ever the recorded native clip. If a clip is
 * missing the caller's fallback chain runs - never device TTS, which would
 * read Ewe orthography with an English voice.
 */
export function sayKey(key: string, options: SayOptions = {}): 'clip' | 'skipped' {
  const language = options.language ?? getAppLanguage();
  const text = options.fallbackText ?? i18n.t(key);

  if (hasVoiceClip(key, language)) {
    rememberSpoken(text, key);
    void playVoiceClip(key, language);
    return 'clip';
  }
  return 'skipped';
}

/**
 * Awaitable `sayKey`: resolves once the clip has finished playing, so callers
 * can sequence feedback before the always-on microphone listens again.
 *
 * @returns false when the language has no clip for the key (the deliberate
 *   silence policy) - nothing was played, nothing to wait for.
 */
export async function sayKeyAsync(key: string, options: SayOptions = {}): Promise<boolean> {
  const language = options.language ?? getAppLanguage();
  if (!hasVoiceClip(key, language)) return false;
  rememberSpoken(options.fallbackText ?? i18n.t(key), key);
  return playVoiceClip(key, language);
}

/**
 * Speaks a composed plan natively, with an explicit fallback chain.
 *
 * `native` runs only when every segment has a clip; otherwise `fallback` runs.
 * This is the only way dynamic sentences (amounts, phone numbers) are spoken in
 * Twi/Ewe - composed entirely from native-number clips, never device TTS.
 */
export function sayPlan(
  plan: SayPlan,
  options: {
    language?: AppLanguage;
    native?: () => void;
    fallback: () => void;
  },
): void {
  const language = options.language ?? getAppLanguage();
  if (canSpeakPlan(plan, language)) {
    rememberSpoken(planText(plan));
    options.native?.();
    void playPlan(plan, language);
    return;
  }
  options.fallback();
}

export function stopAllVoices(): void {
  stopSpeaking();
  stopVoiceClip();
}

export { stopVoiceClip };

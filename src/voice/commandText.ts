import type { AppLanguage } from '../i18n';

/**
 * Languages that ship a native voice pack (Meta MMS clips).
 *
 * For these, ALL speech output is composed from pre-rendered clips: device TTS
 * has no Akan/Ewe/Gã voice, so any utterance it renders is read with an English
 * accent. English and Pidgin keep device TTS.
 */
export const NATIVE_CLIP_LANGUAGES: readonly AppLanguage[] = ['tw', 'ee'];

export function hasNativeVoicePack(language: AppLanguage): boolean {
  return (NATIVE_CLIP_LANGUAGES as readonly string[]).includes(language);
}

/**
 * Decomposes an integer into clip keys, reading naturally:
 *   432 -> ["num.4", "num.100", "num.30", "num.2"]  ("four hundred thirty two")
 * The atoms (0-19, 20-90, 100, 1000) are pre-rendered per language by
 * scripts/generate-voice-clips.py.
 */
export function numberClipKeys(value: number): string[] {
  const n = Math.floor(Math.abs(value));
  if (!Number.isFinite(n)) return [];
  if (n === 0) return ['num.0'];
  if (n >= 100_000) return []; // Out of demo range - caller falls back.

  const keys: string[] = [];
  let rest = n;

  const thousands = Math.floor(rest / 1000);
  if (thousands > 0) {
    keys.push(...numberClipKeys(thousands), 'num.1000');
    rest %= 1000;
  }
  const hundreds = Math.floor(rest / 100);
  if (hundreds > 0) {
    keys.push(...numberClipKeys(hundreds), 'num.100');
    rest %= 100;
  }
  if (rest >= 20) {
    keys.push(`num.${Math.floor(rest / 10) * 10}`);
    rest %= 10;
  }
  if (rest > 0) keys.push(`num.${rest}`);
  return keys;
}

/**
 * Money as clip keys: amount -> "… cedis … pesewas" in the language's pack.
 * Returns [] when the amount cannot be composed (caller falls back).
 */
export function moneyClipKeys(amount: number, language: AppLanguage): string[] {
  if (!Number.isFinite(amount) || amount < 0) return [];
  if (!hasNativeVoicePack(language)) return [];

  const whole = Math.floor(amount);
  const pesewas = Math.round((amount - whole) * 100);

  if (whole === 0 && pesewas === 0) return [];
  if (whole >= 100_000) return []; // Out of demo range - caller falls back.

  const keys = numberClipKeys(whole);
  if (keys.length === 0) return [];
  if (whole > 0) keys.push('money.cedis');
  if (pesewas > 0) {
    const sub = numberClipKeys(pesewas);
    if (sub.length === 0) return [];
    keys.push(...sub, 'money.pesewas');
  }
  return keys;
}

/** A phone number as digit clip keys, e.g. "024 123 4567" spoken digit by digit. */
export function phoneClipKeys(phone: string): string[] {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 0) return [];
  // Local format (0XXXXXXXXX) is what users say; strip a +233 country code.
  const local = digits.length > 10 ? `0${digits.slice(-9)}` : digits;
  return Array.from(local, (d) => `num.${d}`);
}

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { storage } from './storage';
import ee from './locales/ee.json';
import en from './locales/en.json';
import ga from './locales/ga.json';
import pcm from './locales/pcm.json';
import tw from './locales/tw.json';

export const SUPPORTED_LANGUAGES = ['tw', 'ee', 'ga', 'pcm', 'en'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  tw: 'Akan (Twi)',
  ee: 'Eʋegbe (Ewe)',
  ga: 'Gã',
  pcm: 'Pidgin',
  en: 'English',
};

const LANGUAGE_STORAGE_KEY = 'sikavoice.language';
const DEFAULT_LANGUAGE: AppLanguage = 'tw';

let currentLanguage: AppLanguage = DEFAULT_LANGUAGE;

function isSupportedLanguage(value: string | null): value is AppLanguage {
  return value != null && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Initializes i18next. Defaults to Akan (Twi) per the SikaVoice brief,
 * then restores the user's saved language choice if one exists.
 */
export async function initI18n(): Promise<AppLanguage> {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: {
        tw: { translation: tw },
        ee: { translation: ee },
        ga: { translation: ga },
        pcm: { translation: pcm },
        en: { translation: en },
      },
      lng: DEFAULT_LANGUAGE,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  }

  try {
    const stored = await storage.getItem(LANGUAGE_STORAGE_KEY);
    if (isSupportedLanguage(stored)) {
      currentLanguage = stored;
      await i18n.changeLanguage(currentLanguage);
    }
  } catch {
    // Storage unavailable - keep the default language.
  }

  return currentLanguage;
}

export async function setAppLanguage(language: AppLanguage): Promise<void> {
  currentLanguage = language;
  await i18n.changeLanguage(language);
  await storage.setItem(LANGUAGE_STORAGE_KEY, language);
}

export function getAppLanguage(): AppLanguage {
  return currentLanguage;
}

export { i18n };

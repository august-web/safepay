import AsyncStorage from '@react-native-async-storage/async-storage';

export type NavPreset = 'linear' | 'spatial';
export type PrivacyMode = 'auto' | 'voice' | 'haptic';

export interface AppSettings {
  navPreset: NavPreset;
  speechRate: number;
  privacyMode: PrivacyMode;
}

const SETTINGS_KEY = 'sikavoice.settings';

const DEFAULT_SETTINGS: AppSettings = {
  navPreset: 'linear',
  speechRate: 0.85,
  privacyMode: 'auto',
};

let cachedSettings: AppSettings = { ...DEFAULT_SETTINGS };

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      cachedSettings = {
        navPreset: parsed.navPreset === 'spatial' ? 'spatial' : 'linear',
        speechRate: typeof parsed.speechRate === 'number' ? parsed.speechRate : 0.85,
        privacyMode:
          parsed.privacyMode === 'voice' || parsed.privacyMode === 'haptic'
            ? parsed.privacyMode
            : 'auto',
      };
    }
  } catch {
    // keep default
  }
  return cachedSettings;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  cachedSettings = { ...cachedSettings, ...patch };
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(cachedSettings));
  } catch {
    // keep cached
  }
  return cachedSettings;
}

export function getCachedSettings(): AppSettings {
  return cachedSettings;
}


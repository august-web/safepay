import { Platform } from 'react-native';

/**
 * Tiny async key-value wrapper. Uses window.localStorage on web and
 * @react-native-async-storage/async-storage on iOS/Android so the same
 * interface works everywhere without conditional imports in feature code.
 */
const webStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Ignore storage failures (private mode, quota) - non-critical preference.
    }
  },
};

let nativeStorage: {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
} | null = null;

async function getNativeStorage() {
  if (nativeStorage == null) {
    const module = await import('@react-native-async-storage/async-storage');
    nativeStorage = module.default;
  }
  return nativeStorage;
}

export const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return webStorage.getItem(key);
    try {
      const asyncStorage = await getNativeStorage();
      return await asyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') return webStorage.setItem(key, value);
    try {
      const asyncStorage = await getNativeStorage();
      await asyncStorage.setItem(key, value);
    } catch {
      // Ignore storage failures - non-critical preference.
    }
  },
};

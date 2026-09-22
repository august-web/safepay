import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Cached screen-reader (TalkBack / VoiceOver) state.
 *
 * SikaVoice splits its spoken output between two channels:
 *  - a screen reader is running  -> hand the text to it, so the user hears one
 *    voice instead of two talking over each other;
 *  - no screen reader is running -> speak through the app's own TTS, because a
 *    blind user without TalkBack must still hear the app.
 *
 * The previous build only ever used the first channel, so on a phone with
 * TalkBack switched off the app was completely silent - the bug this fixes.
 */
let screenReaderEnabled = false;

let subscription: { remove: () => void } | null = null;

/** Subscribes to screen-reader changes and seeds the cache. Safe to call twice. */
/**
 * Logs which voice channel is live, once per change.
 *
 * On a real phone `adb logcat | grep voice-channel` answers "is TalkBack
 * picking this up, or is SikaVoice speaking for itself?" without guessing.
 */
function logChannel(): void {
  const channel = screenReaderEnabled ? 'screenReader' : 'tts';
  if (channel === lastLoggedChannel) return;
  lastLoggedChannel = channel;
  console.log(`[SikaVoice voice-channel] ${channel}`);
}

let lastLoggedChannel: string | null = null;

export async function initScreenReaderState(): Promise<boolean> {
  try {
    screenReaderEnabled = await AccessibilityInfo.isScreenReaderEnabled();
  } catch {
    screenReaderEnabled = false;
  }
  logChannel();

  if (subscription == null) {
    try {
      subscription = AccessibilityInfo.addEventListener(
        'screenReaderChanged',
        (enabled: boolean) => {
          screenReaderEnabled = enabled;
          logChannel();
        },
      );
    } catch {
      // Older platforms: keep the seeded value.
    }
  }

  return screenReaderEnabled;
}

/** Whether a screen reader is currently running, from the cached value. */
export function isScreenReaderEnabled(): boolean {
  return screenReaderEnabled;
}

/** True when the app must speak for itself because nobody else will. */
export function needsOwnVoice(): boolean {
  return !screenReaderEnabled;
}

export function stopScreenReaderListener(): void {
  subscription?.remove();
  subscription = null;
}

/** Exposed for diagnostics (Settings shows which voice channel is live). */
export function resetScreenReaderCacheForTests(next: boolean): void {
  screenReaderEnabled = next;
}

export const SCREEN_READER_SUPPORTED = Platform.OS !== 'web';

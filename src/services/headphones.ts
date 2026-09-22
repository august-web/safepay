import { useEffect, useState } from 'react';

import { readAudioRoute, subscribeToAudioRoute } from '../../modules/audio-route';
import { getCachedSettings, type PrivacyMode } from './settings';

/**
 * Detects whether audio output is private (headphones/earbuds connected).
 *
 * Brief requirement: spoken transaction amounts must never play on the
 * loudspeaker in public. When we cannot confirm a private audio route, this
 * returns false so callers fall back to haptics - the safe default.
 *
 * The probe is a local native module (`modules/audio-route`) that asks
 * AudioManager for its output devices. The previous implementation guessed at
 * a `ReactNativeNativeAudioDeviceModule` that does not exist in an Expo build,
 * so it always answered "no headphones" and pinned the whole app into
 * haptics-only mode.
 */

export type AudioRouteStatus = {
  /** True when the privacy guard considers the route private. */
  isPrivate: boolean;
  /** Private output devices currently connected (wired headset, Bluetooth...). */
  devices: string[];
  /** Human-readable explanation of the decision. */
  reason: string;
  /** `auto` | `voice` | `haptic` - the user's Audio Privacy Guard setting. */
  mode: PrivacyMode;
  /** `native` when the probe answered, `unavailable` when it is not linked. */
  source: 'native' | 'unavailable';
};

/** Last route signature logged, so logcat shows changes rather than spam. */
let lastLoggedSignature: string | null = null;

/**
 * Logs the resolved route once per change. Used when debugging on a real
 * phone: `adb logcat | grep audio-route` tells you whether the native probe is
 * linked (`source=native`) or the app is falling back to the safe default.
 */
function logRoute(status: AudioRouteStatus): void {
  const signature = `${status.mode}|${status.source}|${status.reason}|${status.devices.join(',')}`;
  if (signature === lastLoggedSignature) return;
  lastLoggedSignature = signature;
  console.log(
    `[SikaVoice audio-route] mode=${status.mode} private=${status.isPrivate} source=${status.source} reason=${status.reason} devices=${status.devices.join(',') || 'none'}`,
  );
}

export function readAudioRouteStatus(): AudioRouteStatus {
  const status = resolveAudioRouteStatus();
  logRoute(status);
  return status;
}

function resolveAudioRouteStatus(): AudioRouteStatus {
  const mode = getCachedSettings().privacyMode;

  if (mode === 'voice') {
    return { isPrivate: true, devices: [], reason: 'forced_voice_mode', mode, source: 'native' };
  }
  if (mode === 'haptic') {
    return { isPrivate: false, devices: [], reason: 'forced_haptic_mode', mode, source: 'native' };
  }

  const snapshot = readAudioRoute();
  if (snapshot == null) {
    // Fail safe: no way to confirm privacy means treat it as a public route.
    return {
      isPrivate: false,
      devices: [],
      reason: 'probe_unavailable',
      mode,
      source: 'unavailable',
    };
  }

  return {
    isPrivate: snapshot.private,
    devices: snapshot.active.length > 0 ? snapshot.active : snapshot.available,
    reason: snapshot.reason,
    mode,
    source: 'native',
  };
}

export async function isHeadphonesConnected(): Promise<boolean> {
  return readAudioRouteStatus().isPrivate;
}

/** Reactive version of {@link isHeadphonesConnected} - updates on plug/unplug. */
export function useIsPrivateAudio(): boolean {
  return useAudioRoute().isPrivate;
}

/** Full route status for banners and the Settings diagnostics panel. */
export function useAudioRoute(): AudioRouteStatus {
  const [status, setStatus] = useState<AudioRouteStatus>(() => readAudioRouteStatus());

  useEffect(() => {
    const refresh = () => setStatus(readAudioRouteStatus());
    refresh();
    const unsubscribe = subscribeToAudioRoute(refresh);
    return () => {
      unsubscribe();
    };
  }, []);

  return status;
}

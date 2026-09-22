import { NativeModule, requireNativeModule } from 'expo-modules-core';

export type AudioRouteSnapshot = {
  /** True when a private (headphone / earbud / Bluetooth / hearing-aid) route is available. */
  private: boolean;
  /** Private output devices currently connected, as readable names. */
  active: string[];
  /** All output devices currently connected, as readable names. */
  available: string[];
  /** Why we answered the way we did: `private_route_available` | `speaker_only` | error codes. */
  reason: string;
};

type AudioRouteEvents = {
  onAudioRouteChanged: (snapshot: AudioRouteSnapshot) => void;
};

declare class AudioRouteModule extends NativeModule<AudioRouteEvents> {
  getOutputRoute(): AudioRouteSnapshot;
}

let cached: AudioRouteModule | null | undefined;

/**
 * Returns the native module, or null on platforms where it is not linked
 * (web preview, iOS). Callers must treat null as "unknown route".
 */
export function getAudioRouteModule(): AudioRouteModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireNativeModule<AudioRouteModule>('AudioRoute');
  } catch {
    cached = null;
  }
  return cached;
}

/** Reads the current output route, or null when the native probe is unavailable. */
export function readAudioRoute(): AudioRouteSnapshot | null {
  try {
    return getAudioRouteModule()?.getOutputRoute() ?? null;
  } catch {
    return null;
  }
}

/** Subscribes to headphone plug/unplug events. Returns an unsubscribe function. */
export function subscribeToAudioRoute(
  listener: (snapshot: AudioRouteSnapshot) => void,
): () => void {
  const module = getAudioRouteModule();
  if (module == null) return () => {};
  const subscription = module.addListener('onAudioRouteChanged', listener);
  return () => subscription.remove();
}

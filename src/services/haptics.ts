import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Privacy-first haptic fallback, per Dev Brief §2.5:
 * "Audio confirmation of transaction amounts is not private in a crowded vendor stall.
 * Haptic patterns provide a discrete alternative:
 *  - Short pulse = confirm
 *  - Long pulse = amount / balance
 *  - Double pulse = cancel
 *  - Triple pulse = error / alert"
 */
async function withAndroidFallback(
  iosStyle: Haptics.ImpactFeedbackStyle,
  androidPattern: (typeof Haptics.ImpactFeedbackStyle)[keyof typeof Haptics.ImpactFeedbackStyle],
): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Haptics.impactAsync(androidPattern);
    } else {
      await Haptics.impactAsync(iosStyle);
    }
  } catch {
    // Haptics unavailable (emulator, web) - fail silently.
  }
}

/** Short pulse: confirms an action or valid input. */
export async function hapticConfirm(): Promise<void> {
  await withAndroidFallback(
    Haptics.ImpactFeedbackStyle.Medium,
    Haptics.ImpactFeedbackStyle.Medium,
  );
}

/** Long pulse: denotes monetary amount, balance, or primary data readout. */
export async function hapticAmount(): Promise<void> {
  await withAndroidFallback(
    Haptics.ImpactFeedbackStyle.Heavy,
    Haptics.ImpactFeedbackStyle.Heavy,
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  await withAndroidFallback(
    Haptics.ImpactFeedbackStyle.Heavy,
    Haptics.ImpactFeedbackStyle.Heavy,
  );
}

/** Double pulse: cancels or aborts an operation. */
export async function hapticCancel(): Promise<void> {
  await withAndroidFallback(
    Haptics.ImpactFeedbackStyle.Medium,
    Haptics.ImpactFeedbackStyle.Medium,
  );
  await new Promise((resolve) => setTimeout(resolve, 140));
  await withAndroidFallback(
    Haptics.ImpactFeedbackStyle.Medium,
    Haptics.ImpactFeedbackStyle.Medium,
  );
}

/** Triple heavy pulse: alerts user to validation error or biometric failure. */
export async function hapticError(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await withAndroidFallback(
      Haptics.ImpactFeedbackStyle.Heavy,
      Haptics.ImpactFeedbackStyle.Heavy,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Crisp light tick for touch-down and quadrant exploration. */
export async function hapticTick(): Promise<void> {
  await withAndroidFallback(
    Haptics.ImpactFeedbackStyle.Light,
    Haptics.ImpactFeedbackStyle.Light,
  );
}

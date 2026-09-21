import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Wraps expo-local-authentication with accessibility-safe failure reporting.
 * Callers receive a structured result instead of a boolean so they can
 * announce exactly what went wrong through the screen-reader announcer.
 */
export type BiometricResult =
  | { status: 'success' }
  | { status: 'user_cancel' }
  | { status: 'lockout' }
  | { status: 'failed'; reason: string };

export interface BiometricCapability {
  hasHardware: boolean;
  isEnrolled: boolean;
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return { hasHardware, isEnrolled };
  } catch {
    return { hasHardware: false, isEnrolled: false };
  }
}

export async function authenticateWithBiometrics(
  promptMessage: string,
  cancelLabel: string,
): Promise<BiometricResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      disableDeviceFallback: false, // Allow passcode fallback rather than locking users out.
      biometricsSecurityLevel: 'strong', // Required for financial apps per the brief.
    });

    if (result.success) return { status: 'success' };

    const error = 'error' in result ? String(result.error) : '';
    if (error.includes('UserCancel') || error.includes('user_cancel')) {
      return { status: 'user_cancel' };
    }
    if (error.includes('Lockout') || error.includes('lockout')) {
      return { status: 'lockout' };
    }
    return { status: 'failed', reason: error };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function getBiometricTypeName(): Promise<
  'face' | 'fingerprint' | 'iris' | 'passcode' | null
> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
    return 'passcode';
  } catch {
    return null;
  }
}

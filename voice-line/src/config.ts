/**
 * Voice Line configuration. Mirrors dev brief §4.3 (Environment Variables).
 *
 * The server runs in MOCK mode unless MOCK_VOICE_LINE=false AND an
 * ARKESEL_API_KEY is present. In mock mode the telephony platform, the
 * Abena AI voiceprint service, and the MoMo ledger are all simulated
 * in-process so the full call flow is demonstrable with plain HTTP
 * (curl / the bundled smoke.mjs) and no credentials.
 */

export interface VoiceLineConfig {
  port: number;
  /** Public base URL used to build absolute TwiML action/callback URLs. */
  publicBaseUrl: string;
  mockMode: boolean;
  /** Accepted 4-digit DTMF PIN fallback in mock mode. NEVER a real MoMo PIN. */
  mockPin: string;
  /** First-time callers are voice-enrolled from their first passphrase sample. */
  autoEnrollMockVoice: boolean;
  tollFreeNumber: string | null;
  arkeselApiKey: string | null;
  arkeselAccountSid: string | null;
  abenaApiKey: string | null;
  abenaApiSecret: string | null;
  /** Idle-session expiry per the brief's security table (30 s on the voice line). */
  sessionTimeoutMs: number;
}

function readEnv(name: string): string | undefined {
  // eslint-disable-next-line expo/no-dynamic-env-var
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function readPort(argv: string[]): number {
  let port = 3000;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') {
      const next = argv[i + 1];
      if (next !== undefined) {
        const parsed = Number(next);
        if (Number.isInteger(parsed) && parsed > 0) port = parsed;
      }
    }
  }
  const envPort = readEnv('PORT');
  if (envPort !== undefined) {
    const parsed = Number(envPort);
    if (Number.isInteger(parsed) && parsed > 0) port = parsed;
  }
  return port;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): VoiceLineConfig {
  const arkeselApiKey = readEnv('ARKESEL_API_KEY') ?? null;
  const mockExplicit = readEnv('MOCK_VOICE_LINE');
  const mockMode = mockExplicit === 'false' ? false : arkeselApiKey === null;

  return {
    port: readPort(argv),
    publicBaseUrl: readEnv('PUBLIC_BASE_URL') ?? 'http://localhost:3000',
    mockMode,
    mockPin: readEnv('MOCK_PIN') ?? '0000',
    autoEnrollMockVoice: readEnv('MOCK_AUTO_ENROLL') !== 'false',
    tollFreeNumber: readEnv('ARKESEL_TOLL_FREE_NUMBER') ?? null,
    arkeselApiKey,
    arkeselAccountSid: readEnv('ARKESEL_ACCOUNT_SID') ?? null,
    abenaApiKey: readEnv('ABENA_API_KEY') ?? null,
    abenaApiSecret: readEnv('ABENA_API_SECRET') ?? null,
    sessionTimeoutMs: 30_000,
  };
}

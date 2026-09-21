/**
 * Per-call IVR session state. A telephony <Redirect> is a body-less GET, so
 * the CallSid travels in the query string (see index.ts); handlers look the
 * call up here. Sessions expire after the brief's 30-second voice-line
 * idle timeout — expired or unknown SIDs get a "call back" hangup, which is
 * the safe default (never continue a money flow in an unknown session).
 */
export type IvrLanguage = 'tw' | 'ee';

export type IvrStep =
  | 'language'
  | 'auth'
  | 'menu'
  | 'send-amount'
  | 'send-recipient'
  | 'send-confirm'
  | 'airtime-amount'
  | 'airtime-confirm';

export interface CallSession {
  callSid: string;
  caller: string;
  lang: IvrLanguage | null;
  step: IvrStep;
  /** Failed-auth attempts on the current step (3 strikes → lockout). */
  attempts: number;
  amount: number | null;
  recipientPhone: string | null;
  createdAt: number;
  updatedAt: number;
}

export const MAX_AUTH_ATTEMPTS = 3;

export class SessionStore {
  private readonly sessions = new Map<string, CallSession>();

  constructor(private readonly timeoutMs: number) {}

  create(callSid: string, caller: string): CallSession {
    const now = Date.now();
    const session: CallSession = {
      callSid,
      caller,
      lang: null,
      step: 'language',
      attempts: 0,
      amount: null,
      recipientPhone: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(callSid, session);
    return session;
  }

  /** Returns the live session, or null when missing/expired (expired is deleted). */
  get(callSid: string): CallSession | null {
    const session = this.sessions.get(callSid);
    if (!session) return null;
    if (Date.now() - session.updatedAt > this.timeoutMs) {
      this.sessions.delete(callSid);
      return null;
    }
    return session;
  }

  touch(session: CallSession): void {
    session.updatedAt = Date.now();
  }

  end(callSid: string): void {
    this.sessions.delete(callSid);
  }
}

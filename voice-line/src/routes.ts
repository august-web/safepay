/**
 * IVR webhook route handlers. Every step returns TwiML, so the telephony
 * platform always knows what to say/do next — an IVR caller must never be
 * left in silence (the voice-line equivalent of the app track's announcer
 * contract).
 *
 * The platform delivers gather results as POSTed form fields (Digits for
 * DTMF, SpeechResult for ASR). <Redirect> follow-ups are body-less GETs, so
 * the CallSid travels in the query string instead.
 */
import type { VoiceLineConfig } from './config';
import { MockLedger, calculateFee } from './momo';
import { formatMoney, interpretConfirmation, PROMPTS, SPEECH_LOCALES } from './prompts';
import { MAX_AUTH_ATTEMPTS, type CallSession, type IvrLanguage, type SessionStore } from './session';
import { VoiceResponse } from './twiml';
import { MockVoiceprintStore } from './voiceprints';

export interface HandlerContext {
  config: VoiceLineConfig;
  sessions: SessionStore;
  voiceprints: MockVoiceprintStore;
  ledger: MockLedger;
  /** Absolute URL helper for action/callback attributes. */
  url: (path: string, callSid?: string, extra?: Record<string, string>) => string;
}

const LANGUAGE_NAMES: Record<IvrLanguage, string> = {
  tw: 'Akan (Twi)',
  ee: 'Eʋegbe (Ewe)',
};

/** Normalizes Ghana numbers: +233XXXXXXXXX / 233XXXXXXXXX -> 0XXXXXXXXX */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s()-]/g, '');
  if (digits.startsWith('+233')) return `0${digits.slice(4)}`;
  if (digits.startsWith('233') && digits.length === 12) return `0${digits.slice(3)}`;
  return digits;
}

export function isValidGhanaPhone(raw: string): boolean {
  return /^0\d{9}$/.test(normalizePhone(raw));
}

/** "say X" TwiML for a sessionless step (incoming, expired, finished). */
function sayAndHangup(text: string, lang: IvrLanguage | null): VoiceResponse {
  const locale = lang ? SPEECH_LOCALES[lang] : 'en-GH';
  return new VoiceResponse().say(text, { language: locale }).hangup();
}

function expiredHangup(): VoiceResponse {
  // Session language unknown here: keep the message bilingual.
  return sayAndHangup(
    'Wo berɛ asa. Frɛ bio. Wò ɣeyiɣi nu. Gafɔ bio. Your session expired. Please call back.',
    null,
  );
}

function finishCall(ctx: HandlerContext, session: CallSession, text: string): VoiceResponse {
  ctx.sessions.end(session.callSid);
  return sayAndHangup(text, session.lang);
}

function toMenuGather(ctx: HandlerContext, session: CallSession): VoiceResponse {
  const lang = session.lang as IvrLanguage;
  const prompts = PROMPTS[lang];
  session.step = 'menu';
  session.attempts = 0;
  ctx.sessions.touch(session);
  const response = new VoiceResponse();
  response.say(`${prompts.welcomeBack} ${LANGUAGE_NAMES[lang]}.`, {
    language: SPEECH_LOCALES[lang],
    voice: 'female',
  });
  return response.gather(
    {
      numDigits: 1,
      timeout: 5,
      action: ctx.url('/ivr/menu', session.callSid),
      method: 'POST',
    },
    prompts.menu,
    { language: SPEECH_LOCALES[lang], voice: 'female' },
  );
}

function failedAuthAttempt(ctx: HandlerContext, session: CallSession): VoiceResponse {
  session.attempts += 1;
  ctx.sessions.touch(session);
  const lang = session.lang as IvrLanguage;
  const prompts = PROMPTS[lang];
  if (session.attempts >= MAX_AUTH_ATTEMPTS) {
    return finishCall(ctx, session, prompts.authLocked);
  }
  return authGather(ctx, session);
}

export function handleMenu(ctx: HandlerContext, params: URLSearchParams): VoiceResponse {
  const callSid = params.get('CallSid') ?? '';
  const session = ctx.sessions.get(callSid);
  if (!session || session.lang === null || session.step !== 'menu') return expiredHangup();
  ctx.sessions.touch(session);
  const lang = session.lang;
  const prompts = PROMPTS[lang];
  const locale = SPEECH_LOCALES[lang];

  switch ((params.get('Digits') ?? '').trim()) {
    case '1': {
      const balance = formatMoney(ctx.ledger.getBalance(session.caller));
      const response = new VoiceResponse().say(prompts.balanceIs(balance), {
        language: locale,
        voice: 'female',
      });
      return repeatMenu(ctx, session, response);
    }
    case '2': {
      session.step = 'send-amount';
      session.amount = null;
      session.recipientPhone = null;
      ctx.sessions.touch(session);
      return new VoiceResponse().gather(
        {
          numDigits: 8,
          timeout: 8,
          action: ctx.url('/ivr/send-amount', callSid),
          method: 'POST',
        },
        prompts.amountPrompt,
        { language: locale, voice: 'female' },
      );
    }
    case '3': {
      session.step = 'airtime-amount';
      session.amount = null;
      ctx.sessions.touch(session);
      return new VoiceResponse().gather(
        {
          numDigits: 8,
          timeout: 8,
          action: ctx.url('/ivr/airtime-amount', callSid),
          method: 'POST',
        },
        prompts.airtimeAmount,
        { language: locale, voice: 'female' },
      );
    }
    case '4': {
      const recent = ctx.ledger.listRecent(session.caller, 3);
      const response = new VoiceResponse();
      if (recent.length === 0) {
        response.say(prompts.recentNone, { language: locale, voice: 'female' });
      } else {
        for (const txn of recent) {
          if (txn.type === 'receive') {
            response.say(prompts.recentReceive(formatMoney(txn.amount), txn.recipientName), {
              language: locale,
            });
          } else if (txn.type === 'airtime') {
            response.say(prompts.recentAirtime(formatMoney(txn.amount)), { language: locale });
          } else {
            response.say(prompts.recentSend(formatMoney(txn.amount), txn.recipientName), {
              language: locale,
            });
          }
        }
      }
      return repeatMenu(ctx, session, response);
    }
    default: {
      return new VoiceResponse().gather(
        {
          numDigits: 1,
          timeout: 5,
          action: ctx.url('/ivr/menu', callSid),
          method: 'POST',
        },
        prompts.invalidChoice,
        { language: locale, voice: 'female' },
      );
    }
  }
}

function repeatMenu(
  ctx: HandlerContext,
  session: CallSession,
  response: VoiceResponse,
): VoiceResponse {
  const lang = session.lang as IvrLanguage;
  const locale = SPEECH_LOCALES[lang];
  session.step = 'menu';
  ctx.sessions.touch(session);
  return response.gather(
    {
      numDigits: 1,
      timeout: 5,
      action: ctx.url('/ivr/menu', session.callSid),
      method: 'POST',
    },
    PROMPTS[lang].menu,
    { language: locale, voice: 'female' },
  );
}

function parseAmountToCents(digits: string): number | null {
  const cleaned = digits.replace(/[^0-9]/g, '');
  if (!/^\d{1,7}$/.test(cleaned)) return null;
  const cents = Number(cleaned);
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}

export function handleSendAmount(ctx: HandlerContext, params: URLSearchParams): VoiceResponse {
  const callSid = params.get('CallSid') ?? '';
  const session = ctx.sessions.get(callSid);
  if (!session || session.lang === null || session.step !== 'send-amount') return expiredHangup();
  ctx.sessions.touch(session);
  const lang = session.lang;
  const prompts = PROMPTS[lang];
  const locale = SPEECH_LOCALES[lang];

  const cents = parseAmountToCents(params.get('Digits') ?? '');
  if (cents === null) {
    return new VoiceResponse().gather(
      {
        numDigits: 8,
        timeout: 8,
        action: ctx.url('/ivr/send-amount', callSid),
        method: 'POST',
      },
      prompts.amountInvalid,
      { language: locale, voice: 'female' },
    );
  }

  const amount = cents / 100;
  const fee = calculateFee(amount);
  if (ctx.ledger.getBalance(session.caller) < amount + fee) {
    session.step = 'menu';
    ctx.sessions.touch(session);
    const response = new VoiceResponse().say(prompts.insufficient, {
      language: locale,
      voice: 'female',
    });
    return repeatMenu(ctx, session, response);
  }

  session.amount = amount;
  session.step = 'send-recipient';
  ctx.sessions.touch(session);
  return new VoiceResponse().gather(
    {
      numDigits: 10,
      timeout: 10,
      action: ctx.url('/ivr/send-recipient', callSid),
      method: 'POST',
    },
    prompts.recipientPrompt,
    { language: locale, voice: 'female' },
  );
}

export function handleSendRecipient(
  ctx: HandlerContext,
  params: URLSearchParams,
): VoiceResponse {
  const callSid = params.get('CallSid') ?? '';
  const session = ctx.sessions.get(callSid);
  if (!session || session.lang === null || session.step !== 'send-recipient') {
    return expiredHangup();
  }
  ctx.sessions.touch(session);
  const lang = session.lang;
  const prompts = PROMPTS[lang];
  const locale = SPEECH_LOCALES[lang];

  const recipientDigits = (params.get('Digits') ?? '').replace(/[^0-9]/g, '');
  if (!isValidGhanaPhone(recipientDigits)) {
    return new VoiceResponse().gather(
      {
        numDigits: 10,
        timeout: 10,
        action: ctx.url('/ivr/send-recipient', callSid),
        method: 'POST',
      },
      prompts.recipientInvalid,
      { language: locale, voice: 'female' },
    );
  }

  const recipient = normalizePhone(recipientDigits);
  session.recipientPhone = recipient;
  session.step = 'send-confirm';
  ctx.sessions.touch(session);
  const amount = session.amount ?? 0;
  return new VoiceResponse().gather(
    {
      input: 'dtmf speech',
      numDigits: 1,
      timeout: 8,
      speechTimeout: 3,
      action: ctx.url('/ivr/send-confirm', callSid),
      method: 'POST',
      language: locale,
    },
    prompts.confirmSend(formatMoney(amount), recipient),
    { language: locale, voice: 'female' },
  );
}

function repeatConfirm(
  ctx: HandlerContext,
  session: CallSession,
  message: string,
  actionPath: '/ivr/send-confirm' | '/ivr/airtime-confirm',
): VoiceResponse {
  const lang = session.lang as IvrLanguage;
  const locale = SPEECH_LOCALES[lang];
  return new VoiceResponse().gather(
    {
      input: 'dtmf speech',
      numDigits: 1,
      timeout: 8,
      speechTimeout: 3,
      action: ctx.url(actionPath, session.callSid),
      method: 'POST',
      language: locale,
    },
    message,
    { language: locale, voice: 'female' },
  );
}

/** Shared confirm interpreter: speech yiw/ɛ̃/yes … or DTMF 1/2 (brief's "Say yes or no"). */
function readConfirmation(params: URLSearchParams, lang: IvrLanguage): 'yes' | 'no' | null {
  const digits = (params.get('Digits') ?? '').trim();
  if (digits === '1') return 'yes';
  if (digits === '2') return 'no';
  const speech = params.get('SpeechResult') ?? '';
  if (speech.trim().length === 0) return null;
  return interpretConfirmation(speech, lang);
}

export function handleSendConfirm(ctx: HandlerContext, params: URLSearchParams): VoiceResponse {
  const callSid = params.get('CallSid') ?? '';
  const session = ctx.sessions.get(callSid);
  if (!session || session.lang === null || session.step !== 'send-confirm') {
    return expiredHangup();
  }
  ctx.sessions.touch(session);
  const lang = session.lang;
  const prompts = PROMPTS[lang];

  const answer = readConfirmation(params, lang);
  if (answer === null) {
    return repeatConfirm(ctx, session, prompts.confirmInvalid, '/ivr/send-confirm');
  }
  if (answer === 'no') {
    session.step = 'menu';
    ctx.sessions.touch(session);
    const response = new VoiceResponse().say(prompts.cancelled, {
      language: SPEECH_LOCALES[lang],
      voice: 'female',
    });
    return repeatMenu(ctx, session, response);
  }

  const amount = session.amount ?? 0;
  const recipient = session.recipientPhone ?? '';
  const outcome = ctx.ledger.sendMoney({
    caller: session.caller,
    amount,
    recipientPhone: recipient,
  });
  if (outcome.status === 'confirmed' && outcome.transaction) {
    return finishCall(
      ctx,
      session,
      prompts.confirmed(formatMoney(amount), recipient, outcome.transaction.reference),
    );
  }
  return finishCall(ctx, session, prompts.failed);
}

export function handleAirtimeAmount(
  ctx: HandlerContext,
  params: URLSearchParams,
): VoiceResponse {
  const callSid = params.get('CallSid') ?? '';
  const session = ctx.sessions.get(callSid);
  if (!session || session.lang === null || session.step !== 'airtime-amount') {
    return expiredHangup();
  }
  ctx.sessions.touch(session);
  const lang = session.lang;
  const prompts = PROMPTS[lang];
  const locale = SPEECH_LOCALES[lang];

  const cents = parseAmountToCents(params.get('Digits') ?? '');
  if (cents === null) {
    return new VoiceResponse().gather(
      {
        numDigits: 8,
        timeout: 8,
        action: ctx.url('/ivr/airtime-amount', callSid),
        method: 'POST',
      },
      prompts.amountInvalid,
      { language: locale, voice: 'female' },
    );
  }

  const amount = cents / 100;
  if (ctx.ledger.getBalance(session.caller) < amount) {
    session.step = 'menu';
    ctx.sessions.touch(session);
    const response = new VoiceResponse().say(prompts.insufficient, {
      language: locale,
      voice: 'female',
    });
    return repeatMenu(ctx, session, response);
  }

  session.amount = amount;
  session.step = 'airtime-confirm';
  ctx.sessions.touch(session);
  return new VoiceResponse().gather(
    {
      input: 'dtmf speech',
      numDigits: 1,
      timeout: 8,
      speechTimeout: 3,
      action: ctx.url('/ivr/airtime-confirm', callSid),
      method: 'POST',
      language: locale,
    },
    prompts.confirmAirtime(formatMoney(amount)),
    { language: locale, voice: 'female' },
  );
}

export function handleAirtimeConfirm(
  ctx: HandlerContext,
  params: URLSearchParams,
): VoiceResponse {
  const callSid = params.get('CallSid') ?? '';
  const session = ctx.sessions.get(callSid);
  if (!session || session.lang === null || session.step !== 'airtime-confirm') {
    return expiredHangup();
  }
  ctx.sessions.touch(session);
  const lang = session.lang;
  const prompts = PROMPTS[lang];

  const answer = readConfirmation(params, lang);
  if (answer === null) {
    return repeatConfirm(ctx, session, prompts.confirmInvalid, '/ivr/airtime-confirm');
  }
  if (answer === 'no') {
    session.step = 'menu';
    ctx.sessions.touch(session);
    const response = new VoiceResponse().say(prompts.cancelled, {
      language: SPEECH_LOCALES[lang],
      voice: 'female',
    });
    return repeatMenu(ctx, session, response);
  }

  const amount = session.amount ?? 0;
  const outcome = ctx.ledger.buyAirtime(session.caller, amount);
  if (outcome.status === 'confirmed' && outcome.transaction) {
    return finishCall(
      ctx,
      session,
      prompts.confirmed(formatMoney(amount), session.caller, outcome.transaction.reference),
    );
  }
  return finishCall(ctx, session, prompts.failed);
}

/**
 * Brief §3.6 — outbound post-transaction callback. The server is the caller
 * here, so there is no gather: a single confirmation Say, then hangup.
 */
export function handleCallback(ctx: HandlerContext, params: URLSearchParams): VoiceResponse {
  const lang: IvrLanguage = params.get('Lang') === 'ee' ? 'ee' : 'tw';
  const amount = Number(params.get('Amount') ?? 'NaN');
  const to = params.get('To') ?? '';
  const reference = params.get('Reference') ?? '';
  const prompts = PROMPTS[lang];
  if (!Number.isFinite(amount) || amount <= 0 || to.length === 0 || reference.length === 0) {
    return sayAndHangup(prompts.failed, lang);
  }
  void ctx;
  return sayAndHangup(prompts.confirmed(formatMoney(amount), to, reference), lang);
}


function authenticated(ctx: HandlerContext, session: CallSession): VoiceResponse {
  return toMenuGather(ctx, session);
}

export function handleVerify(ctx: HandlerContext, params: URLSearchParams): VoiceResponse {
  const callSid = params.get('CallSid') ?? '';
  const session = ctx.sessions.get(callSid);
  if (!session || session.lang === null || session.step !== 'auth') return expiredHangup();
  ctx.sessions.touch(session);

  // DTMF PIN fallback (brief §3.x): never a real MoMo PIN in mock mode.
  const digits = (params.get('Digits') ?? '').trim();
  if (digits.length > 0) {
    if (digits === ctx.config.mockPin) return authenticated(ctx, session);
    return failedAuthAttempt(ctx, session);
  }

  const speech = (params.get('SpeechResult') ?? '').trim();
  const existing = ctx.voiceprints.getByCaller(session.caller);
  if (!existing) {
    if (ctx.config.autoEnrollMockVoice && speech.length >= 2) {
      ctx.voiceprints.enroll(session.caller, session.lang);
      return authenticated(ctx, session);
    }
    return failedAuthAttempt(ctx, session);
  }

  const outcome = ctx.voiceprints.verify(session.caller, speech);
  if (outcome.accepted) return authenticated(ctx, session);
  return failedAuthAttempt(ctx, session);
}


export function handleIncoming(ctx: HandlerContext, params: URLSearchParams): VoiceResponse {
  const callSid = params.get('CallSid') ?? `call-${Date.now()}`;
  const caller = params.get('From') ?? 'unknown';
  ctx.sessions.create(callSid, caller);
  return new VoiceResponse().gather(
    {
      numDigits: 1,
      timeout: 5,
      action: ctx.url('/ivr/language-select', callSid),
      method: 'POST',
    },
    PROMPTS.tw.languageSelect,
    { language: 'en-GH', voice: 'female' },
  );
}

export function handleLanguageSelect(
  ctx: HandlerContext,
  params: URLSearchParams,
): VoiceResponse {
  const callSid = params.get('CallSid') ?? '';
  const session = ctx.sessions.get(callSid);
  if (!session) return expiredHangup();
  ctx.sessions.touch(session);

  const digits = (params.get('Digits') ?? '').trim();
  const lang: IvrLanguage | null = digits === '1' ? 'tw' : digits === '2' ? 'ee' : null;
  if (!lang) {
    return new VoiceResponse().gather(
      {
        numDigits: 1,
        timeout: 5,
        action: ctx.url('/ivr/language-select', callSid),
        method: 'POST',
      },
      PROMPTS.tw.repromptLanguage,
      { language: 'en-GH', voice: 'female' },
    );
  }

  session.lang = lang;
  session.step = 'auth';
  session.attempts = 0;
  ctx.sessions.touch(session);
  return authGather(ctx, session);
}

/** Speech-first auth prompt; on retry the brief's DTMF-PIN fallback is offered. */
function authGather(ctx: HandlerContext, session: CallSession): VoiceResponse {
  const lang = session.lang as IvrLanguage;
  const prompts = PROMPTS[lang];
  const response = new VoiceResponse();
  if (session.attempts > 0) {
    response.gather(
      {
        input: 'dtmf speech',
        numDigits: 4,
        timeout: 5,
        speechTimeout: 3,
        action: ctx.url('/ivr/verify', session.callSid),
        method: 'POST',
        language: SPEECH_LOCALES[lang],
      },
      `${prompts.authFailed} ${prompts.pinFallback}`,
      { language: SPEECH_LOCALES[lang], voice: 'female' },
    );
  } else {
    response.gather(
      {
        input: 'speech',
        speechTimeout: 3,
        timeout: 5,
        action: ctx.url('/ivr/verify', session.callSid),
        method: 'POST',
        language: SPEECH_LOCALES[lang],
      },
      prompts.passphrase,
      { language: SPEECH_LOCALES[lang], voice: 'female' },
    );
  }
  return response;
}

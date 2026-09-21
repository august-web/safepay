/**
 * Track 2 Voice Line entrypoint. Dependency-free HTTP server (Node's
 * built-in `http` only — no express in this repo) that serves the IVR
 * webhook handlers as TwiML and JSON.
 *
 * Telephony platforms POST url-encoded telephony fields (CallSid, From,
 * Digits, SpeechResult). The same params can arrive on the query string
 * (body-less <Redirect> GETs), so both are merged with the body winning.
 */
import http from 'node:http';

import { loadConfig } from './config';
import { MockLedger } from './momo';
import { handleAirtimeAmount, handleAirtimeConfirm, handleCallback, handleIncoming, handleLanguageSelect, handleMenu, handleSendAmount, handleSendConfirm, handleSendRecipient, handleVerify, type HandlerContext } from './routes';
import { SessionStore } from './session';
import { TWIML_CONTENT_TYPE } from './twiml';
import { MockVoiceprintStore } from './voiceprints';

type Handler = (ctx: HandlerContext, params: URLSearchParams) => { toString(): string };

const ROUTES: Record<string, Handler> = {
  '/ivr/incoming': handleIncoming,
  '/ivr/language-select': handleLanguageSelect,
  '/ivr/verify': handleVerify,
  '/ivr/menu': handleMenu,
  '/ivr/send-amount': handleSendAmount,
  '/ivr/send-recipient': handleSendRecipient,
  '/ivr/send-confirm': handleSendConfirm,
  '/ivr/airtime-amount': handleAirtimeAmount,
  '/ivr/airtime-confirm': handleAirtimeConfirm,
  '/ivr/callback': handleCallback,
};

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function mergeParams(query: URLSearchParams, body: string, contentType: string): URLSearchParams {
  const merged = new URLSearchParams(query.toString());
  const text = body.trim();
  if (text.length === 0) return merged;
  if (contentType.includes('application/json')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === 'string' || typeof value === 'number') merged.set(key, String(value));
        }
      }
    } catch {
      // Fall through: treat as empty body on malformed JSON.
    }
    return merged;
  }
  for (const [key, value] of new URLSearchParams(text)) {
    merged.set(key, value);
  }
  return merged;
}

export function makeContext(): HandlerContext {
  const config = loadConfig();
  const base = config.publicBaseUrl.replace(/\/+$/, '');
  return {
    config,
    sessions: new SessionStore(config.sessionTimeoutMs),
    voiceprints: new MockVoiceprintStore(),
    ledger: new MockLedger(),
    url: (path, callSid, extra) => {
      const params = new URLSearchParams();
      if (callSid !== undefined) params.set('CallSid', callSid);
      if (extra) {
        for (const [key, value] of Object.entries(extra)) params.set(key, value);
      }
      const query = params.toString();
      return `${base}${path}${query.length > 0 ? `?${query}` : ''}`;
    },
  };
}

export function createServer(ctx: HandlerContext): http.Server {
  return http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (request.method === 'GET' && path === '/health') {
        const payload = JSON.stringify({
          ok: true,
          service: 'sikavoice-voice-line',
          mockMode: ctx.config.mockMode,
          tollFreeNumber: ctx.config.tollFreeNumber,
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(payload);
        return;
      }

      const handler = ROUTES[path];
      if (!handler) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('Not found');
        return;
      }

      const body = request.method === 'POST' ? await readBody(request) : '';
      const params = mergeParams(
        url.searchParams,
        body,
        String(request.headers['content-type'] ?? ''),
      );
      const twiml = handler(ctx, params);
      response.writeHead(200, { 'content-type': TWIML_CONTENT_TYPE });
      response.end(twiml.toString());
    })().catch((error: unknown) => {
      // IVR contract: never leave the caller in silence — say sorry, hang up.
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error(`[voice-line] handler error: ${message}`);
      try {
        response.writeHead(200, { 'content-type': TWIML_CONTENT_TYPE });
        response.end(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Mfasoɔ bi bae. Yɛw bio. Nu aɖe ƒo ƒe. Gbugbɔ ɖo. Something went wrong. Please try again.</Say><Hangup/></Response>',
        );
      } catch {
        // Response already committed; nothing more to do.
      }
    });
  });
}

if (require.main === module) {
  const ctx = makeContext();
  const server = createServer(ctx);
  server.listen(ctx.config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[voice-line] SikaVoice IVR server running on :${ctx.config.port} (mockMode=${ctx.config.mockMode})`,
    );
  });
}

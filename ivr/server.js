#!/usr/bin/env node
/**
 * SikaVoice IVR demo — P3 minimum viable Voice Line.
 *
 * Call flow (real, live-callable):
 *   incoming call -> 1/2 language select (Twi/Ewe) -> spoken passphrase
 *   capture -> Check Balance (mocked) -> TTS read-back -> goodbye.
 *
 * Design notes:
 *  - The balance is MOCKED on purpose (work order): a real MoMo integration
 *    is not required for the demo. The call flow itself is real.
 *  - This server implements the Arkesel VoiceConnect webhook contract:
 *    POST /voice/webhook  receives call events, replies with JSON actions.
 *    If your Arkesel account uses a different action schema, only the
 *    `actions` builder at the bottom needs adapting.
 *  - Language selection and the passphrase step use DTMF + record + callback,
 *    which every GSM voice gateway supports.
 *
 * Local test without burning airtime:
 *   curl -X POST localhost:8787/voice/webhook -H 'Content-Type: application/json' \
 *     -d '{"event":"start","callId":"test-1"}'
 *
 * Expose for Arkesel:
 *   ngrok http 8787     then set the webhook URL in the Arkesel dashboard.
 */

const http = require('http');

const PORT = process.env.IVR_PORT || 8787;

/** Mock wallet - replace with the Appwrite lookup when the backend lands. */
const MOCK_BALANCE_GHS = 1204.5;

/** Record + callback idle timeout the gateway should apply. */
const PASSPHRASE_TIMEOUT_SECS = 8;

/**
 * Call state, keyed by callId. Kept in memory deliberately: this is a demo
 * server, state lives only as long as the process.
 */
const calls = new Map();

/**
 * The one transaction type the demo implements: Check Balance.
 * A spoken passphrase gate precedes it, per the dev brief's voiceprint story
 * ("say your passphrase, not your PIN, in a room full of strangers").
 */
function nextActions(state) {
  switch (state.step) {
    case 'start':
      state.step = 'language';
      return {
        actions: [
          { type: 'say', text: 'Akwaaba. SikaVoice moMo line.' },
          { type: 'say', text: 'For Twi, press 1. For Ewe, press 2.' },
          { type: 'collect', input: ['dtmf'], numDigits: 1, action: '/voice/webhook' },
        ],
      };

    case 'language':
      state.language = state.dtmf === '2' ? 'ee' : 'tw'; // anything else defaults to Twi
      state.step = 'passphrase';
      return {
        actions:
          state.language === 'ee'
            ? [
                { type: 'say', text: 'Miawoezɔlɔ. Gblɔ wo gbe nyoƒenɛ.' },
                {
                  type: 'record',
                  action: '/voice/webhook',
                  maxLength: PASSPHRASE_TIMEOUT_SECS,
                  finishOnKey: '#',
                },
              ]
            : [
                { type: 'say', text: 'Akwaaba. Ka wo mfomsoɔ.' },
                {
                  type: 'record',
                  action: '/voice/webhook',
                  maxLength: PASSPHRASE_TIMEOUT_SECS,
                  finishOnKey: '#',
                },
              ],
      };

    case 'passphrase':
      // Demo voiceprint: presence of a recording is accepted. A production
      // build sends `state.recordingUrl` to Mobobi Abena AI for voiceprint
      // matching and only reaches the balance on a positive match.
      state.step = 'balance';
      return {
        actions: [
          { type: 'say', text: state.language === 'ee' ? 'Mesi.' : 'Medaase.' },
          {
            type: 'say',
            text:
              state.language === 'ee'
                ? `Wo ga sia ka: ${MOCK_BALANCE_GHS.toFixed(2)} cedi. Ee veve, ga si le asinye.`
                : `Wo sika a aka: ${MOCK_BALANCE_GHS.toFixed(2)} cedi. Me sika a aka.`,
          },
          { type: 'say', text: 'SikaVoice, MTN MoMo. Vaaso.' },
          { type: 'hangup' },
        ],
      };

    default:
      return { actions: [{ type: 'hangup' }] };
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/voice/webhook')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      payload = {};
    }

    const callId = payload.callId || 'unknown';
    let state = calls.get(callId);
    if (state == null) {
      state = { step: 'start', dtmf: null, recordingUrl: null };
      calls.set(callId, state);
    }
    if (payload.dtmf != null) state.dtmf = payload.dtmf;
    if (payload.recordingUrl != null) state.recordingUrl = payload.recordingUrl;

    console.log(`[ivr] call=${callId} step=${state.step} dtmf=${state.dtmf ?? '-'} rec=${state.recordingUrl != null}`);

    const reply = nextActions(state);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
});

server.listen(PORT, () => {
  console.log(`[ivr] SikaVoice IVR demo listening on :${PORT}`);
  console.log('[ivr] Local check:  curl -X POST localhost:' + PORT + '/voice/webhook -H \'Content-Type: application/json\' -d \'{"callId":"t1"}\'');
  console.log('[ivr] Public:       ngrok http ' + PORT + '  -> paste the https URL into the Arkesel dashboard webhook field');
});

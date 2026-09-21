/**
 * Demo script for the Track 2 Voice Line. Simulates a full toll-free call
 * through the IVR webhook server using plain HTTP (the same POST fields a
 * telephony platform would send), with no credentials and no phone needed:
 *
 *   1. npm run dev   (in another terminal; starts :3000 in mock mode)
 *   2. npm run smoke (this script: incoming → Twi → passphrase → menu →
 *      balance → send 20 cedis to Ama → confirm → reference + hangup)
 *
 * Assertions are structural: every step must return TwiML containing the
 * expected verb. Amounts are entered as DTMF *minor units* (cedis × 100):
 * "2000" = GHS 20.00, because feature-phone keypads have no decimal point.
 */
const BASE = process.env.VOICE_LINE_URL ?? 'http://localhost:3000';
const CALL_SID = `smoke-${Date.now()}`;
const FROM = '+233241234567';

async function post(path, params) {
  const query = new URLSearchParams({ CallSid: CALL_SID, ...params });
  const response = await fetch(`${BASE}${path}?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ CallSid: CALL_SID, From: FROM, ...params }).toString(),
  });
  if (!response.ok) throw new Error(`POST ${path} failed: ${response.status}`);
  return response.text();
}

function expect(step, twiml, verbs) {
  for (const verb of verbs) {
    if (!twiml.includes(verb)) {
      throw new Error(`${step}: expected TwiML to contain "${verb}"\nGot:\n${twiml}`);
    }
  }
  console.log(`ok - ${step}`);
}

const steps = [
  ['incoming (language menu)', '/ivr/incoming', {}, ['<Gather', 'Akwaaba']],
  ['language-select (Twi)', '/ivr/language-select', { Digits: '1' }, ['<Gather', 'nkyerɛma']],
  [
    'verify (spoken passphrase)',
    '/ivr/verify',
    { SpeechResult: "SikaVoice m'adwene" },
    ['<Gather', 'Tia 1'],
  ],
  ['menu → balance', '/ivr/menu', { Digits: '1' }, ['<Say', 'GHS']],
  ['menu → send money', '/ivr/menu', { Digits: '2' }, ['<Gather', 'Cedis ahe']],
  ['send-amount (GHS 20.00)', '/ivr/send-amount', { Digits: '2000' }, ['<Gather', 'fono nɔma']],
  [
    'send-recipient (Ama)',
    '/ivr/send-recipient',
    { Digits: '0209876543' },
    ['<Gather', '0209876543'],
  ],
  [
    'send-confirm (yiw)',
    '/ivr/send-confirm',
    { SpeechResult: 'Yiw, ɛyɛ' },
    ['<Say', 'VOICE-', '<Hangup'],
  ],
];

try {
  for (const [name, path, params, verbs] of steps) {
    // eslint-disable-next-line no-await-in-loop
    const twiml = await post(path, params);
    expect(name, twiml, verbs);
  }
  console.log('\nVoice Line smoke test passed: 8 IVR steps returned valid TwiML.');
} catch (error) {
  console.error(`\nSmoke test FAILED: ${error instanceof Error ? error.message : error}`);
  console.error(`Is the server running? Start it with: cd voice-line && npm run dev`);
  process.exitCode = 1;
}

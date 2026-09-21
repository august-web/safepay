# SikaVoice — Track 2: Voice Line (Feature-Phone IVR)

Toll-free IVR webhook server for feature-phone users: spoken Twi/Ewe menus,
spoken-passphrase auth (mock Abena AI), DTMF PIN fallback, and a deterministic
mock MoMo ledger — per the dev brief's Track 2 spec (`SIkaPay Dev Brief.docx`
§3 / `README.md` at the repo root). **No credentials or phone needed**: the
server runs in mock mode with a bundled smoke script.

## Layout (separate from the smartphone app)

```
voice-line/
  src/
    index.ts       HTTP entrypoint (Node built-in http only — zero deps)
    routes.ts      IVR handlers: incoming → language → verify → menu →
                   send/airtime/recent → confirm → callback
    twiml.ts       Minimal TwiML (VoiceResponse) builder
    prompts.ts     Twi/Ewe prompt strings (DRAFT — needs native-speaker review)
    session.ts     Per-call sessions keyed by CallSid, 30 s idle expiry
    voiceprints.ts Mock Abena AI (enroll-from-first-sample, 0.85 threshold)
    momo.ts        Mock MoMo ledger: 1% fee capped at GHS 10, VOICE-#### refs
  smoke.mjs        Demo call script (incoming → Twi → passphrase → … → hangup)
```

Track 1 (the Expo app) stays untouched under `src/` at the repo root; the
two tracks share only the documented contract: the `transactions` schema
(`initiatedVia: 'app' | 'voice'`, `readAloud: boolean`) and the Twi/Ewe
language pair.

## Run it (no phone, no credentials)

```bash
cd voice-line
npm run dev     # build + serve :3000 in mock mode
npm run smoke   # simulated call through all 8 IVR steps
```

Sample curl for one step (telephony platforms POST url-encoded fields):

```bash
curl -X POST 'http://localhost:3000/ivr/incoming' \
  -d 'CallSid=demo-1&From=%2B233241234567'
```

`GET /health` reports `mockMode` and the toll-free number.

## Call flow

```
toll-free number → language (1=Twi, 2=Ewe) → spoken passphrase
  → main menu: 1 balance · 2 send money · 3 airtime · 4 recent
  → send: amount (DTMF minor units: "2000" = GHS 20.00 — keypads have no ".")
  → 10-digit recipient → confirm ("yiw"/"ɛ̃"/"yes", or 1/2) → reference + hangup
```

- Auth: speech-first passphrase; retries offer the 4-digit DTMF PIN fallback
  (`MOCK_PIN`, default `0000`; **never a real MoMo PIN**). 3 strikes → lockout.
- First-time mock callers are voice-enrolled from their first usable sample.
- Sessions expire after 30 s idle (brief §6) → bilingual "call back" hangup.
- Every step returns TwiML — callers are never left in silence (the IVR
  equivalent of the app's announcer contract).
- `/ivr/callback?Lang=tw&Amount=20&To=…&Reference=…` renders the §3.6
  post-transaction callback Say.

## Real integration (when credentials exist)

Set `MOCK_VOICE_LINE=false` + `ARKESEL_API_KEY`, expose the server with a
public URL (`PUBLIC_BASE_URL=https://…`), point the Arkesel number's voice
webhook at `/ivr/incoming`, and swap the seam classes: `MockVoiceprintStore`
→ Abena `createVoiceprint`/`verifyVoiceprint`; `MockLedger` → MoMo API via
the shared Appwrite backend. See the root `.env.example` for the full
`ARKESEL_*` / `ABENA_*` / `MOMO_*` variable list.

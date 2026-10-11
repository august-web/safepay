# SafePay speech stack: primary API, fallbacks, licenses

This document is the record the hackathon rules ask for: SafePay's primary
speech engine is the **University of Ghana HCI Lab API**, every fallback is
**open-source with a named license**, and each entry says **when it triggers,
how it is implemented, and what data leaves the device**.

## Rules this stack follows

1. The HCI Lab API is the primary ASR and TTS. It is used sparingly: local
   meters count every request (including failures), silent audio is discarded
   on-device before any upload, and the always-on mic uploads one bounded
   utterance per speech event — never a stream.
2. When the lab's quota is exhausted (or the network is gone), SafePay falls
   back rather than going silent, and every fallback is an open-source model
   with the license recorded here.
3. Nothing secret is ever spoken, stored, or uploaded: the MoMo PIN does not
   exist inside SafePay, and contact data never leaves the device.

## Primary: HCI Lab speech gateway

| | |
| --- | --- |
| Gateway | `https://lab-subscription-platform.vercel.app` |
| ASR | `POST /api/v1/asr` — multipart upload, ≤120 s / ≤10 MB per request |
| TTS | `POST /api/v1/tts` — `{ text, model_type, speaker }`, ≤250 chars, returns WAV (22.05 kHz) |
| Auth | `Authorization: Bearer <token>`; keys live in local `.env`, never committed |
| Free-plan quota | ASR 10/day · 50/week; TTS 15/day · 70/week · 5,000 chars/week; 5 req/min |

How the app stays inside the quota (`src/voice/captureLoop.ts`,
`src/services/labSpeech.ts`, `src/services/labTts.ts`):

- The mic records **bounded windows** (≤15 s), meters them locally, and throws
  away silent windows on-device — silence costs zero quota.
- Only windows that heard speech are uploaded, one request per utterance.
- Local meters (`safepay.asrUsage`, `safepay.ttsUsage`) count every HTTP
  response the gateway returns, 429s and 401s included, and are visible in
  Settings → Voice Output Check.
- TTS for fixed phrases is **pre-rendered and cached in the app** (see
  fallback below), so the live quota is only spent on sentences that cannot
  exist at build time (amounts, names, references).
- A dry quota is spoken honestly (`voice.quota`), never hidden.

## Fallback ladder

| Layer | Primary | On quota exhaustion / offline | License |
| --- | --- | --- | --- |
| TTS, fixed phrases | Lab TTS (build-time renders) | **Bundled clip pack** — Meta MMS TTS, offline in the APK | CC-BY-NC 4.0 |
| TTS, dynamic sentences | Lab TTS at runtime (`labTts.ts`) | Device TTS (`expo-speech`) — English-accented, last resort | Apache 2.0 (Android TTS) |
| ASR | Lab ASR (`labSpeech.ts` + `captureLoop.ts`) | **Meta MMS ASR** self-hosted checkpoint (planned, see below) | CC-BY-NC 4.0 |
| Transcript cleanup (planned) | — | Open-weight LLM assist (see policy) | recorded at adoption |

## TTS fallback: bundled Meta MMS clip pack (render settings FIXED 2026-10-05)

- **Model:** `facebook/mms-tts-aka` (Akan/Twi) and `facebook/mms-tts-ewe` (Ewe),
  rendered by `scripts/generate-voice-clips.py` into 16 kHz mono WAVs under
  `assets/voice/`, wired through the generated require-map
  (`src/voice/voicePack.generated.ts`).
- **Render fix (2026-10-05):** the default VITS settings garbled short
  phrases — "Kɔma Sika" was audible as "ɔma si" (team-reported; corroborated
  by round-trip ASR). Two local, free fixes restore the speech: render each
  phrase period-padded (`. kɔma sika .`) and synthesize with
  `model.noise_scale = 0.5` (default 0.667). Round-trip after the fix:
  "komasi" through the fallback ASR — the dropped initial consonant is back.
  The full Twi pack was re-rendered with these settings; the Ewe pack still
  carries the old renders (re-render on demand with the same command).
- **License:** CC-BY-NC 4.0 (Meta MMS). Non-commercial use — true for this
  hackathon prototype; a production release would need a license review or a
  commercially licensed voice.
- **Trigger:** always for fixed phrases in Twi/Ewe (they play from the APK
  with no network and no quota); this is the offline floor under the Lab TTS.
- **Implementation:** `src/voice/say.ts` / `src/voice/voicePack.ts`; dynamic
  sentences (amounts, phone digits) are composed from recorded number/name
  atoms, never handed to device TTS in the native-pack languages. The pack
  also ships one Lab-TTS-rendered clip (home.sendMoney) — provenance noted in
  BUILD-STATUS.md.

## ASR fallback: self-hosted Meta MMS checkpoint (designed, not deployed)

- **Model:** `facebook/mms-1b-all` (Akan subset) or the per-language
  `facebook/mms-1b-all` adapter — same family the lab's own models build on.
- **License:** CC-BY-NC 4.0 (same non-commercial caveat as above).
- **Trigger:** only when the lab gateway returns `quota`/`offline` and the
  user must still be able to speak a command; the app says which engine is
  listening (honesty rule — never claim the lab model when the fallback ran).
- **Implementation:** `tools/asr-fallback/server.py` (this repo) serves the
  same `POST /api/v1/asr` shape as the lab from a laptop on the same Wi-Fi —
  stdlib HTTP + the project venv's torch/transformers, `.m4a` decoded with
  macOS's built-in `afconvert`, zero new server dependencies. Point
  `EXPO_PUBLIC_SPEECH_API_BASE_URL_ALT` at `http://<laptop-ip>:8700` (any
  `EXPO_PUBLIC_SPEECH_API_KEY_ALT` value) and the existing client retry
  (`labSpeech.ts`) swaps endpoints, not code. `npm run speech:smoke` runs
  against either endpoint unchanged.
- **Status: live, chain verified from the phone.** The phone's real utterances
  reach this server over LAN Wi-Fi and return 200 transcripts (client timeout
  for the fallback attempt: 240 s — CPU inference on a 15 s window takes tens
  of seconds to minutes; short commands are far quicker). Quality on
  over-the-air room recordings is degraded vs direct audio — it keeps the
  conversation alive on a dry-quota day while the lab stays the primary
  experience. First run loads ~4 GB of weights; `/health` reports readiness
  and load errors.

## LLM policy (allowed by the rules, used sparingly)

LLMs are permitted, but SafePay keeps them off the per-utterance path:

- **Where they help:** cleaning a messy transcript before intent matching
  (stutter artifacts the local de-stutter cannot fix, English spelling drift
  on Twi words), and free-form answers (references) where a grammar does not
  exist.
- **Where they do not run:** never on every utterance (latency, cost), never
  on contact data, never on anything PIN-shaped (the PIN never exists in
  SafePay).
- **Adoption rule:** when an LLM enters the stack, this file gains a row with
  the exact model, version, license, hosting, and the trigger that invokes it.
  Nothing ships before that row exists.

## Speech-inclusion notes (why the pipeline is shaped this way)

- **Stuttering:** every transcript passes through a de-stutter pass
  (`destutter` in `src/voice/flowParse.ts`, applied once in
  `VoiceCommandProvider`) that collapses immediately repeated words
  ("me me me sika a aka"). Digit tokens are never collapsed — a repeated digit
  inside a phone number is preserved verbatim, and the read-back resolves any
  ambiguity out loud.
- **Slow speech:** capture windows finalise only after 1.3 s of trailing
  silence (`TRAILING_SILENCE_MS` in `captureLoop.ts`), so the pauses a stutter
  leaves inside an utterance do not cut it in half.
- **Never dead-end:** an unrecognised attempt is re-asked, never punished;
  every voice path has a touch equivalent.
- The evaluation set (`scripts/asr-evaluation-cases.json`) carries stutter and
  repeated-digit cases; run `node scripts/asr-evaluation.mjs` after any change
  to the matching pipeline.

## Verifying the stack

```bash
node scripts/asr-evaluation.mjs     # matcher/parsers, incl. stutter cases
npm run speech:smoke                # live lab round-trip (spends real quota)
npm run apk                         # rebuild with current .env keys
```

Quota discipline for demos: rehearse on a different day than the live demo —
the ASR day-quota is a handful of requests, and every call counts.

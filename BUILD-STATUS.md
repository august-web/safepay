# SafePay Build Status

Last updated: 2026-09-28

## Current Checkpoint

**Phase 0: Baseline and Demo Safety — complete**

The current SafePay implementation was verified before beginning the next feature. No product code was changed for this checkpoint.

## Validation Results

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | PASS | TypeScript completed successfully. |
| `npm run lint` | PASS | No lint errors were reported. |
| `npm run a11y:contrast` | PASS | All WCAG 2.2 AA palette pairings passed. |
| Native Android release build | PASS | `android/app/build/outputs/apk/release/app-release.apk` built successfully. |
| Expo Go suitability | NOT USED | Native speech recognition requires the Android native build. |

The native build completed with existing Gradle deprecation warnings. These did not fail the build.

## Verified Product Baseline

- SafePay is the visible product name.
- Voice commands start automatically when enabled.
- The visible voice-control button is hidden from the header.
- Voice-led transaction flows use the transcript-first conversation surface.
- Send Money, Airtime, and Cash Out can be started from the main workflow.
- Cancel, success, and failure paths return to Home.
- The Android 12 recognizer fallback handles partial results.
- Native voice responses use bundled Twi/Ewe clips where available.
- The demo phone currently has an English offline ASR pack, not native Akan/Ewe/Ga ASR.
- The current transaction service is mock data and is not connected to real provider money movement.
- The real MoMo PIN is not stored or reconstructed by SafePay.

## Worktree Note

The repository contains intentional uncommitted changes from the previous implementation session, including SafePay branding, transcript flows, voice clips, audio routing, accessibility work, and documentation. Do not revert or discard them.

## Phase 1 Progress

**Ghanaian-Language Speech Recognition Spike — transcript evaluator retained, model experiment deferred**

Added:

- `scripts/asr-evaluation-cases.json`: 13 Twi, Ewe, Ga, Pidgin/English command and flow-answer cases covering commands, amounts, phone digits, confirmation, and cancellation.
- `scripts/asr-evaluation.mjs`: evaluates recognizer transcript output and reports intent, amount, phone, confirmation, pass count, failure count, and accuracy.

Decision (2026-09-24): the existing transcript-evaluation path is accepted as-is and the production Android recognizer stays in place. The faster-whisper adapter (`scripts/transcribe-with-whisper.py`) was removed before any model accuracy work started; native-model comparison (Whisper, Meta MMS, wav2vec) is deferred and must be re-raised as its own slice with recorded results before any recognizer replacement. The evaluator can score any model output later — provide a JSON array with matching case IDs and a `transcript` field.

Reference smoke test:

```bash
node scripts/asr-evaluation.mjs
```

Result: **13/13 reference cases passed**. This validates the evaluation harness and parser expectations only; it is not an ASR accuracy claim because the reference input is already-clean text.

## Phase 2 Progress

**Voice-First Onboarding — implemented, on-device smoke passed**

Added:

- `src/screens/OnboardingScreen.tsx`: an 11-step onboarding state machine (welcome → microphone permission → always-on listening explainer → contacts explainer → language → navigation preset → microphone test → voice output test → fingerprint check → three-command teaching → done). Every step is answerable by voice and touch, every answer is mirrored in a transcript view, and no answer dead-ends: an unparsed answer re-asks, and "gyae / stop" exits cleanly to Home without marking setup complete.
- `VoiceCommandProvider` now accepts any `TranscriptSink` (a two-method interface) instead of only `VoiceFlowController`, so onboarding consumes the always-on mic's utterances while it is mounted without touching money-flow code.
- `AppSettings.onboardingComplete` (non-secret): first launch starts in onboarding, completion returns to Home, and Settings → "Run setup again" replays the walkthrough.
- The mic-test step reuses the shared one-shot dictation seam and re-asks after 12 s of silence; the fingerprint step reports success, cancel, lockout, no-sensor and not-enrolled states honestly; the voice-output step replays the Settings sample and reports the privacy route.
- 35 fixed onboarding phrases synthesized as native Twi/Ewe clips (70 new clips, no silent output) and `onboarding.*` strings added to all five locales. Twi/Ewe/Ga/Pidgin strings remain drafts pending native-speaker review.

Validation:

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (zero problems) |
| `npm run a11y:contrast` | PASS (all pairings WCAG 2.2 AA) |
| Release APK build | PASS (`BUILD SUCCESSFUL in 5m 15s`) |
| Install + launch on TECNO demo phone | PASS (app process alive, no crashes in logcat) |
| On-device smoke | PASS — step 1 renders, "Get started" advances to step 2, the already-granted microphone state is detected and spoken ("The microphone is allowed") |

Known limitations:

- The contacts step explains contact lookup and defers the OS permission ask to Phase 3 (least privilege, and `expo-contacts.requestPermissionsAsync` is deprecated in SDK 57 — no contacts module ships yet).
- The microphone permission may still be requested by the boot auto-listen before onboarding's mic step runs; the step detects and announces whichever state it finds (already allowed / denied / permanently denied).
- The full voice-driven and TalkBack walkthroughs need ears on the phone (rehearsal), as does native-speaker review of the draft translations.

## Phase II Prep — UI Polish

Work done while waiting on the HCI Lab API access request.

**Improvement 1: onboarding screen visual polish (2026-09-27)**

- Brand mark (SafePay symbol) in the setup header, with the step counter restyled into the header column.
- Decorative 11-segment progress bar under the header — filled segments for completed steps, gold for the active one; hidden from accessibility on purpose (the "Setup step X of 11" text remains the semantic source).
- Each step card now carries its own short heading (Microphone, Always listening, Contacts, …) above the spoken question, using the existing localized title strings.
- Transcript speaker labels now use the localized `voice.safePay` / `voice.you` pair (keys added to all five locales) instead of borrowing `app.name` and `vcmd.heard`.

Validation: `npm run typecheck`, `npm run lint`, `npm run a11y:contrast` — all PASS. On-device visual check pending (phone dropped off wireless ADB; reconnect and rebuild before the next demo).

**Improvement 2: voice conversation HUD progress bar (2026-09-27)**

- The transcript-first HUD (the surface visible during Send Money / Airtime / Cash Out voice flows) now shows a thin fill bar mirroring the spoken "Step x of y" line, so sighted judges see flow progress at a glance.
- The bar is decorative and hidden from accessibility (`accessible={false}` + `no-hide-descendants`): TalkBack keeps hearing the step words, per the brief's rule against decoration in the accessibility tree.

Validation: `npm run typecheck`, `npm run lint`, `npm run a11y:contrast` — all PASS. Same pending on-device visual check.

**Improvement 3: own-voice echo guard in the mic pipeline (2026-09-27, found during the visual pass)**

- The on-device screenshot review caught a demo-damaging bug: the app's own spoken sentence (the onboarding closing clip) came back through the recogniser and was recorded as a *user* answer inside the Send Money flow transcript, right after the mic session restarted. Root cause: the per-session echo memory is cleared whenever the mic session restarts, so late finals for clips spoken before the restart had nothing to be matched against.
- Fix: a third content-based echo guard (`isOwnVoiceDrift` in `VoiceCommandProvider`) compares incoming transcripts against the spoken history, which survives restarts. It is deliberately conservative — at least five shared words and ≥60% overlap — so real answers (names, amounts, digit sequences) and short repeated commands like "me sika a aka" can never be swallowed.
- Validation: `npm run typecheck`, `npm run lint`, `npm run a11y:contrast` — all PASS. The exact echo path is timing-dependent; re-verify during rehearsal by finishing onboarding and immediately starting a Send Money flow.

**On-device visual pass (2026-09-27)**

- Rebuilt, installed and walked onboarding on the TECNO: welcome/mic/contacts/language/voice-test/done steps all render the new brand header, progress bar and card headings correctly; the done step shows the full bar with the gold active segment.
- The Send Money HUD shows the new progress bar (20% fill at step 1 of 5) with the transcript-first layout intact.
- App state note: the phone had already completed onboarding (spatial preset, English) — the visual pass used Settings → "Run setup again", which works as intended.

**Voice pipeline live verification (2026-09-28)**

- After the AudioRouteModule fix, a 6-minute live logcat capture on the TECNO shows the full chain working on Android 12: partial transcript → `speechend` → 350 ms grace → promotion to heard → intent match.
- `"speak balance"` matched the `balance` intent twice (11:14:50, 11:15:04); `"send money"` matched `send` and the flow opened; recipient name capture then took `"augustine"` outside the intent matcher, as designed. Stray utterances (`"okay"`, `"thank you"`) correctly matched nothing.
- Echo guard 3 rejected the app's own "Who are you sending…" prompt when it came back through the mic mid-flow.
- Ear-confirmation of the spoken response (HUD + loudspeaker) is still a rehearsal item: the logs prove the handler ran, not that the room heard it.

## Next Stage: Phase II Screening (20–23 October 2026)

SafePay qualified out of Ideation Sprint I. The screening rules from the HCI Lab (2026-09-27 email) re-prioritise the roadmap:

1. **Ghanaian-language communication must be implemented and demonstrated** — already built: Twi/Ewe native voice clips, commands and UI in Twi/Ewe/Ga/Pidgin/English. Demo-ready.
2. **Accessibility integrated, not an afterthought** — already built: the a11y contract, audit, and CI-enforced lint. Demo-ready.
3. **ASR/TTS must use the University of Ghana HCI Lab APIs** — access granted 2026-09-28 and docs captured (see Next Feature). The recognizer swap is **implemented** (2026-09-28): the Android recognizer (`expo-speech-recognition`, now uninstalled) is replaced by a bounded `expo-audio` recorder → `POST /api/v1/asr` pipeline (`src/voice/captureLoop.ts`) behind the unchanged transcript handler, with silent windows discarded locally to protect the 10/day quota. Still to do: re-render the Twi/Ewe clip pack from the lab's TTS API (Meta MMS clips are the remaining stopgap) and a live on-device/real-key verification pass.
4. **End-to-end task completion** — the voice send-money flow already completes on the demo phone (mock ledger); demo script exists.
5. **Feasibility, sustainability, scalability** must be argued explicitly — feasibility is proven by the working APK on a real budget phone; sustainability (hosting, maintenance, native-speaker review, provider sandbox path) and scalability (more languages via the clip manifest and locale files, more MoMo providers, Track 2 IVR) still need a written one-pager. Mentorship sessions (28 Sep–1 Oct) target exactly these areas — attend.

## Next Feature

**HCI Lab ASR/TTS provider swap (API access GRANTED 2026-09-28)**

Access granted 2026-09-28; API docs captured the same day from the lab console. Gateway base URL: `https://lab-subscription-platform.vercel.app`.

- Auth: `Authorization: Bearer <token>` on every request (token held in local `.env`, never committed — see `.env.example`).
- ASR: `POST /api/v1/asr` — multipart `file` upload; accepts wav/mp3/ogg/oga/opus/flac/m4a/mp4/aac/webm/aiff/aif/wma/amr; ≤120 s and ≤10 MB per request. Returns a transcript (REST, not streaming).
- TTS: `POST /api/v1/tts` — JSON `{ "text": "...", "model_type": "ss", "speaker": "PT" }`; returns the WAV body itself (Content-Type: audio/wav, 22 050 Hz) with metadata in `X-*` response headers; ≤250 chars per request.
- Free-plan quotas (constrain the design): 5 req/min; ASR 10/day · 50/week · 30 min audio/week; TTS 15/day · 70/week · 5 000 chars/week. The always-on mic must therefore be quota-aware — no streaming, no uploads of silence.
- Supported languages are not documented; the doc examples are Twi/Akan ("Akwaaba, wo ho te sɛn?", `akan_audio.mp3`). Verify Ewe/Ga empirically with a test call before promising them on a screening slide.

1. ~~Obtain lab API documentation~~ — done (above).
2. ~~Verify language coverage empirically with one TTS + one ASR round-trip call~~ — **ran 2026-09-28 with the real key** (`npm run speech:smoke`, 3 TTS + 3 ASR): **Twi PASS** ("kyerɛ me sika" → heard "kyɛɛ me sika" → balance), **Ga PASS** ("mi shika" → heard "me sika" → balance), **Ewe FAIL** ("ɖo ga" → heard "mmea", no intent). Whether the Ewe break is TTS pronunciation or ASR recognition needs the saved WAVs listened to. English was not probed.
3. Re-render the Twi/Ewe voice pack through the lab TTS API (swap the source in `scripts/generate-voice-clips.py`; the manifest and resume support stay). Sized 2026-09-28: 181 clips / ~4.5k speakable chars per language, so one request per clip is impossible (181 requests against a 70/week quota). Plan: ~21–23 batched requests per language — phrases joined with ". " in ≤250-char requests, then split back apart on the silences between them — which fits one language inside a single weekly char window. `npm run speech:smoke -- --batch tw` rehearses exactly that split (one TTS + three ASR requests) and reports the measured gaps before the re-render spends quota. **Rehearsed 2026-09-28**: one 38-char request became a 4.32 s WAV whose two inter-phrase silences (0.54 s, 0.65 s) were far longer than every within-phrase gap (≤0.08 s), the split segments ASR-checked 2/3, and the one miss was a very short isolated word ("aduonu" heard as "ɛhe mu do") — short clips are the flaky case, so per-segment QA needs spot-checks and ears. Quota shape for the real re-render: ~21–23 TTS requests per language; the 15/day cap spreads a language over ~2 days, the 5 000 chars/week cap fits barely one language per week (tw + ee therefore need two weeks, or a quota bump from dcshcilab@ug.edu.gh), and verifying every segment by ASR would blow the 50/week ASR cap — verify a sample instead.
4. ~~Replace the always-on Android recognizer with lab-ASR transcription behind the existing `matchVoiceIntent` layer~~ — **done 2026-09-28**: `expo-audio` recorder windows + `src/voice/labSpeech.ts` client behind the same `handleFinal` guards; honest messaging for offline/timeout/quota/auth failures (`voice.network`, `voice.quota`, `voice.failed`).
5. Update the demo script so the screening demo runs entirely on lab-provided speech.

**ASR upload transport fix (2026-09-28, found during on-device verification)**

- Symptom: every listening window that heard speech failed in under 10 ms with `[SikaVoice asr] upload threw Error: Unsupported FormDataPart implementation`, spoken to the user as the network-failure message. Recordings never left the phone and no request reached the gateway.
- Root cause: Expo SDK 57's winter runtime replaces the global `fetch` with `expo/fetch` (`expo/src/winter/runtime.native.ts`). Its FormData serialiser (`convertFormData.ts`) accepts only strings, `Blob` instances, and objects with a `bytes()` method — React Native's `{ uri, name, type }` file part throws synchronously. React Native's own networking stack was never involved.
- Fix (`src/services/labSpeech.ts`): read the recording through `fetch(uri)` — Expo fetch serves `file://` URLs via its `OkHttpFileUrlInterceptor` — and append `await recording.blob()` to the form under the filename `utterance.m4a`. The now-dead `Platform` import was removed; the diagnostic log in the catch block stays.
- On-device evidence (release APK, dummy key): `[SikaVoice window] speech heard (peak -15 dB) - uploading` at 13:18:48 → `[SikaVoice asr] auth` at 13:18:59 — an 11.6 s file-read + multipart upload + HTTP round-trip ending in the gateway's honest 401 for the dummy key. The identical window failed in 9 ms before the fix, with no network call.
- Note: an `auth` (401) failure stops the always-on listener by design, so this verification consumed exactly one window. The real-key live pass (`npm run speech:smoke` plus an on-device round-trip) awaits the lab key in `.env`, which is never committed (`.gitignore`).

**ASR success-response parser fix (2026-09-28, found by the smoke run)**

- The first real ASR success body shows the transcript sits in `transcription` (`{"request_id":"…","status":"success","transcription":"…","audio_format":{…}}`) — not `transcript`/`text`, which both parsers looked for first. The smoke output rendered successes as "(unrecognised response shape: …)".
- `parseTranscript` in `src/services/labSpeech.ts` and the smoke script's decoder now read `transcription` first. The app had never received a successful ASR body before this (the dummy-key pass only ever saw 401), so without this fix every real success would have been reported to the user as `empty`. Required before the real-key on-device pass.

**Real-key rebuild, first on-device success, and the quota lesson (2026-09-28)**

- The APK installed at 13:16 still carried the placeholder key and predated the parser fix; every utterance died as a 401 and the listener stops on such failures by design — the cause of the "app doesn't respond" report. Rebuilt at 13:49 with the key from `.env` (inlined at build time) via `npm run apk`, installed and launched on the TECNO.
- First real on-device ASR result 13:52:41: `[SikaVoice window] speech heard (peak -2 dB) - uploading` → `[SikaVoice heard]` with a real Twi-script transcript → intent `none` (the utterance did not match a command). The recognizer swap now works end-to-end on the phone; the parser fix is proven on-device.
- The next window at 13:52:56 hit the gateway quota, and a host probe (`node scripts/hci-lab-smoke.mjs tw`) returned `429 daily_quota_exceeded: Daily ASR request limit has been reached`. So the remaining blocker is the lab's 10 ASR/day allowance, and it resets daily.
- **Quota lesson (new, affects rehearsal planning)**: the gateway counts every request that reaches it, 401s included. Today's 10 ASR calls are fully explained only if the dummy-key 401 calls counted: 6 smoke-suite calls + 1 on-device success + ~3 rejected-401 calls from the stale build. A wrong key burns real quota, and a rehearsal day can leave the demo day dry — budget the 10/day deliberately, and ask dcshcilab@ug.edu.gh for a screening quota bump (also worth confirming Ewe ASR support and the daily reset time).

**Phase 3: Contact Lookup and Recipient Disambiguation** remains second in line, per `BUILD-PLAN.md`: least-privilege contacts read, spoken disambiguation of multiple matches, read-back before the amount, manual entry fallback. Exit gate: ambiguous names never silently select a recipient; all permission cases pass; contacts never leave the device.

## Handoff Instructions

The next agent should:

- Read `AGENTS.md`, `BUILD-PLAN.md`, and `AI-CODE-AGENT-PROMPT.md`.
- Preserve existing uncommitted work.
- Treat this file as the Phase 0–2 checkpoint plus the Phase II screening requirements above.
- Work the HCI Lab ASR/TTS swap now: credentials and docs exist (top of this file). Also draft the sustainability/scalability one-pager for screening.
- Run focused tests immediately after each edit.
- Test on the native Android build; Expo Go is not a valid environment for voice work.
- Update this file with the swap result before starting Phase 3.

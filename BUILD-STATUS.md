# SafePay Build Status

Last updated: 2026-10-12

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

## Phase II Prep — Speech Inclusion & Fallback Documentation (2026-10-02)

Focus decision (agreed with the team): **Akan (Twi) is the one native language we get exactly right** — voice, pronunciation, and stutter-inclusive handling. It is the lab's best-supported language (smoke test passed, their doc examples are Twi), the app's default language, and the largest speaker base. Ewe and Ga remain in the app at best-effort; the Ewe ASR miss stops being a screening blocker.

**Improvement: stutter-tolerant transcript matching**

- `destutter` (`src/voice/flowParse.ts`), applied once in `VoiceCommandProvider.handleTranscript`, collapses immediately repeated words — the fingerprint a stutter leaves in an ASR transcript ("me me me sika a aka" → "me sika a aka") — before dictation, flows, intent matching and the visible transcript read it.
- Two deliberate limits: only adjacent duplicates collapse, and **digit tokens never collapse** — a stuttered "zero zero" and a genuine "zero zero" inside a phone number are indistinguishable, and a phone number must never be silently altered. Ambiguity resolves through the spoken read-back instead.
- The evaluation harness mirrors the collapse (as `asr-evaluation.mjs` already mirrors the parsers) and four cases were added: stuttered balance ("me me me sika a aka"), stuttered send ("kɔma kɔma sika"), stuttered amount ("fifty fifty cedis"), and a repeated-digit phone ("zero zero two four …" → `0024123456`, proving digits survive verbatim).
- Capture-window patience was reviewed rather than changed: `TRAILING_SILENCE_MS = 1_300` in `captureLoop.ts` already lets a stutter's within-utterance pause finish without slicing the utterance.
- Validation: `node scripts/asr-evaluation.mjs` → **17/17 cases pass**; `npm run typecheck`, `npm run lint`, `npm run a11y:contrast` all PASS.
- Still owed (rehearsal): recordings from 2–3 Twi speakers who actually stutter, added as consented evaluation cases, so the inclusion claim has measured evidence.

**Improvement: fallback stack documented (`FALLBACKS.md`)**

- The team's rules are now written down where the next agent and the screeners can read them: HCI Lab API is primary and used sparingly (bounded windows, on-device silence discard, meters that count every response); on quota exhaustion the app falls back rather than going silent; every fallback is open-source with a named license.
- TTS fallback is already active and shipped: the bundled Meta MMS clip pack (CC-BY-NC 4.0, non-commercial — stated plainly). ASR fallback is designed with its seam in place (alternate base URL/key in `.env.example`, same client shape, `speech:smoke` runs against either endpoint) using a self-hosted Meta MMS Akan checkpoint; the server itself is the first stretch item if a live no-quota demo is needed.
- LLM policy recorded: allowed, but off the per-utterance path; nothing ships without a row in `FALLBACKS.md` naming model, version, license, hosting and trigger.

**Zero-quota pipeline test + self-hosted ASR fallback (2026-10-02, evening)**

- **Installed on the TECNO**: the stutter-tolerant build (destutter + evaluation cases) and a new zero-quota rehearsal control. Rebuilds and installs never touch the lab quota — only gateway uploads do.
- **Zero-quota pipeline test**: Settings → Voice Output Check now has "Test the voice pipeline" — type a phrase (e.g. "me me me sika a aka") and it is pushed through the exact production path (`injectTranscript` → destutter → flow/matching → HUD → spoken reply) with no microphone and no gateway request. Voice-pipeline wiring can now be rehearsed endlessly at zero ASR cost; live microphone tests are reserved for the deliberate daily budget.
- **Self-hosted ASR fallback built** (`tools/asr-fallback/server.py`): serves the lab's exact `POST /api/v1/asr` shape from this laptop with Meta MMS `facebook/mms-1b-all` (Akan adapter, CC-BY-NC 4.0 documented in `FALLBACKS.md`). `.m4a` uploads decode via macOS's built-in `afconvert`; stdlib HTTP only; success body mirrors `{"transcription": ...}` so the client swaps endpoints, never code. When the lab returns `quota`, the existing `labSpeech.ts` retry against `EXPO_PUBLIC_SPEECH_API_BASE_URL_ALT` picks this server up.
- Fallback status: server code done and syntax-checked; the one-time ~4 GB checkpoint download is running (≈2 h); a live round-trip test with a bundled Twi clip (`assets/voice/tw/*.wav` → expect send/balance text) is the next action once it lands.
- Validation: `npm run typecheck`, `npm run lint` PASS; evaluator still 17/17.

## Phase II Prep — Radial Voice Wheel (2026-10-12)

The spinning-wheel prototype (`docs/radial-voice-prototype.html`, a browser mock) is now a real screen in the app.

**What was built**

- `src/components/RadialVoiceMenu.tsx` — the wheel: six large nodes on a 300 dp dial, `Animated.timing` spin (2.8 s, two extra rotations, JS driver), a top selector, haptic ticks as nodes pass, quick-command chips, and a status line. Ported from the prototype and adapted to the app's theme tokens and `AccessibleButton` conventions.
- `src/screens/RadialMenuScreen.tsx` — the seam: header (back / settings), the wheel, and mic ownership. While open it registers a `TranscriptSink`, so utterances feed the wheel instead of the global command handler; it unregisters on unmount. Two utterances still bypass the wheel on purpose — "home" backs out, "stop" goes quiet — because a blind user must never lose the escape and mute controls.
- `App.tsx` — `onboardingSink` renamed to `micOverride` (any screen may own the mic now), new `'menu'` screen, and selection routes through the existing `handleVoiceIntent`, so the wheel reuses the same intent pipeline as speech and the Home tiles.
- `src/screens/HomeScreen.tsx` — one hero entry point, "🎡 Nne Kawa", above the wallet card.
- Locales: `home.voiceWheel`, `home.voiceWheelHint`, and a `radial` section (`openHint`, `tryAgain`) in all five languages.

**Speech design: zero quota**

Every option carries a `clipKey` for an existing bundled Twi clip (`home.sendMoney`, `home.statement`, `home.buyAirtime`, `home.cashOut`, `home.listenBalance`, `settings.title`; all six verified present in `voicePack.generated.ts`), so a full spin-and-select costs no TTS request. On-device proof from the release APK on the TECNO (logcat, pid 19441): four clips, all `AudioTrack set(): sampleRate 16000` — the bundled pack's rate — and `grep -c "lab-subscription\|synthesizeTts"` over the whole capture = **0**.

Wheel speech was reduced in two passes:

1. *Sweep chatter*: the rotation listener used to speak every node arriving at the selector, which during a spin means 18 clipped labels in 2.8 s. Now the sweep is haptic-only; naming happens when the wheel is idle and being browsed.
2. *Landing echo*: after landing, `home.sendMoney` played twice, ~0.9 s apart. Root cause was not the wheel — `VoiceFlowController.start()` already names the destination (`sayKey('home.sendMoney')` before its first question), and `App`'s `open(clipKey)` does the same for the non-flow intents, so the wheel's own landing clip was a third layer saying the same thing. Fixed by removing the redundant layer (the wheel now haptic-confirms, then hands over after 350 ms) and claiming the landing node in `lastAnnouncedRef` so the idle wheel cannot name it behind the destination. Re-verified: one 1.232 s `home.sendMoney` (08:06:05.3 → 08:06:06.3), then the 1.936 s `vcmd.whoToPay` step-1 question — no echo, and the flow HUD shows "Nkyɛmu 1 wɔ 6 mu".

**Feel test on the TECNO BF6 (720×1612)**

Good: the wheel is the first control on Home, reachable with one tap; nodes are 72 dp (well past the 48 dp minimum) and the big icons survive the small screen; spin → land → voice-flow handoff works end to end from both a tapped node and a spoken/chipped command ("Heard: Check balance — spinning to Kenkan Sika"); the mic hands over cleanly and the HUD's step counter no longer clips (the 2026-10-02 header fix holds).

Known gaps, in priority order for the next pass:

1. **Twi naming needs a native pass.** "Nne Kawa" was invented for this screen and `kawa` reads as *coffee* in Twi; the wheel's own node labels are also English ("Send Money", "Preferences") while the app's Twi strings use different diacritics ("Koma Sika" vs the locale's "Kɔma Sika"). Same bucket as the 12 flagged clips in `dist/tw-clip-qa.json`.
2. **Mixed-language chrome.** Wheel status ("Say or type a command to begin"), quick chips, node labels and the HUD's English frame text ("Voice conversation", "Current question", "Or type your answer") sit on a Twi phone. `MAIN_MENU` is hardcoded rather than `t()`-driven.
3. **Node text rotates with the dial**, so side labels are tilted and hard to read for the low-vision users this screen is meant to serve.
4. **Ewe clip pack is on disk but unregistered** (`voicePack.generated.ts` is Twi-only, 189 clips), so the wheel falls back to the TTS ladder in Ewe.
5. Legacy `Animated` (JS driver) instead of Reanimated, and the low-RAM TECNO still kills the app mid-demo — both pre-existing.

**Validation**

`npm run typecheck` PASS · `npx eslint` on all touched files clean (the port surfaced six `react-hooks` lint errors in the prototype's ref usage, fixed with `useState` for the animated value, an effect for the ref write, and a derived status) · `npm run a11y:contrast` PASS · locale diffs additive (+7/−1 per language) · release APK built and installed on the device, screenshots at `/tmp/rv-fix2-after.png`.

**Removed again (2026-10-13)**

- The user asked for the previous Home back, then for the wheel to go: `RadialVoiceMenu.tsx`, `RadialMenuScreen.tsx`, the 🎡 entry point on Home, the `'menu'` screen and the `home.voiceWheel*` / `radial.*` strings in all five locales are deleted. Everything above stays accurate as the record of what was built and measured; `git log -- src/components/RadialVoiceMenu.tsx` has the code.
- A fuller variant (the dial as the launch screen, no tile Home) was also built and device-tested this session; it is parked in `git stash` entry "wheel-as-launch-screen (parked 2026-10-13 per request)".


## Phase 3 Progress

**Contact Lookup and Recipient Disambiguation — implemented (2026-10-02), on-device verification in progress**

How it works: in the send-money voice flow, a spoken name is looked up in the device's own address book — entirely on-device, never uploaded to the speech gateway, never logged. The OS permission is requested at the moment the flow first needs it (or during onboarding's contacts step, which now performs the real ask with a skip). Then:

- **One match** → the chosen name and phone number are read back natively and a yes is required before any amount is asked (build-plan rule: read-back before amount).
- **Two or more** → the flow never picks silently: it says it found several people, then reads each candidate as "number 1… 2…" followed by that candidate's phone digits composed from native number atoms (quota-free, and the number is the truth that receives the money — the name is mirrored on the HUD). The user answers "1 / 2 / first / second / mmienu / eve…"; an unparseable answer re-asks.
- **No match or denied permission** → spoken honestly ("I don't know that name / contacts are not allowed"), and the flow takes the phone number the old way — manual entry fallback, never a dead end.

Added:

- `expo-contacts@57` (SDK 57 modern API: top-level permission functions, `Contact.getAllDetails([FULL_NAME, PHONES], { name })`); `READ_CONTACTS` in `app.json`; prebuild regenerated `android/`.
- `src/services/contactMatch.ts` — pure, testable matching: Ghana phone normalization (+233 → 0…), name scoring (exact full name > first/surname token > prefix > substring), dedupe per name+number pair, spoken cap of 4 candidates, and `parseSpokenChoice` for the disambiguation answer (numerals, ordinals, Twi/Ewe digit words).
- `src/services/contacts.ts` — permission wrappers and the bounded lookup (native name filter, broad on-device scan fallback, both local-only).
- `VoiceFlowController` — new `lookup → disambiguate → recipientConfirm` states for send flows; step HUD now 6 steps for send; a session-level tri-state (`contactsEnabled`) means a refused permission is respected for the session; stop/cancel during the lookup window is still honored.
- Onboarding contacts step: real permission ask (voice "yes" or the Allow button), granted/denied spoken lines, skippable as before.
- 8 new fixed phrases rendered as Twi/Ewe clips via the local MMS pipeline (378 clips total, none silent) — the look-up prompts stay native and quota-free.

Validation: `npm run typecheck`, `npm run lint` (zero problems), `npm run a11y:contrast` PASS; evaluator 17/17. APK with the contacts module built and installed on the TECNO; the full disambiguation path (two same-named contacts → spoken choice → confirm) is the live test, driven quota-free through Settings → "Test the voice pipeline".

**On-device verification PASSED (2026-10-02, full disambiguation path, zero ASR quota)**

Driven entirely through the typed-answer paths (Settings injection + the HUD's new "Or type your answer" row), against the phone's real address book, in Twi:

1. "send money" → HUD opened at the new 6-step send flow ("Nkyɛmu 1 wɔ 6 mu").
2. "ama" → the flow spoke the new clip ("Merehwɛ wo contacts mu."), the OS READ_CONTACTS dialog appeared, Allow was tapped, and the lookup found **multiple** Ama contacts → "Ahu nnipa pii a wɔ din no." with numbered candidates read by phone digits.
3. Choice "1" → read-back of the real contact ("Sis Ama 0248020386") with the new confirm prompt ("Ka aane gye nipa no to mu, anaagyɛ dabi san paw bio.").
4. "aane" → amount "fifty cedis" (parsed 50) → reference "skip" → money confirm read-back → "aane" → transaction completed.
5. Home ledger shows the confirmed entry: **Sis Ama · −GH₵ 50.00 · Adi mu** — the whole journey cost zero lab requests.

Also shipped in this pass: the HUD gained the brief's touch/text fallback — an "Or type your answer" row that drives the identical flow state machine, so a user who cannot speak (and any rehearsal) never needs the microphone.

Privacy notes: least-privilege read access only (no write), lookups are local-only, and contact data never reaches any network service.

**Self-hosted ASR fallback: live round-trip PASSED (2026-10-02, evening)**

- The one-time ~4 GB `facebook/mms-1b-all` download completed; `tools/asr-fallback/server.py` now runs the full tier for real. Two fixes landed during bring-up: the loader no longer passes `target_lang` to `from_pretrained` (that transformers build sizes the LM head from the wrong vocabulary and the load throws; the base weights load first and `model.load_adapter('aka')` attaches the Akan head correctly), and a failed model load is now surfaced through `/health` (`error` field) instead of dying silently in the loader thread.
- Live test (server on :8700, no lab quota spent): bundled Twi clips transcribed to recognisable Twi text — "kɔma sika" → `ɔma si`, the balance label → `mo mu seka a ɛwɔ mu`, "yi sika" → `yisi`. Honest quality note: the fallback is *degraded but working* — short single-phrase clips come back drifted (the same weak spot the lab batch rehearsal saw), so some commands will need a retry while the tier is active; real user utterances (longer audio) should fare better. Inference is CPU-bound: expect tens of seconds per utterance — acceptable for a keep-it-alive fallback, not for the primary demo path.
- Wiring when needed: `EXPO_PUBLIC_SPEECH_API_BASE_URL_ALT=http://<mac-ip>:8700` (+ any `EXPO_PUBLIC_SPEECH_API_KEY_ALT`) at build time; the client's existing alternate-endpoint retry does the rest. `curl http://<mac-ip>:8700/health` reports readiness (`ready`, `error`).

**Live voice path — verified alive, quota discipline working as designed (2026-10-02, late evening)**

- The capture loop is confirmed running on the current build: system mic-audio events (`audio_record_start/done`) and app logs show a window hearing speech, uploading, and the lab answering. The "never silent → honest failure" chain fired exactly as designed when the lab's **daily quota came back exhausted** (almost certainly teammates testing the shared APK — every device draws the same 10/day): the app spoke the quota message and stopped listening rather than spinning. On the morning of the screening demo this is the behavior we want; during the day it means voice testing is a shared budget.
- Two fallback-ladder fixes landed (typecheck/lint PASS): (1) with an alternate endpoint configured, a lab 429 now falls through to the fallback instead of being short-circuited by the local meter (correct: a dry lab must push the utterance to the open-source fallback; without an alt the meter stays authoritative); (2) documented and worked around a build trap — the JS bundle task does not watch `.env`, so an `.env` edit alone never reaches the app (a source-content change is needed to force re-bundling).
- The installed TECNO build now carries `EXPO_PUBLIC_SPEECH_API_BASE_URL_ALT=http://192.168.1.175:8700` (the self-hosted MMS Akan fallback on this Mac, still serving). Until the lab quota resets, spoken commands on this phone land on the fallback tier: heard and transcribed, with the degraded quality already documented.
- The graded over-the-air voice test (play the Twi prompt out loud → lab hears → transcribes → intent matches → flow opens) is scheduled to run automatically just after the midnight quota reset; its result will be appended here.

**Why the fallback wasn't working — four stacked causes, all fixed (2026-10-03, ~00:05)**

The seamless lab→fallback handover failed in layers; each layer only revealed the next once the one above was fixed. All are now fixed, with the final proof arriving server-side:

1. **Android cleartext policy** (the big one): the platform silently refused the HTTP POST to the LAN fallback — `CLEARTEXT communication to 192.168.1.175 not permitted`. No request ever left the phone. Fixed with `expo-build-properties` → `usesCleartextTraffic: true` (documented tradeoff: demo/LAN device).
2. **Client-side meter short-circuit**: a locally-dry quota day returned `quota` before the alternate endpoint was ever tried. Fixed: with a fallback configured, the attempt always goes out and the ladder runs.
3. **`.env` not watched by the bundle task**: the fallback URL was appended to `.env` but the rebuild reused the cached JS bundle, so the app never had the value. Fixed by a source-content change forcing re-bundle; documented in `labSpeech.ts`.
4. **Server multipart parser**: rejected the phone's uploads (`multipart part 'file' not found`) — header matching was case-sensitive and the phone's serializer differs from curl. Fixed with case-insensitive matching plus a body-snippet in the error.
5. **Client timeout too short for CPU inference**: the phone's upload reached the fallback, but the 45s/90s fetch timeout aborted while the MMS model was still inferring a 15s window. Fixed: 45s for the lab attempt (fast handover), 240s for the fallback attempt.

Proof the chain now works end-to-end: the phone's own recording was POSTed to the fallback and the server answered **200 with a transcription** (`'pe paep'` on a short over-the-air window — degraded, as expected for room-noise recordings; the direct-file tests earlier transcribed clean Twi). Remaining honesty: CPU inference takes tens of seconds to a few minutes per utterance, so the fallback answers slowly — it keeps the conversation alive on a dry-quota day, while the lab (reset at midnight, graded OTA test scheduled for 00:20) remains the primary experience.

**"Kɔma sika" heard as "ɔma si" — understanding layer fixed (2026-10-03, team-reported)**

The team correctly flagged the top issue: degraded ASR transcriptions ("ɔma si", and the fully fused "oamase") were not understood — "heard but not understood" is the worst failure for a blind user. Root cause: the command matcher's second pass only tolerated edits when the transcript and phrase had the SAME word count, so a fused one-word transcript could never reach a two-word command phrase.

- **Pass 3 added** (`matchVoiceIntent` in `src/voice/commands.ts`): when exact and same-shape passes find nothing (utterances ≤3 words), space-stripped forms are compared by **longest common subsequence** with a ≥60%-of-shorter-side and ≥4-character bar — order preserved, while dropped phonemes, extra characters and fused words all forgive. Ties prefer the phrase covering more of its own length, so "komasika" resolves to send (8/8) rather than the longer balance phrase it overlaps. Stop/cancel deliberately stays exact-only (a misheard "skip"/"nope" must never cancel money), and a false match here can only OPEN a flow, which then read-backs and demands an explicit yes — it can never move money.
- The evaluation harness mirrors the new pass and gained the team's failing cases: "ɔma si" → send and "oamase" → send.
- Validation: evaluator **19/19** (all previous cases unregressed); typecheck and lint clean; the drift build is installed on the TECNO, and the on-device injection test confirmed "oamase" opens the send flow with the Twi prompt ("Hwan na worekɔma no sika?").

**"Kɔma Sika" response audio — the render was the defect; lab-voice clip shipped (2026-10-04)**

The team's report ("SafePay's response says ɔma si") pointed at the real defect: the **response clip itself**. `home.sendMoney.wav` was a local MMS render whose audio genuinely says ~"ɔma si" — corroborated independently by round-tripping it through the fallback ASR ("ɔma si"/"omasi") and by the team's ears. MMS TTS truncates short phrases (the same weak spot the batch rehearsal saw); re-rendering locally is deterministic, so it would garble identically.

- The phrase was re-rendered through the **Lab TTS** and shipped in its place; the new clip round-trips through the fallback ASR as "oma si ka" (the fallback always drops that initial consonant — through the *lab* ASR the earlier identical render transcribed as "kɔma sika" exactly), and the live over-the-air test on Oct 4 19:05 proved the whole chain with the corrected audio: `speech heard (peak -2 dB)` → `[SikaVoice heard] "kɔma sika"` → `[SikaVoice intent] "kɔma sika" -> send` — heard, understood (right words), carried out (send flow opened).
- **Batched re-render of the remaining phrases is designed but paused**: `scripts/rerender-clips-lab.py` batches phrases into ≤250-char TTS requests and splits the reply on between-phrase silences. Two splitter failure modes surfaced (absolute quiet threshold read the quiet lab renders as silence; a relative threshold over-splits long sentences at their own internal pauses), and a variable-shadowing bug briefly used a phrase key as the API key (fixed). Single-phrase requests need no splitting and are the reliable path — 24 phrases at 15 TTS/day spans ~2 days, so the remaining corrections should run per-phrase (`--only key1,key2`) over the coming days, with every result verified by human ears before it ships.
- Three clips this run temporarily overwrote were reverted to their committed MMS renders; only `home.sendMoney.wav` carries the lab voice. Clip provenance (lab vs MMS) is tracked here and in FALLBACKS.md until the re-render completes.

**Lab-voice re-render status (2026-10-05, ~01:15)**

- The corrected "Kɔma Sika" response (lab female voice, ≈242 Hz — consistent with the pack's female character per pitch analysis) is installed and verified live: the lab heard "kɔma sika" exactly, matched send, and the flow opened.
- The remaining flow-response phrases still carry MMS renders (the low/garbled voice the team flagged). Their re-render is quota-blocked: the day's 15 TTS requests were exhausted — partly by my own 401-retry storms, the exact mistake the Sep 28 quota lesson documented for ASR. The script now **stops immediately on HTTP 429** (a dry day is never retried) and caps flap retries at 3.
- The reliable re-render path is one phrase per request (`--per-phrase`, no silence splitting — the batched splitter over-splits long Twi sentences at their internal pauses). Resume command when the quota resets:
  `.tools/tts-venv/bin/python scripts/rerender-clips-lab.py --lang tw --per-phrase --only vcmd.whoToPay,vcmd.askAmount,vcmd.confirmSend,vcmd.confirmTo,vcmd.sayYesNo,vcmd.contactNumber,vcmd.askReference,vcmd.contactLooking,vcmd.contactNotFoundFixed,vcmd.contactMany,vcmd.contactPick,vcmd.recipientCheck,vcmd.flowCancelled,vcmd.balanceIs`
  (14 requests of the day's 15; QA runs on the local fallback ASR only; every clip needs human-ear confirmation before the screening demo.)
- Open questions for `dcshcilab@ug.edu.gh`: the daily reset hour (quota was still dry at 00:45 and again in the afternoon), whether 401/429 attempts count against the day, and the available TTS speaker voices.

**Full-pack lab-voice re-render — queued and ready (2026-10-05)**

Per the team's direction, the ENTIRE Twi pack (184 clips) moves to the lab's female voice, replacing the local MMS renders. `scripts/rerender-clips-lab.py --lang tw --full --per-phrase` now:

- builds the complete key list (manifest keys present in the locale + number atoms + currency + every vcmd line — 184 total),
- orders it by conversation priority (the 14 flow prompts first, then other vcmd lines, then home/*, then the rest, number/name atoms last),
- renders ONE phrase per request (no silence splitting — the reliable path; "Kɔma Sika" proved it),
- keeps resume state in `assets/voice/tw/.lab-rendered.json` so interrupted runs continue,
- caps each run at 14 successes (the plan is 15/day) and QA-checks every clip through the local fallback ASR (advisory only — human ears confirm before the demo).

Timeline at 14/day: ~13-14 days, landing ≈Oct 17-18 before the screening — IF the command runs daily. Faster options: a quota bump from the lab (collapses to 2-3 days), or re-designing batched splitting. Daily command (after the quota resets — the reset hour is still unconfirmed; a 429 means try later, it costs nothing):

```bash
.tools/tts-venv/bin/python scripts/rerender-clips-lab.py --lang tw --full --per-phrase
npm run apk   # ship the day's corrected clips (or batch every few days)
```

The fallback QA server must be running for the QA signal (`tools/asr-fallback/server.py --lang aka --port 8700`). Ewe follows the same path after Twi if the team wants it (another ~week of quota), else Ewe keeps MMS renders — documented in FALLBACKS.md.

**Local render fix — the fallback stack now covers the whole voice (2026-10-05)**

The team asked whether the fallback could replace the lab for the voice work. It now can, at the rendering layer too: the local MMS TTS's short-phrase garble ("Kɔma Sika" audible as "ɔma si") was traced to two synthesis parameters, and both fixes are free and offline:

- **Period padding** — render each phrase as `. kɔma sika .` — restores the dropped initial consonant;
- **`model.noise_scale = 0.5`** (default 0.667) — tightens the synthesis.

Round-trip through the fallback ASR went from "omosi" to "komasi" (understood as send by the matcher). The **entire Twi pack (189 clips) was re-rendered locally** with these settings — zero lab requests — and QA'd by round-tripping every clip through the fallback ASR: **172 pass, 16 flagged for human ears** (mostly the very short number/name atoms where the fallback ASR itself is weakest — listen to `dist/tw-clip-qa.json`'s flagged list before the demo), 1 transient error. The Ewe pack keeps its old renders until re-rendered with the same command.

This unblocks the voice from the lab's TTS quota entirely: renders are local and unlimited; the lab TTS remains the premium option (its female voice for home.sendMoney shipped Oct 4 — note the full re-render has since replaced it with the corrected local render for one-voice consistency; restore it per-clip via the lab TTS if preferred after an ear check).

**HUD header overlap fix (2026-10-11)**

Team-reported from screening-prep screenshots (Oct 2): the Voice conversation HUD's step counter ran into the right screen edge and was clipped ("Step 1 of" with the tail cut off; Ga/Twi "Nkyemu 1 wɔ …" the same). Root cause: the header was one `flexDirection: 'row'` with default `flexShrink: 0` on both children — the 28px title's max-content width plus the step label exceeded the ~312dp content width on the TECNO (360dp), so the trailing label overflowed past the right padding and the screen clipped it. Layout now puts the two small labels (brand + step) on one row — step pinned with `flexShrink: 0` / `numberOfLines: 1`, brand shrinkable — and gives the big title its own full-width row below. Validation: typecheck / lint / a11y:contrast PASS; rebuilt and installed on the TECNO over wireless ADB; on-device screenshot shows "Nkyɛmu 1 wɔ 6 mu" fully visible with a proper right margin and the title on one line. The video-call window overlapping the header in one team screenshot was an external WhatsApp PiP overlay, not an app defect.

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

**Lab TTS runtime integration (2026-09-28)**

- `src/services/labTts.ts`: HCI Lab TTS client for dynamic sentences that have no pre-rendered clip. `POST /api/v1/tts` with `{ model_type: 'ss', speaker: 'PT' }`; ≤250 chars per request; language map `tw`→`tw`, `ee`→`ee`, `ga`→`gaa`, `pcm`→`en` (no Pidgin model). A 15/day local meter (`safepay.ttsUsage`) mirrors the ASR meter's honesty rule — every HTTP response counts, 429s and 401s included — and one retry against the alternate subscription (`EXPO_PUBLIC_SPEECH_API_KEY_ALT`) covers a dry primary key.
- `src/services/speech.ts`: `speak()` routes Twi/Ewe/Gã through Lab TTS first (native voice where device TTS would read the orthography with an English accent) and falls back to `expo-speech` on any failure, so quota/network problems never silence the app. The WAV is written to the cache directory and played with `expo-audio`; the mic quiet gate (`markSpeakingSync`) holds through the whole network round-trip, so the recorder never hears the app.
- Settings voice-check section now reports the channel: "Native voice: SikaVoice Lab TTS (N of 15 left today)". The value is read once at mount, so it refreshes on re-entering Settings, not live.
- Which path exercises it on the phone: for Ewe the announcement path deliberately stays silent (clip-pack languages never hand raw text to any TTS — composed sentences go through `sayPlan`), and Settings "Te gbe ɖa" plays a bundled clip. Gã is the language whose announcements reach `speak('ga')` → Lab TTS, so Gã is the on-device proof.
- Bug found by that proof (15:31:39): synthesis succeeded (server WAV returned; the local meter moved 15→14 after a fresh Settings mount) but playback fell back to device TTS — `Location 'file:///file:///data/user/0/gh.safepay.app/cache/tts-….wav' isn't writable`. Root cause: `playLabWav` prefixed `file://` onto `FileSystem.cacheDirectory`, which is already a `file://` URI. One-line fix (`src/services/speech.ts`), rebuilt (3m40s) and re-verified on the TECNO.
- Re-verify evidence (post-install, app pid 29282): two Gã announcements played the server WAV through the app's own ExoPlayer — `15:40:53.944 I/AudioTrack(29282): set(): sampleRate 22050 … sessionId 68745` → `stop(12358): called with 22288 frames delivered` (~1.0 s), and a second at 15:41:35 → `stop(12362): called with 55056 frames delivered` (~2.5 s). 22 050 Hz is the lab WAV rate and the pid is the app, not `com.google.android.tts` (10675); zero `[SikaVoice tts]` fallback warnings after the rebuild (the only one in the whole capture is the 15:31:39 pre-fix line). The `file://` fix is confirmed on-device.
- Meter honesty cross-check: Settings showed 12 of 15 on a fresh mount after these runs — exactly 3 TTS requests counted (15:31:39 pre-fix attempt + the two post-fix playbacks). One tap on an already-selected Gã button re-announces by design (`LanguageSwitcher.select` is unconditional), which is what produced the two post-rebuild playbacks.
- ASR quota is still dry (`[SikaVoice asr] quota` at 15:40:59, expected until the lab's 10/day resets); the post-playback window that hit it also proves the capture loop resumes ~0.5 s after lab playback stops.

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

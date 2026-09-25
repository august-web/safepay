# SafePay Build Status

Last updated: 2026-09-24

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

## Next Feature

**Phase 3: Contact Lookup and Recipient Disambiguation**

Per `BUILD-PLAN.md`: add the native Contacts provider module with least-privilege read access, request the permission only when a send flow needs it, match first name / surname / full name with accent and nickname tolerance, handle zero / one / many matches (read candidates aloud and let the user choose), read the selected name and number back before the amount, and keep manual phone entry as the fallback.

Exit gate: ambiguous names never silently select a recipient; permission accepted / denied / revoked / unavailable cases pass; contacts never leave the device.

## Handoff Instructions

The next agent should:

- Read `AGENTS.md`, `BUILD-PLAN.md`, and `AI-CODE-AGENT-PROMPT.md`.
- Preserve existing uncommitted work.
- Treat this file as the Phase 0 checkpoint, the Phase 1 transcript-evaluator decision, and the Phase 2 onboarding result above.
- Implement only the Phase 3 contacts slice (permission ask belongs in the send flow, not blanket on launch).
- Run focused tests immediately after each edit.
- Test on the native Android build; Expo Go is not a valid environment for voice work.
- Update this file with the Phase 3 result before starting Phase 4.

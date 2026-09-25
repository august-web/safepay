# SafePay Feature Build Plan

This plan is deliberately incremental: one feature is implemented, tested on the native Android build, reviewed for accessibility and security, and only then is the next feature started.

## Product Rules

1. SafePay is voice-first. Visual UI is a quiet transcript and status surface, not a duplicate form-heavy workflow.
2. Every transaction is read back before authorization.
3. The real MoMo PIN is never stored, requested, reconstructed, or converted from a SafePay phrase.
4. SafePay uses official provider authorization and backend-held credentials when real-money APIs are introduced.
5. Every feature must work with TalkBack, with haptics/audio privacy protections, and with a touch fallback.
6. Mock transactions remain clearly marked until a provider sandbox has been verified end to end.

## Delivery Loop

Every feature follows this loop:

1. Define the user outcome and security boundary.
2. Identify the owning module and write the smallest focused test/check first.
3. Implement only that feature.
4. Run TypeScript, lint, unit/parser tests, accessibility checks, and the relevant Android test.
5. Test on the connected Android phone using the release/development native build.
6. Test the failure path, cancellation path, screen-reader path, and no-network path.
7. Record what passed, what remains mocked, and any known limitation.
8. Only then begin the next feature.

Required baseline commands:

```bash
npm run typecheck
npm run lint
npm run a11y:contrast
npm run apk
```

For native voice work, Expo Go is not sufficient. Use the native Android build and test on the actual target phone.

---

## Phase 0: Baseline and Demo Safety

### Goal
Create a repeatable baseline before changing product behavior.

### Work

- Confirm the current SafePay APK launches.
- Confirm microphone permission and always-on listening behavior.
- Confirm the current transcript flow, cancellation, Home return, and mock ledger.
- Keep the short live presentation runbook in `DEMO-SCRIPT.md` accurate.
- Capture the current known Android recognition limitation: the demo phone has an English recognition pack, not a native Twi/Ewe/Ga ASR pack.

### Tests and exit gate

- App launches without a crash.
- `npm run typecheck` passes.
- `npm run lint` passes without new errors.
- `npm run a11y:contrast` passes.
- A spoken English command works twice in succession.
- `gyae` or `stop` cancels a flow and returns Home.
- The APK installs and launches on the phone.

Do not begin feature work until this baseline is recorded.

---

## Phase 1: Ghanaian-Language Speech Recognition Spike

### Goal
Determine which ASR solution can recognize Twi, Ewe, Ga, and Pidgin reliably enough for SafePay commands.

### Candidates to evaluate

- Whisper or `faster-whisper` with Ghanaian speech evaluation samples.
- Meta MMS ASR language checkpoints where a usable Akan/Ewe/Ga checkpoint exists.
- XLS-R or wav2vec 2.0 fine-tuned for the target language.
- GhanaNLP, university, Mozilla Common Voice, and other Ghanaian speech datasets.
- Official cloud speech APIs only if they explicitly support the required Ghanaian locale and privacy requirements.

### Work

- Create a small consented evaluation set: commands, names, phone digits, amounts, confirmations, and cancellations.
- Include different speakers, accents, speech rates, background noise, and low-volume speech.
- Measure word/command accuracy, amount accuracy, digit accuracy, latency, offline behavior, and battery use.
- Keep the current Android recognizer as a fallback while evaluating.
- Do not claim native-language recognition based only on fuzzy matching English transcripts.

### Tests and exit gate

- At least 30 recorded utterances per core command and language for the first comparison.
- Report command accuracy, digit accuracy, amount accuracy, median latency, and failure rate.
- Reject any model that silently changes amounts or phone numbers.
- Choose one deployment path: on-device, private backend, or provider API.
- Document data retention, consent, and network behavior.

No transaction API work starts until the ASR path and its limitation are documented.

---

## Phase 2: Voice-First Onboarding

### Goal
Make first launch usable without sight or prior app knowledge.

### Flow

1. Welcome to SafePay and explain the privacy purpose.
2. Ask for microphone permission.
3. Explain that listening is active while SafePay is open.
4. Ask for Contacts permission, with a skip option.
5. Ask for preferred language.
6. Ask whether TalkBack is enabled and adjust announcements.
7. Run microphone input test.
8. Run voice output and headphone/privacy test.
9. Offer biometric setup/test.
10. Teach three commands: balance, send money, stop.
11. Confirm setup and save completion state.

### Work

- Add an onboarding state machine, not a collection of unrelated screens.
- Make every question answerable by voice and touch.
- Persist only onboarding completion and non-secret preferences.
- Make permissions explainable, optional where possible, and retryable from Settings.
- Never block the user permanently if Contacts or biometrics are unavailable.

### Tests and exit gate

- Fresh install walkthrough with TalkBack off.
- Fresh install walkthrough with TalkBack on.
- Permission accepted, denied, and denied permanently.
- App closed and reopened midway through onboarding.
- Language changed during onboarding.
- Voice output unavailable or headphones disconnected.
- Completion is stored and onboarding does not repeat unnecessarily.

---

## Phase 3: Contact Lookup and Recipient Disambiguation

### Goal
Let the user say a recipient name instead of memorizing a phone number.

### Work

- Add a native Contacts provider module with least-privilege read access.
- Request Contacts permission only when onboarding or a send flow needs it.
- Normalize names, accents, spaces, and nicknames locally.
- Match first name, surname, and full name.
- Handle zero, one, and multiple matches.
- For multiple matches, read each candidate and ask the user to choose.
- Read the selected name and phone number back before asking for the amount.
- Never silently choose an ambiguous contact.
- Keep manual phone-number entry as a fallback.

### Tests and exit gate

- Permission accepted, denied, revoked, and unavailable.
- Exact name, partial name, accented name, nickname, and no match.
- Two contacts with the same first name.
- Contact with multiple phone numbers.
- Invalid or missing phone number.
- Confirm selected recipient before amount entry.
- Ensure contacts never leave the device unless explicitly required and consented.

---

## Phase 4: Voice Flow and Transcript Simplification

### Goal
Make all core journeys voice-first without crowding the UI.

### Work

- Keep the transcript view as the primary surface during Send Money, Airtime, and Cash Out.
- Show only the current question, recent recognized answers, progress, status, and Cancel.
- Remove duplicate form controls from voice-led journeys.
- Keep touch forms available only as an explicit fallback path.
- Add consistent Home recovery after cancel, success, failure, timeout, and app interruption.
- Keep amounts, recipient names, fees, and confirmations visible in the transcript.

### Tests and exit gate

- Send Money end to end.
- Airtime self and other-recipient flows.
- Cash Out flow.
- Unknown answer causes a re-ask, not a dead end.
- Stop/cancel works at every step.
- Back/Home recovery works from every state.
- Transcript is announced correctly by TalkBack.
- UI remains readable at narrow device widths and large font settings.

---

## Phase 5: Secure Authorization Design

### Goal
Replace mock authorization with secure, provider-compatible authorization without handling the user’s secret PIN.

### Non-negotiable boundary

SafePay must not store the MoMo PIN, even encrypted. It must not turn a catchphrase into the PIN or forward a reconstructed PIN to a provider. A rotating phrase may identify a SafePay session, but it is not an authorization secret equivalent to the provider PIN.

### Work

- Research official MTN MoMo Open API sandbox access and authorization requirements.
- Contact Telecel Ghana and AT Ghana for official API/partner documentation.
- Define backend-held credentials, OAuth/token handling, request signing, and webhook verification.
- Use provider-hosted or provider-approved authorization.
- Keep device biometrics as the local approval gate.
- Add Android device-credential fallback where permitted.
- Add transaction nonce, idempotency key, timeout, retry, and status polling.
- Add amount, recipient, velocity, and daily-limit risk checks.
- Add an audit event without recording sensitive voice content or PIN data.

### Tests and exit gate

- Sandbox request-to-pay or disbursement succeeds.
- Duplicate network retries do not duplicate a transaction.
- Provider timeout produces a pending state, not a false success.
- Biometric cancel leaves the transaction unsubmitted.
- Device credential fallback behaves correctly.
- No logs, analytics, storage, or crash reports contain PINs or authorization secrets.
- Security review approves the authorization architecture.

Do not connect production credentials until this phase passes review.

---

## Phase 6: Transaction Ledger, Statements, and SMS Import

### Goal
Make the user’s balance and transaction history trustworthy and easy to hear.

### Work

- Replace mock transaction storage with the provider-backed backend.
- Reconcile provider status with local pending states.
- Keep the statement narrator sequential and interruptible.
- Preserve SMS import as an explicit user-triggered fallback, not an automatic reader of all messages.
- Read transaction name, type, amount, fee, status, and reference clearly.
- Add empty, pending, failed, and offline states.

### Tests and exit gate

- Provider balance matches the ledger.
- Pending transaction later becomes confirmed or failed.
- Statement narration handles zero, one, and many transactions.
- SMS parser rejects unrelated messages and does not duplicate imports.
- Sensitive values are hidden until the user asks to reveal or hear them.

---

## Phase 7: Hardening and Field Test

### Goal
Verify the complete product with real target users and realistic conditions.

### Work

- Test with visually impaired users using TalkBack.
- Test noisy markets, quiet rooms, low battery, speaker mode, headphones, and Bluetooth.
- Test Twi, Ewe, Ga, Pidgin, and English flows.
- Test old Android devices and low connectivity.
- Test app interruption by calls, notifications, screen lock, and backgrounding.
- Add crash reporting that excludes voice content and secrets.
- Produce a release checklist and rollback plan.

### Exit gate

- No critical accessibility blockers.
- No transaction can complete without explicit confirmation.
- No secret PIN handling exists in the app.
- ASR limitations are clear to users and presenters.
- Provider sandbox and failure states are verified.
- Demonstration script reflects the actual build.

## Immediate Next Three Tasks

1. Run the Ghanaian ASR spike and record measurable results.
2. Build the voice onboarding state machine with permission and audio tests.
3. Add contact lookup with ambiguous-name confirmation.

Only after those three pass their exit gates should provider API integration begin.

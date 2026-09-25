# SafePay Presentation Runbook

**Format: live demo only. No slides. Keep the phone charged and use the native Android build.**

## 13-minute order

### 1. Open with the problem (30 seconds)

Say: “SafePay is a mobile-money companion for visually impaired MoMo users. It removes the privacy tax: no handing a phone to an agent, and no speaking a secret PIN aloud.”

Then immediately demonstrate the working product.

### 2. Local-language proof first (2 minutes)

Set the app language to **Akan (Twi)** before presenting. The microphone starts automatically when SafePay opens and is hidden from the layout.

Say clearly: **“kɔma sika”** or **“koma sika.”**

Point out only what matters: “The command is understood in Twi spelling or the English spelling drift produced by Android’s recognizer. SafePay responds with bundled native Twi voice clips.”

The transcript should show the question and each recognized answer. This is the visual proof for a user who has low vision and the spoken proof for a blind user.

### 3. Complete one safe transaction (5 minutes)

Use this sequence:

1. Say **“kɔma sika.”**
2. Answer **“Ama.”**
3. Answer with the demo number: **“zero two zero nine eight seven six five four three.”**
4. Say **“fifty cedis.”**
5. Say **“skip.”**
6. Review the spoken read-back: recipient, amount, fee, and total.
7. Confirm with **“aane”** or use the fingerprint prompt.

Say while the confirmation appears: “This replaces speaking a PIN to another person with biometric confirmation. The transfer is mock data, but the complete accessible flow is real.”

### 4. Show inclusion and recovery (2 minutes)

- Show the transcript: SafePay’s question, the user’s answer, and the current question.
- Say **“gyae”** to demonstrate cancellation.
- Confirm that cancellation returns to Home.
- Say **“me sika a aka”** to demonstrate a Twi balance command.

### 5. Close with the working scope (1 minute)

Mention briefly: Twi and Ewe native response clips, screen-reader labels, haptic privacy mode, biometrics instead of spoken PINs, and the statement narrator.

Do not open every settings panel during the presentation. Settings are supporting evidence, not the main demo.

## If recognition hesitates

- Repeat the same phrase once, slowly and close to the phone microphone.
- Use **“koma sika”** if **“kɔma sika”** is not transcribed clearly.
- Use English **“send money”** only as a recovery path, not as the local-language demonstration.
- If the transfer flow becomes uncertain, say **“gyae”**, return Home, and restart the short sequence.

## Honest technical note if asked

Android’s recognizer on this demo phone does not include an Akan or Ewe speech model. SafePay therefore uses the available Ghanaian/English recognition path, fuzzy-matches native-language spelling drift locally, and speaks fixed responses with bundled Ghanaian voice clips. The app never claims the phone has a native Akan/Ewe recognizer when it does not.

---

## Full voice command reference

## 1. Command keywords (speak any time — the mic is always on)

The mic opens once when the app launches and stays on for the whole session. Say a command, get an action. All keywords work in **Twi, Ewe, Ga and English**; English also works no matter which language the app is set to.

### Money & features

| Feature | English | Twi | Ewe | Ga |
| --- | --- | --- | --- | --- |
| **Send money** | "send money", "transfer" | "kɔma sika", "soma sika" | "ɖo ga", "dɔ ga" | "kɛ shika aya", "shika aya" |
| **Buy airtime** | "buy airtime", "top up", "buy data" | "tɔ airtime" | "airtime" | "airtime" |
| **Cash out / withdraw** | "cash out", "withdraw" | "yi sika", "twe sika" | "xe ga", "xexɛ ga" | "mɔ shika", "mo shika" |
| **Check balance** | "check my balance", "my money" | "me sika a aka", "kyerɛ me sika" | "ga si le asinye", "nye ga" | "mi shika" |
| **Read statement** | "statement", "read my statement", "history" | "me sika krataa", "abakɔsɛm" | "ga ƒe ŋkɔkɔ", "nkoko" | "shika he sane" |
| **Go home** | "go home", "home" | "san kɔ fie", "fie" | "ɖo aƒe", "afe" | — |
| **Open settings** | "settings", "change language" | — | — | — |
| **Repeat last** | "repeat", "say that again" | — | "gbugbɔ gakpɔ" | — |
| **Stop / cancel** | "stop", "cancel", "be quiet" | "gyae" | "dzo ɖa", "te ɖa" | — |
| **Help** | "help", "what can I say" | — | — | — |

### Inside a money flow, the answers are free speech

You do **not** memorise these — you just answer the app's questions:

| The app asks… | You can say… |
| --- | --- |
| "Who are you sending to?" | A contact name (**Ama, Kwame, Kofi, Abena**) or a phone number ("zero two four, one two three…") |
| "How much?" | Any amount: "fifty cedis", "aduonum" (50), "bladeve eto" (35), "300" |
| "For yourself or someone else?" *(airtime)* | "myself" / "someone else" (then the number) |
| "Which agent code?" *(cash out)* | The agent's digits |
| Confirm read-back | **"yes / aane / ɛ̃"** to confirm, **"no / dabi / ave"** to cancel |
| Any time in a flow | **"stop / gyae / dzo ɖa"** cancels everything |

Amount words recognised: Twi numbers (koro…aduokron, oha, apem), Ewe numbers (deka…blaasieke, alafa, akpe), English digits and words, up to GH₵10,000 (demo ceiling).

## 2. What the demo flow looks and sounds like (send money, end to end)

1. User: **"kɔma sika"** (send money) → app confirms in Twi: *"Hwan na worekɔma no sika?"* (Who are you sending to?)
2. User: **"Ama"** → app: *"Dɛn ne ne fono nomba? Ka no mmienu mmienu."* (What is their number? Say it digit by digit.) — a named contact always asks for the number, so a misheard name can never send money to the wrong person
3. User: **"zero two zero nine eight seven six five four three"** → app: *"Dodoɔ bɛn na worekɔma?"* (How much?)
4. User: **"fifty cedis"** → app: *"Nkyerɛkyerɛmu bi wɔ hɔ? Ka skip sɛ ɛnnhia."* (Any reference? Say skip to pass.)
5. User: **"school fees"** (or **"skip"**) → app reads everything back natively: *"You are sending GH₵50.00 to Ama. Fee is GH₵0.50. Total is GH₵50.50. Say yes to confirm, or no to cancel."*
6. User: **"aane"** (yes) → biometric prompt appears (fingerprint) → transaction runs → app announces: *"Transaction complete. Reference 1234."* (reference digits in native voice)
7. Balance check: **"me sika a aka"** → the new, reduced balance is spoken with native number atoms.

Short version if time is tight: "kɔma sika" → "Ama" → digits → "fifty cedis" → "skip" → "aane". Saying **"stop / gyae"** at any point cancels cleanly; an unrecognised answer just re-asks the question, so the flow never dead-ends.

The same dialogue works for airtime (self or other → amount) and cash-out (agent code → amount). No screen touches anywhere.

## 3. The PIN story (from the project docs — this is the pitch, memorise it)

**The problem the docs name:** visually impaired MoMo users must hand their phone to a stranger or **speak their secret PIN aloud** to complete a transaction — the "privacy tax."

**SafePay's answer (App track):** there is **no PIN to speak, ever.**

- Confirmation of every transaction is **fingerprint / biometric** (Android BiometricPrompt via `expo-local-authentication`) — the docs: *"fingerprint confirmation in place of a spoken PIN."*
- On a phone with no fingerprint enrolled (our demo phone), the app says so honestly and the **voice yes/no** becomes the authorisation: *"No fingerprint is set up, so your voice confirmation will be used."*
- Nothing secret is ever spoken: amounts are read back **before** confirmation, with a cancel window — *"spoken read-back of the amount, fee, and recipient before a transaction completes, a brief window to cancel."*
- (Voice Line track, for feature phones, uses a spoken **passphrase** + voiceprint — mention it in one sentence if asked about Track 2.)

**Demo the PIN story in 20 seconds:** say "send money", answer the prompts, and when the fingerprint dialog appears say: *"This is the moment a blind user would normally dictate their PIN to a stranger. SafePay replaces it with a fingerprint."* Then confirm with the finger.

## 4. Rehearsal checklist (do these tonight)

1. **Enroll a fingerprint** on the TECNO (Settings → Security → Fingerprint) so the biometric moment shows properly.
2. **Set the app language to Twi or Ewe** (Settings → Language) — that's the audience-wow setting; English fallback still works for every command.
3. Run through the send-money flow **twice**, out loud: "kɔma sika" → "Ama" → "fifty cedis" → "aane". The recogniser has no Twi model, so pronounce clearly and let the fuzzy matcher do its job.
4. If a command isn't caught, just say it again — the mic never closes. Saying "stop" cancels a flow cleanly.
5. **Balance demo**: "me sika a aka" before and after a transfer — the number changes, proving the transaction ledger.
6. Battery: keep the phone charged; wireless ADB off during the talk (the mic + logcat don't need it).

## 5. Known demo limits (be upfront if asked)

- Twi/Ewe **speech recognition** doesn't exist on Android — commands in Twi/Ewe are matched from the recogniser's English-alphabet spelling of native words, with fuzzy matching. Works best with clear speech; occasional retries are normal.
- Transactions are **mock** (simulated MoMo backend) — the flow, read-backs, fees, ledger and biometrics are real; the money isn't.
- Ga and Pidgin speak via device TTS (no Meta MMS voice exists for Ga); Twi and Ewe use the bundled native Meta voices throughout.

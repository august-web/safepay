# SafePay Twi voice-flow test script

Written 2026-10-15 from the code, not from memory. Every Twi line is verbatim from
`src/i18n/locales/tw.json`; every accepted answer is taken from what the parsers
actually match (`src/voice/commands.ts`, `src/voice/flowParse.ts`,
`src/voice/VoiceFlowController.ts`). File:line references throughout so you can check
me when something doesn't behave.

App language must be **Twi** (the default, `src/i18n/index.ts:23`).

---

## 0. Read this before you start

**Silence is expected in several places.** Twi speech comes only from the bundled clip
pack. Three of the app's speech paths never use clips:

| Path | What happens in Twi |
|---|---|
| `sayKey` with a clip (`src/voice/say.ts:175`) | clip plays — the normal voice |
| `announce()` with TalkBack **off** (`src/a11y/announcer.ts:35-40`) | **total silence**, deliberately |
| `speak()` ladder (`src/services/speech.ts:115`) | Lab → GhanaNLP → device voice |

So form-screen error messages, the 3-second cancel countdown, "processing", statement
Play All / Pause / end-of-list, and the SMS results are **silent** unless TalkBack is on.
That's by design (nothing English-accented is ever spoken in Twi) but it will feel like
the app broke. If you want to hear those, turn TalkBack on first.

**Say each answer after the prompt finishes.** The mic is live the whole time and the app
drops anything it hears while its own clip is still playing (`src/voice/voicePack.ts:34`,
400 ms tail). Answering too early = the app never heard you and just repeats the question.

**Step numbers are not spoken.** `vcmd.stepOf` ("Nkyɛmu 1 wɔ 6 mu") is a HUD label only —
no code speaks it (`VoiceFlowHud.tsx:44,59`), and its own numbering is wrong in two flows
(airtime reaches "5 of 4", cash-out never shows step 2). Count the questions, not the counter.

---

## 1. Cheat sheet — what to say

### Yes / no / cancel
Matches are word lists, not sentences (`flowParse.ts:17-26`).

| Meaning | Say (Twi) | Also accepted |
|---|---|---|
| yes, go ahead | **aane** | ane, eni, enyie, yes, ok, confirm, correct, sure |
| no | **dabi** | daabi, no, nope, cancel, stop |
| abort everything | **gyae** | gyae kasa, stop, cancel, quiet, silence |

### Amounts (the trap list)
`extractAmount` (`commands.ts:405-454`) knows ones `koro, mmienu, mmiɛnsa, ɛnan, ɛnum,
ɛnsia, ɛnson, ɛnwɔtwe, ɛnkron`, tens `aduonu, aduasa, aduanan, aduonum, aduɔsia, aduɔson,
aduɔwɔtwe, aduɔkron`, scales `ɔha/oha` = 100 and `apem` = 1000, and the words `cedi, sedie,
ghc`. Ceiling 10,000 (`commands.ts:452`).

| Amount | Say | What the parser computes |
|---|---|---|
| 1 | **koro** | ✅ 1 |
| 20 | **aduonu** · **cedi aduonu** | ✅ 20 |
| 35 | **aduasa enum** | ✅ 35 (30+5 composes) |
| 50 | **aduonum** · **cedi aduonum** | ✅ 50 |
| 100 | **ɔha** | ✅ 100 (`commands.ts:426`) |
| 1000 | **apem** · **koro apem** | ✅ 1000 — a scale multiplies whatever precedes it, defaulting to 1 |
| **10** | **cedi du** | ❌ **FAILS.** `du` is in no parser list (`commands.ts:417-424` jumps straight from 20 to 90), so it returns nothing and the app re-asks |
| 500 | **enum ɔha** | ⚠️ the parser only does *multiplier-then-scale* (5×100). If native Twi puts the hundred first — "ɔha enum" — that reads as **105**. Tell me which order is right and I'll fix the parser rather than the wording |

Same order question for 200 ("ɔha mmienu" vs "mmienu ɔha") and 300. The demo's own airtime
quick amounts are 5, 10, 20, 50 (`BuyAirtimeScreen.tsx:33`) — **5 and 10 have no Twi words the
parser knows at all** ("nan"/"ɛnan" is 4, not 5; 5 is "enum").

### Spoken phone numbers and agent codes
Digits one at a time, `flowParse.ts:29-35`:

`koro(1) mmienu(2) mmiɛnsa(3) ɛnan(4) ɛnum(5) ɛnsia(6) ɛnson(7) ɛnwɔtwe(8) ɛnkron(9)`

**0 does not work in Twi.** The digit list knows `zero, oh, nought, ziro, hwia` — `hwia`
is Ewe. Twi "hwee" (`tw.json` num.0) is absent (`flowParse.ts:30`). So spoken numbers
that contain 0 will lose that digit or fail the 9-digit minimum. **Workaround for testing:
say the number in English digits, or type it in the "Or type your answer" box.**

### Names that resolve
`DEMO_CONTACTS` (`src/services/transactions.ts:187-192`), matched by substring
(`flowParse.ts:183`):

| Say | Number it resolves to | Has a Twi name clip? |
|---|---|---|
| **Ama** | 0209876543 | ✅ |
| **Kwame** | 0241234567 | ✅ |
| **Kofi** | 0551234567 | ✅ |
| **Abena** | 0271234567 | ✅ |
| Ama Serwaa / Kwame Mensah / Yaa Ofori / Self | — | ⚠️ only Ama Serwaa and Kwame Mensah have clips; "Self" and "Yaa Ofori" have none, so a read-back containing them falls back to silence or device TTS |

Demo balance **GH₵ 1,200.00**; account holder **Yaa Ofori**; fee **1%, capped at GH₵10**
(`transactions.ts:32-37`).

---

## 2. Home screen — pressing each tile

Tiles themselves say nothing when tapped (haptic only, `HomeScreen.tsx:312-381`). What you
hear is the flow or screen they open. `App.tsx:249-252` wires **Send / Airtime / Cash out**
tiles straight into the conversational flows, so pressing a tile asks you questions out loud.

| Tile (Twi) | English | What SafePay says next |
|---|---|---|
| **Kɔma Sika** | Send money | "Kɔma Sika" then step 1 of the send flow (§3) |
| **Airtime ne Data** | Airtime & Data | "Airtime ne Data" then step 1 of airtime (§4) |
| **Yi Sika** | Cash out | "Yi Sika" then step 1 of cash out (§5) |
| **Sika Krataa** | Statement | opens the reader, nothing spoken until you press a row (§6) |
| **MoMo SMS Nhyehyɛeɛ** | SMS tools | opens the screen, silent (§7) |
| **Nhyehyɛeɛ** (⚙️ top right) | Settings | opens the screen, silent (§8) |
| **Kenkan Sika** 🔊 | Read balance | "Wo sika a ɛwɔ mu ne … koro apem sedie" (1,200) |
| **Kyerɛ / Suma** | Show / hide balance | **silent** in Twi without TalkBack (`announce()`) |
| a transaction row's 🔊 | read that row | name + type + amount + status, all clips |

Row types: `Sika a wɔsomaa` (sent) · `Sika a wɔnyae` (received) · `Airtime a wɔtɔe` (airtime)
· `Sika a wɔyii fii mu` (withdrawn); status `Adi mu` (confirmed) · `Ɛrekɔ so` (pending) ·
`Anyɛ yie` (failed).

---

## 3. Send money — the questions in order

Demo path shown here is with **contacts permission denied/not granted** (the common case on
the demo phone); with device contacts the app searches them first and adds two extra
questions (see §3b).

| # | SafePay asks (Twi) | English | You can say | Then |
|---|---|---|---|---|
| 1 | **Hwan na worekɔma no sika?** | Who are you sending money to? | "Ama" · "Kwame" · a 9+ digit phone · `gyae` to quit | name → ask the number; bare number → jumps to amount (§3a); unrecognised → **asks 1 again** |
| 2 | **Dɛn ne ne fono nomba? Ka no mmienu mmienu.** | What is their phone number? Say it digit by digit. | the 10 digits, one at a time (see the 0 caveat) | → amount; unparseable → asks 2 again |
| 3 | **Dodoɔ bɛn na worekɔma?** | How much are you sending? | "cedi aduonum" (50) · "aduonu" (20) · "ɔha" (100) · over 10,000 rejected → asks again | → reference |
| 4 | **Nkyerɛkyerɛmu bi wɔ hɔ ama saa som yi? Ka skip sɛ ɛnnhia.** | Any reference for this transfer? Say skip if not needed. | **skip** (say this exact English word) · none · next · dzo | anything else is stored verbatim as the note → confirm |
| 5 | **Worekɔma** *[50]* **ma** *[Ama]* **ka a wɔbɔ ne** *[0.50]* **nyinaa bom ne** *[50.50]* — **Ka aane gye to mu, anaagyɛ dabi gya no.** | You are sending 50 cedis to Ama, fee 50 pesewas, total 50 cedis 50 pesewas. Say yes to confirm, no to cancel. | **aane** → sends · **dabi** → **cancels the whole flow** (says "Wogyaee.") · anything else → re-asks 5 | result |
| 6 | **Dwuma no adi mu pɛpɛɛpɛ** · **Nkyerɛase** + 12 reference digits, one by one | Transaction complete · Reference … | `gyae` / "Fie" (go home) | back to Home |

⚠️ **Do not say "gyae" at question 4.** `isStopUtterance` runs before the step handler
(`VoiceFlowController.ts:233`), so "gyae" — which the skip list also accepts — cancels the
**entire transfer** instead of skipping the note (`:575`). Say "skip".

Failures you can trigger: amount above balance → "Wo sika nnyi papa mu. Hwɛ wo balance."
(not enough funds); random 15% network fail → "Ntam a ɛnni ho. Yɛw bio."; fingerprint mismatch
→ "Nsa nkyerɛwde no nyɛ wo dea. Yɛw bio." No fingerprint enrolled → "Wo nne na ɛgye to mu."

### 3a. Bare-number shortcut
Answer question 1 with a full phone number and the flow skips to the amount
(`VoiceFlowController.ts:358-364`) — 4 questions instead of 6.

### 3b. With device contacts granted
1 → "Merehwɛ wo contacts mu" (checking your contacts) → then either
- one match: **Ka aane gye nipa no to mu, anaagyɛ dabi san paw bio.** (say yes to confirm
  this person, no to pick again) → aane / dabi; dabi returns to question 1;
- several: **Ahu nnipa pii a wɔ din no.** (I found several people with that name) then
  **Ka nipa no nomba.** (say the person's number) — answer with **koro / mmienu / mmiɛnsa /
  ɛnan** (1st–4th, max 4 candidates, `contactMatch.ts:93-116`). Twi ordinals like "a ɛtɔ so
  mmienu" do **not** parse — only the number word;
- none: **Menim din no. Ka ne fono nomba.** (I don't know that name, say their number) → number.

---

## 4. Buy airtime — 4 questions

| # | SafePay asks | English | You can say | Then |
|---|---|---|---|---|
| 1 | **Woara, anaagyɛ obi foforɔ?** | For yourself, or someone else? | **woara** (self → pays your own line 0241234567) · **obi foforɔ** (someone else) · a 9+ digit number · `gyae` | self → amount; other → phone question |
| 2 | **Dɛn ne ne fono nomba no?** | What is their phone number? | digits (same 0 caveat) | → amount |
| 3 | **Dodoɔ bɛn na worekɔma?** | How much? | "aduonu" · "mmienu" (2) — presets on screen are 5/10/20/50 (`BuyAirtimeScreen.tsx:33`); **5 and 10 have no Twi words the parser knows**, so say 20 | → confirm (no reference step) |
| 4 | **Worekɔma** *[20]* **ma** *[Self / digits]* **ka a wɔbɔ ne** *[0.20]* **nyinaa bom ne** *[20.20]* — **Ka aane gyee to mu, anaagyɛ dabi gya no.** | You are sending 20 to … | **aane** / **dabi** | "Dwuma no adi mu pɛpɛɛpɛ" + reference |

Two wording bugs to watch while testing: the read-back verb is **"Worekɔma" (sending)** for
all three flows, so airtime and cash out are announced as payments (`:621-662`); and the
spoken fee is 1% even though airtime actually charges no fee (`transactions.ts:259`) — so the
total it reads is 20.20 while 20.00 is deducted. If you say "aane" the money still moves
correctly; the *spoken* read-back is the thing that's wrong.

⚠️ There is **no Twi phrase for opening the airtime flow by voice.** `airtime` intents are
English-only (`commands.ts:119-133`): say "airtime", "top up" or "buy data", **not**
"Tɔ airtime" — even though `vcmd.helpNative` tells you to say "Tɔ airtime" (`tw.json:409`).
Use the tile instead.

---

## 5. Cash out — 5 questions (you'll see/hear 4)

| # | SafePay asks | English | You can say | Then |
|---|---|---|---|---|
| 1 | **Dɛn ne agent koodu no?** | Which agent code? | any **3+ digits** (`:337-349`) — e.g. "ɛnsia mmienu ɛnan num enum ɛnsia"; form example is 123456 | → amount |
| 2 | *(never shown)* | — | — | — |
| 3 | **Dodoɔ bɛn na worekɔma?** | How much? | "cedi aduonu" (20) | → confirm |
| 4 | **Worekɔma** *[20]* **ma** *[digits]* **ka a wɔbɔ ne** *[0.20]* **nyinaa bom ne** *[20.20]* **Ka aane gyee to mu, anaagyɛ dabi gya no.** | (reads as "you are sending 20 to …", see bug above) | **aane** / **dabi** | "Dwuma no adi mu pɛpɛɛpɛ" + reference |

Note `vcmd.withdrawing` ("Woreyi sika", *you are withdrawing*) exists and has a clip, but the
voice flow never uses it — only the touch screen's dictation read-back does
(`CashOutScreen.tsx:76-83`). If you hear "Woreyi sika" you're in the form, not the flow.

---

## 6. Statement — no questions, narration only

Press a row's 🔊 and you hear: `name · type · amount · status` composed from clips, e.g.
**"Kwame Mensah · Sika a wɔnyae · apem sedie · Adi mu"** (received GH₵1,000 from Kwame
Mensah, confirmed). No "item 2 of 3" counter is spoken in clip mode — that string only
exists in the TalkBack/TTS fallback (`StatementScreen.tsx:84-92`).

Fixtures you can test with: received GH₵500 Kwame Mensah · sent GH₵50 Ama Serwaa ·
airtime GH₵20 Self · and any you create.

**Play All / Pause / Prev / Next** press: pause and end-of-list go through `announce()` →
**silent in Twi without TalkBack** (`:156,176-193`), even though clips for them exist. If a
name has no clip the screen falls back to `speak()` device TTS (`:116-121`) — you'll hear an
English-accented voice reading Twi. That's a policy violation worth noting.

---

## 7. SMS import — silent screen

Nothing is spoken on entry or on success in Twi: results go through `announce()`
(`SmsImportScreen.tsx`). "Nkra no adi mu! Yɛanya … a ɛfa … ho." is display/TalkBack only.
Sample SMS in the screen uses Agent 654321 (`:28`). Test this by tapping, not by voice —
there is **no voice command for SMS at all**.

---

## 8. Settings — tap-only

No speech on entry, and every control (language switch included) is tap-only. There's a
`vcmd.testVoice` path: **Sɔ nne no hwɛ** (Test the voice) plays `settings.voiceSample` —
**"SafePay nne nhwɛsodeɛ. Wobɛtumi ate w'akaunt mu sika ne nsɛm bere biara."**
(*"SafePay voice test. You can hear your account money and news any time."*) — that's the
single best one-clip check that the pack sounds right. It's a button, not a command: ⚙️ → the
voice section.

To switch language back to Twi you must tap it; "change language" is in the English-only
`settings` phrase list (`commands.ts:156-168`).

---

## 9. Onboarding — 11 steps, one question each

Reach it with ⚙️ → **San yɛ nhyehyɛeɛ no** (redo setup), or on a fresh install.

| # | SafePay says | English | You say |
|---|---|---|---|
| 1 | "Akwaaba. SafePay ma wote wo sika, na wo PIN rennsɛ da…" | Welcome. SafePay lets you hear your money, and your PIN is never asked. Set up takes a moment — use your voice or your hand. | **anything** advances |
| 2 | "Microphone no ho akwannya?…" | May we use the microphone? | **aane** → the permission dialog; **dabi** → next step |
| 3 | "Bere a SafePay rebue no, microphone no da so…" | While SafePay is open the mic stays on — no button needed. Say stop and SafePay closes. | anything |
| 4 | "Akyire yi, sɛ woka din te sɛ Ama a…" | Later, if you say a name like Ama, SafePay can find their number. Contacts stay on your phone. | **aane** → permission; anything else → next. Reply is "Contacts agye tom…" or "Ɛnnɛ nnyɛ hwee…" |
| 5 | **Kasa bɛn na wopɛ?** | Which language do you want? | **twi / akan** (or "ewe", "ga", "pidgin", "english") → "Kasa no asesa." then continues in that language; or **tɔ so** (continue) |
| 6 | "Sɛn na wupɛ sɛ wodwo krataafa no so?" | How do you want to move around the screen? | **anammɔn** or **aane** = linear (TalkBack style) · **baabi** = fixed spatial · or "second"/"two"; anything else re-asks. Reply "Wɔasie no yie." |
| 7 | "Sɛ wo nne. Sɛ nhwɛso: SafePay, ɛte sɛn?" | Speak. For example: "SafePay, how are you?" | speak anything → **"Wo kae"** + "Microphone no yɛ adwuma." (1.6 s later it advances; silence re-asks every 12 s with "Mantie hwee. Ka bio, yɛ den kakra.") |
| 8 | "Te SafePay nne." + **Wote nhwɛso no?** | Listen to SafePay's voice. Did you hear the sample? | **aane** → "Ɛyɛ. Wobɛtumi asesa nne so bere biara." · **anything else** → "Yɛ nne no den, na tie bio." + replays the sample |
| 9 | "SafePay gye dwuma biara to mu de wo nsa nkyerɛwde…" | SafePay confirms every transaction with your fingerprint; your PIN is never asked. On entry it says one of "Wo nsa nkyerɛwde asiesie." / "Wo fono yi nnisa nkyerɛwde nnihɔ…" | **dabi** → skips to the lesson; anything else → runs the fingerprint test, then "Nsa nkyerɛwde no agye to mu…" / "…annye to mu…" / "Mbɔden bebree dodo. Twɛn kakra." |
| 10 | **Ahyɛdeɛ mmiɛnsa.** "Ka: me sika a aka… kɔma sika… gyae…" | Three commands. Say "my balance"… "send money"… "stop". | **me sika a aka** → "Ɛyɛ! Me sika a aka…" · **kɔma sika** → "Ɛyɛ! Kɔma sika…" · **gyae** → "Ɛyɛ! Gyae tu SafePay so." (here gyae is the *lesson*, not an exit) · **mekae no / tɔ so** → done |
| 11 | "SafePay asiesie…" | SafePay is set up. Say "me sika a aka" to hear your balance. | anything finishes; the button is **Bue SafePay** |

Exit mid-onboarding: `gyae` (any step except 10) → "Nhyehyɛeɛ no agyae. San fi aseɛ wɔ
Settings mu."

---

## 10. Free commands you can say from anywhere

Matched by `commands.ts`. The Twi column is what's actually in the code — **empty means the
app only understands English there**, even when its own help message claims otherwise.

| Intent | Twi you can say | English that works |
|---|---|---|
| balance | **me sika a aka** · sika a aka · kyerɛ me sika · me sika · sika | my balance · check balance · how much money |
| statement | **sika krataa** · me sika krataa · abakɔsɛm | statement · read my statement · history |
| send | **kɔma sika** · soma sika · soma | send money · transfer · pay someone |
| home | **san kɔ fie** · fie | go home · main menu |
| stop / cancel | **gyae** · gyae kasa | stop · cancel · be quiet · never mind |
| cash out | **yi sika** · twe sika | cash out · withdraw · agent |
| **airtime** | ❌ *none* | airtime · top up · buy data · recharge |
| **help** | ❌ *none* | help · what can I say · guide me |
| **repeat** | ❌ *none* | repeat · say that again · once more |
| **settings** | ❌ *none* | settings · change language · contrast |

Reply to an unrecognised command: **"Mante ahyɛdeɛ no aseɛ. Ka Me sika anaa Fie bio."**
(*I didn't catch a command. Say "my balance" or "home".*) — and to "help": "Gye wo tom. Wobɛtumi
aka: Me sika, Sika krataa, Kɔma sika, Tɔ airtime, Yi sika, Fie, San ka bio, anaagyɛ Gyae."
Note that message invites three things the matcher can't do: "Tɔ airtime", "San ka bio"
(repeat) and no Twi for help itself.

**There is no in-flow "repeat the question".** Once a flow is active it swallows every
transcript as an answer (`VoiceCommandProvider.tsx:316-319`), so "repeat" while it's asking
becomes a wrong answer and it simply re-asks. To hear a prompt again, press the HUD label —
the on-screen question is re-announced on double-tap by TalkBack, otherwise silent.

---

## 11. Bugs this script exposed (fix before the pitch)

1. `du` (10) is unparsable in Twi amounts — `commands.ts:417-424`. The screen's own airtime
   presets are 5 and 10, so two of four quick amounts can't be spoken in Twi.
2. `hwee` (0) is not a Twi digit word in `flowParse.ts:30` (only Ewe `hwia`), so any spoken
   phone number or agent code containing 0 breaks. All four demo contacts start with 0.
3. "gyae" cancels the flow at the reference step instead of skipping — `:233` vs `:575`.
4. `vcmd.helpNative` advertises Twi commands ("Tɔ airtime", "San ka bio") that don't exist in
   the matcher — the app tells the user to say things it can't hear.
5. Airtime and cash-out read-backs say **"Worekɔma"** (you are sending); `vcmd.withdrawing`
   and `vcmd.topUpFor` exist but aren't used by the flow (`:621-662`).
6. Airtime voice flow quotes a 1% fee that isn't actually charged (`:624` vs
   `transactions.ts:259`).
7. `vcmd.flowNotUnderstood` ("Mepa kyɛw, mantee…") has a clip and no call site; the
   `stepOf` clip speaks a hard-coded "1 of 3".
8. Step numbering: send counts reference and confirm as step 5; airtime reaches 5 of 4;
   cash out skips 2.
9. Dozens of screen strings go through `announce()` and are therefore **silent in Twi** with
   TalkBack off (errors, countdowns, statement controls, SMS) even where a clip exists.

# SikaVoice — Track 1 Companion App

An accessibility-first mobile money companion app for visually impaired MoMo
users in Ghana. Built for the **MTN Ghana Tɛkyerɛma Pa Hackathon 2026**.

Every screen is labeled for screen readers from the ground up, biometrics
replace the spoken PIN, and transaction details are read back before you
confirm — the "privacy tax" is the thing this app removes.

## Stack

- **React Native + Expo SDK 57** (TypeScript, strict)
- `expo-local-authentication` — biometric auth (`biometricsSecurityLevel: 'strong'`)
- `expo-speech` — TTS read-back (`ak-GH` / `ee-GH` / `en-GH`)
- `expo-haptics` — haptic fallback patterns (confirm / cancel / error)
- `expo-audio` — private-audio (headphone) detection
- `i18next` + `react-i18next` — Akan (Twi), Ewe, English
- `eslint-plugin-react-native-a11y` — accessibility linting in CI

## Run it

```bash
npm install
npx expo start          # scan with Expo Go, or press i / a / w
```

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # eslint incl. react-native-a11y rules
```

Demo works with mock data; biometrics use the simulator's enrolled fingerprint
or skip gracefully when no sensor is available.

## Accessibility contract

Non-negotiables from the dev brief, implemented here:

| Brief requirement | Where |
| --- | --- |
| `accessibilityLabel` / `Role` / `Hint` / `State` on every interactive element | `src/components/AccessibleButton.tsx`, `AccessibleField.tsx` |
| Announcements for state changes (live-region pattern) | `src/a11y/announcer.ts` |
| Focus management on route/step changes | `src/a11y/useAnnounceOnFocus.ts` |
| Touch targets ≥ 44×44 (we use 48dp) | `src/constants/theme.ts` (`touchTarget.minSize`) |
| Biometric error states announced (`user_cancel`, `lockout`, `failed`) | `src/screens/SendMoneyScreen.tsx` |
| TTS read-back of amount, fee, recipient before confirm | `SendMoneyScreen` review phase |
| Haptic fallback when no headphones (public place) | `src/services/haptics.ts` + `headphones.ts` |
| Cancel window before finalize | `SendMoneyScreen` processing phase (3s) |
| Twi/Ewe from day one | `src/i18n/locales/{tw,ee}.json` |
| WCAG 2.2 AA colour contrast (1.4.3 text, 1.4.11 UI) | `src/constants/palettes.json`, gated by `npm run a11y:contrast` |
| Never silent: spoken output falls back to the app's own TTS when no screen reader is running | `src/a11y/announcer.ts`, `src/a11y/screenReader.ts` |
| Real private-audio detection (headphones / earbuds / Bluetooth) | `modules/audio-route/` (local native module) |
| Spoken statement narrator advances on voice completion, not a fixed timer | `src/screens/StatementScreen.tsx` |
| Spoken orientation on first launch, and a voice self-test in Settings | `App.tsx`, `SettingsScreen` → Voice Output Check |

## Voice architecture

This is an inclusion app for blind users, so silence is a bug. Two rules keep
spoken output working:

1. **The app is never silent.** `announce()` posts to the screen reader's live
   region *only when a screen reader is actually running*. If TalkBack is off,
   the same call speaks through `expo-speech` instead. Previously every
   announcement went to a live region nobody was listening to, so the app was
   mute for the default case: a fresh install with TalkBack disabled.
2. **The privacy guard changes the channel, not the volume of information.**
   `modules/audio-route` asks Android's `AudioManager` for its output devices;
   a wired headset, earbud, USB or Bluetooth route counts as private, so
   amounts are spoken. On the loudspeaker the app speaks briefly and vibrates
   the amounts (`src/services/haptics.ts`), and Settings → Screen Contrast →
   Audio Privacy Guard lets the user pin either behaviour.

Settings → **Voice Output Check** shows which channel is live, whether
headphones are detected, and the voice the engine actually picked, plus a
**Test voice output** button so a user can confirm audio before a transaction.

### Native Ghanaian voice clips

Google's on-device TTS ships no Akan, Ewe or Gã voice, so Twi and Ewe text read
by device TTS came out in an English voice. Meta's MMS TTS models do cover these
languages (`aka`, `ewe`, `gaa`), so the fixed phrases a user hears most are
pre-rendered to audio clips and shipped in the app:

```bash
.tools/tts-venv/bin/pip install torch transformers   # one-off, project-local
npm run voice-clips                                   # regenerate every clip
```

- `scripts/voice-clip-manifest.json` - which strings get a clip (fixed phrases
  only; interpolated strings are skipped automatically, they have no stable
  text to render).
- `assets/voice/<lang>/*.wav` - 16 kHz mono clips, plus `manifest.json` with
  duration and peak/RMS per clip so silent output is caught at generation time.
- `src/voice/voicePack.generated.ts` - the `require()` map Metro needs, written
  by the generator. Do not edit by hand.
- `src/voice/say.ts` - `sayKey('home.sendMoney')` plays the clip when one exists
  and falls back to device TTS otherwise, so dynamic sentences (amounts,
  recipients) still speak.

Settings → **Voice Output Check** reports the voice the engine picked and how
many native clips are installed, so the state of the voice pipeline is never a
mystery during a demo.

### Spoken commands

`expo-speech-recognition` (from the brief's App Track package list) is wired to
`src/voice/commands.ts`, a local grammar covering English plus Twi/Ewe/Gã words -
"balance", "me sika", "ga", "soma sika", "twe sika", "help", "repeat", "stop"
and more. Matching is longest-phrase-wins and runs on device; the app confirms
every command out loud before acting, because a user who cannot see the screen
must never be left guessing whether they were heard. The recogniser is also fed
the command vocabulary as biasing strings, which measurably improves accuracy.

Note: on-device logcat shows the worked example - a Tap on *Speak Balance* used
to produce haptics and nothing else.

## Colour & contrast

Colour is a functional requirement for an inclusion app, so the team's two
palettes live in `src/constants/palettes.json` — **soft cream** (low glare) and
**high contrast** — and users pick between them in Settings → Screen Contrast.

Every pairing the UI renders is verified, not eyeballed:

```bash
npm run a11y:contrast          # fails the build if any pair drops below WCAG AA
npm run a11y:contrast --.mjs   # (see scripts/wcag-audit.mjs) add --suggest for fixes
```

Current status: **all 76 pairings pass WCAG 2.2 AA** in both palettes. Three
rules keep it that way:

- **Gold is a fill, not ink.** The palette golds (#D9A441 / #B8860B) only clear
  3:1 against light surfaces, so they carry navy text on top. When gold is
  needed *as* text or an icon, use `theme.colors.goldInk`.
- **`theme.colors.controlBorder`** is the 3:1 input outline; `theme.colors.border`
  is the softer decorative divider, which WCAG exempts.
- **Style sheets use `themedStyles((colors) => ({ ... }))`**, never
  `StyleSheet.create` directly, so a palette switch repaints without a reload.

## Brand assets & app icons

Every icon — launcher, splash, store — is derived from the team's brand files,
never hand-edited:

```bash
npm run icons           # assets/*.png + the Android mipmaps, from the brand artwork
npm run icons:preview   # true-size review sheet → assets/_iconreview/launcher-preview.png
```

- `assets/safepay-symbol.png` (the dot-symbol) is the source for **launcher**
icons: at 48dp the wordmark is unreadable, and the launcher already prints the
app name underneath.
- `assets/safepay-logo-transparent.png` (full lockup) is used where the
wordmark has room: store/iOS icon and the splash screen.
- Adaptive icons are sized to Android's **66dp safe circle**, not the full 108dp
canvas, so the launcher mask can never clip a dot. `npm run icons:preview`
renders the result at real size under circle/squircle/rounded masks, light and
dark.
- Only `assets/*.png` + `app.json` are committed: `/android` is gitignored and
its `res/` is generated, so `npx expo prebuild` (or `npm run icons`) is what
produces what the launcher actually renders.
- The launch screen uses `expo-splash-screen`: navy lockup on the app's cream
`#F5F0E6`, configured in `app.json`.

Requires Pillow (`python3 -m pip install pillow`) for the icon generator.

## Structure

```
src/            # Track 1: smartphone companion app (Expo)
  a11y/         # announcer, focus helpers
  components/   # AccessibleButton, AccessibleField, LanguageSwitcher
  constants/    # theme (WCAG 2.2 touch targets)
  i18n/         # config, storage, en/tw/ee locales
  screens/      # HomeScreen, SendMoneyScreen
  services/     # biometrics, speech, haptics, headphones, transactions (mock)
modules/
  audio-route/  # local Expo module: real AudioManager output-route detection
voice-line/     # Track 2: feature-phone IVR server (Node, zero deps) — see its README
  src/          # index, routes, twiml, prompts, session, voiceprints, momo
  smoke.mjs     # simulated end-to-end call (no phone or credentials needed)
```

## Android APK (on-device testing)

```bash
npm run apk    # builds the release APK and installs it on the connected phone
```

The toolchain is project-local in `.tools/` (gitignored, ~3.7GB: Temurin 17 JDK +
Android SDK/NDK), so nothing is installed system-wide. The script reconnects
wireless ADB by itself when the phone has slept, since its debugging port
rotates. First build ~46 min; incremental rebuilds ~6 min.

Icon, splash or `app.json` changes need a rebuild (`npm run apk`) — the APK
bundles its native resources, so hot reload cannot pick them up.

## Next steps (from the dev brief sprint plan)

1. Replace the mock `transactions` service with the Appwrite backend
   (users / transactions collections per §4.2).
2. Add `react-native-sms-retriever` + on-device MoMo SMS parsing (Android),
   statement narration screen.
3. Real MoMo sandbox integration via the shared backend.
4. Accessibility test passes with real screen-reader users (Day 4).

## Notes

- Language files are **draft translations** — get native-speaker review
  before the demo video (Day 5).
- iOS cannot parse SMS (per brief §2.6): plan receipt QR scanning instead.

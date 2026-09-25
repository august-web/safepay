# Accessibility audit — TalkBack pass/fail report (P4)

**Scope:** every screen — Home, Send Money, Withdraw (Cash Out), Buy
Airtime/Data, Transaction History (Statement), Settings, SMS Parser — plus
the global voice controls.

**Method:** code-level audit against the dev-brief pattern (label + role +
hint on every interactive element, focus and state-change announcements),
plus the repo's `react-native-a11y` ESLint rules, which fail the build on
violations. On-device TalkBack walkthrough steps are listed per screen; run
them once on the demo phone and tick the last column.

## Fixes made in this pass

| Issue | Where | Fix |
| --- | --- | --- |
| Emoji used AS the accessibility label — TalkBack read "left arrow", "speaker with three sound waves", "gear" | HeaderBar back ←, settings ⚙️; Statement ⏮️ ⏭️ 🔊; Home 🔊 | Real text label + hint; emoji demoted to visible child content |
| Statement filter chips selected via colour + slightly thicker border only | StatementScreen | ✓ prefix in label + 2.5pt border (also P5) |
| Balance in plain text in Send/Airtime/Withdraw headers | 3 screens | Shared `PrivateBalance` masked control (Polish 6) |
| Mic looked identical idle vs listening | MicButton (every screen) | Static 🎙️ idle, pulsing dot + danger variant while listening (Polish 10) |
| Language chips said "Beta" state nowhere | LanguageSwitcher | Ga/Pidgin labelled Beta with fallback hint (Polish 8) |

## Per-screen pass/fail

Legend: ✅ pass (verified in code + lint), 🔁 pass-in-code, re-verify live
during rehearsal (needs ears on a real phone).

### Global (HeaderBar on every screen)
- ✅ Back button: `accessibilityRole="button"`, label "Back" (localized),
  hint "Double-tap to return to the previous screen". Previously read "←".
- ✅ Settings gear: label "Open accessibility settings", hint "Double-tap to
  open contrast, language and voice settings". Previously read "⚙️".
- ✅ Secure badge: `accessibilityRole="text"` + label
  "SikaVoice · MTN MoMo Secure" (localized), hint present.
- ✅ Mic button: role button, dynamic label ("Voice command" /
  "Stop listening"), state-aware hint, pulsing visual state (10).
- 🔁 Live check: swipe order is Back → title → badge → mic.

### Home
- ✅ Balance amount: role text, label includes live value or masked dots;
  hint "Current mobile money balance".
- ✅ Show/Hide: role button, label flips Show/Hide, `announce()` fires
  "balance shown/hidden" on toggle (state change announced).
- ✅ Speak Balance: role button + localized hint; haptic amount pattern.
- ✅ Account holder name announced with label + hint (Polish 9).
- ✅ Action tiles (linear + spatial): role button, per-quadrant labels
  ("Quadrant 1 Top-Left: Send Money"), "Double-tap to open …" hints.
- ✅ Recent transaction rows: role text, full spoken sentence label
  (name, type, amount, status), listen hint; per-row 🔊 button now labelled
  "Listen: {name}" instead of an emoji.
- ✅ SMS banner: role button, combined label + hint.
- 🔁 Live check: navigating to Home announces greeting; balance reveal is
  announced, not just shown.

### Send Money
- ✅ Step indicator: role text, label states "Step 1 of 3: Details".
- ✅ Amount / Phone / Name fields: `AccessibleField` (label + hint +
  error announced via `announceError`, hapticError on validation failure).
- ✅ Fee preview: role text with computed fee/total in the label.
- ✅ Voice dictation card (new, P2): mic button labelled, live transcript
  preview visible AND focusable, state changes announced by haptic +
  spoken read-back after capture.
- ✅ Review screen: `useAnnounceOnFocus` announces the review heading on
  transition (focus moves); replay button re-speaks the read-back.
- ✅ Processing: 3-second cancel window announced ("Processing"); cancel
  button ≥48dp inside the countdown card.
- ✅ Result: success/failure announced via `announceSuccess`/`announceError`
  with reference number; role-header result title.
- 🔁 Live check: confirm triggers the biometric sheet; its system prompt is
  read by TalkBack (OS-handled).

### Withdraw (Cash Out)
- ✅ Header balance now masked behind PrivateBalance (was plain text).
- ✅ Agent code / agent name / amount fields: label + hint + numeric
  keyboards; errors announced.
- ✅ PIN warning card: role text within a labelled container.
- ✅ Review: read-back button re-speaks; confirm triggers biometrics;
  cancel window identical to Send Money.
- 🔁 Live check: confirm the masked header reads "Balance hidden" until
  double-tapped.

### Buy Airtime / Data
- ✅ Recipient + service selectors: `radiogroup` role with per-chip
  `accessibilityState.selected`; now ✓ + bold border on selection (P5).
- ✅ Quick-amount chips: same treatment; label "GH₵ 50".
- ✅ Voice dictation card (P2) as on Send Money.
- ✅ Review: read-back + biometric confirm; result announced.
- 🔁 Live check: toggling self/other moves focus predictably (the phone
  field appears only for "other").

### Transaction History (Statement)
- ✅ Money In/Out summary: role text, full value in label (independent of
  the visual +/- sign), hints.
- ✅ Player controls: ⏮/▶/⏭ now have real labels ("Previous transaction",
  "Play All"/"Pause", "Next transaction") + double-tap hints — were raw
  emoji before this audit.
- ✅ Filter chips: `radiogroup` + selected state + ✓ (P5).
- ✅ Each row: full spoken-sentence label; per-row listen button labelled
  with the recipient name.
- ✅ Playback state changes announced ("Now reading 2 of 5"; completion
  announced when the narration finishes).
- 🔁 Live check: Play All advances by real completion callbacks; verify no
  double-speak with TalkBack on.

### Settings
- ✅ Navigation preset, speech rate, privacy mode, contrast: all
  `radiogroup`-wrapped with per-option `accessibilityState.selected`, ✓ +
  bold border on the selected option (P5).
- ✅ Always-listen switch: `accessibilityLabel` + hint on the Switch.
- ✅ Language switcher: `radiogroup`, ✓ + gold fill on selection, Beta
  labels for Ga/Pidgin (Polish 8).
- ✅ Voice output check section announces the active channel (screen reader
  vs app voice), audio route, locale, clip count.
- 🔁 Live check: toggling contrast re-renders and re-announces the choice.

## Rubric mapping

- **Communication Support & Two-Way Interaction (20 pts):** every icon-only
  control speaks its purpose; state changes (balance reveal, confirmation,
  processing, playback position) are announced, not just animated.
- **Accessibility & Inclusion (20 pts):** WCAG 2.2 non-colour selection
  states everywhere; masking consistent on every balance surface; TalkBack
  labels/hints follow the dev-brief "Double-tap to …" pattern verbatim.
- **Technical Fit (20 pts):** `react-native-a11y` lint rules pass with zero
  errors, so the audit is enforced by CI, not by goodwill.

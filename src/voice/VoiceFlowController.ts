import { getAppLanguage, i18n, type AppLanguage } from '../i18n';
import { announce } from '../a11y/announcer';
import * as LocalAuthentication from 'expo-local-authentication';
import { formatMoney, sendMoney, buyAirtime, cashOut, calculateFee } from '../services/transactions';
import {
  sayKey,
  sayKeyAsync,
  sayPlan,
  playPlan,
  canSpeakPlan,
  nameClipKey,
  type SayPlan,
} from './say';
import { hasVoiceClip, isSelfVoiceAudible } from './voicePack';
import { extractAmount, isStopUtterance } from './commands';
import { phoneClipKeys } from './commandText';
import { parseRecipient, parseYesNo, extractDigitSequence } from './flowParse';
import { requestContactsPermission, lookupContacts } from '../services/contacts';
import { parseSpokenChoice, type ContactCandidate } from '../services/contactMatch';

/**
 * Conversational voice flows.
 *
 * A blind user says "send money" - the app then ASKS, out loud, in the user's
 * language: who, how much, which phone number - and reads everything back for
 * confirmation before touching the money. The user answers by speaking; no
 * screen interaction is required anywhere in the flow.
 *
 * Design rules:
 *  - Every prompt is spoken at the next quiet moment (never over our own
 *    voice), and the provider's echo guards drop the recogniser's transcript
 *    of our own prompts.
 *  - Every question is re-asked after an unparseable answer - the flow never
 *    dead-ends in silence.
 *  - Saying "stop / cancel" at any point ends the flow and says so.
 *  - The mic stays open the whole time; the flow is driven purely from
 *    `handleTranscript`.
 */

export type VoiceFlow =
  | { kind: 'send' }
  | { kind: 'airtime'; self: boolean }
  | { kind: 'cashout' };

type FlowRecipient = { name: string | null; phone: string };

type FlowState =
  | { step: 'recipient' }
  /** A named contact whose number must be confirmed before the amount. */
  | { step: 'contact'; recipient: FlowRecipient }
  /** Device-contacts lookup in flight for a spoken name (Phase 3). */
  | { step: 'lookup'; spokenName: string }
  /** Several candidates matched the spoken name; the user must choose one. */
  | { step: 'disambiguate'; spokenName: string; candidates: ContactCandidate[] }
  /** One candidate found or chosen: name + number read back for a yes/no. */
  | { step: 'recipientConfirm'; spokenName: string; candidate: ContactCandidate }
  /** The user is dictating an optional reference / narration. */
  | { step: 'reference'; recipient: FlowRecipient; amount: number; reference: string | null }
  | { step: 'amount'; recipient: FlowRecipient; reference: string | null }
  | { step: 'confirm'; recipient: FlowRecipient; amount: number; reference: string | null }
  | { step: 'processing'; recipient: FlowRecipient; amount: number };

/** A step transition, mirrored to the on-screen conversation HUD. */
export type VoiceTranscriptEntry = {
  speaker: 'app' | 'user';
  text: string;
};

export interface VoiceFlowStatus {
  /** Localized text of the question or confirmation being asked. */
  prompt: string;
  /** Localized narration of the last accepted answer, when one exists. */
  heard: string | null;
  /** Index of the current step, 1-based, for "Step 2 of 5" announcements. */
  step: number;
  /** Total steps the current flow expects. */
  of: number;
  /** Recent spoken questions and recognized answers. */
  transcript: VoiceTranscriptEntry[];
}

export interface VoiceFlowDeps {
  /** Navigates the app shell to the matching screen. */
  navigate: (screen: 'send' | 'airtime' | 'cashout') => void;
  /** Ends the flow (called on completion, cancellation and fatal errors). */
  onDone: () => void;
  /** Receives every prompt/answer pair for the visible conversation HUD. */
  onStatus?: (status: VoiceFlowStatus | null) => void;
}

/** Steps each flow walks through, for the HUD's "step n of m" line. */
const FLOW_TOTAL_STEPS: Record<VoiceFlow['kind'], number> = {
  send: 6,
  airtime: 4,
  cashout: 5,
};

/** Biometric confirm per transaction, per the dev brief (never a spoken PIN). */
async function confirmWithBiometrics(): Promise<'confirmed' | 'voice' | 'failed' | 'unavailable'> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !enrolled) return 'unavailable';
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Confirm transaction',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return result.success ? 'confirmed' : 'failed';
  } catch {
    return 'unavailable';
  }
}

/** Lowercase a-z only; local stand-in for commands.ts `fold`. */
function foldText(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, ' ').replace(/\s+/g, ' ').trim();
}

export class VoiceFlowController {
  private flow: VoiceFlow | null = null;
  private state: FlowState | null = null;
  /** Set when the user answered "someone else" and must say a number next. */
  private awaiting: 'phone' | null = null;
  /** Human-friendly name of the last accepted answer, for the HUD. */
  private lastHeard: string | null = null;
  private transcript: VoiceTranscriptEntry[] = [];
  private lastPrompt: string | null = null;
  private lang: AppLanguage = getAppLanguage();
  /**
   * Tri-state for Phase 3 contact lookup: null = not tried yet, true = device
   * address book is usable, false = denied/unavailable this session, so a
   * spoken name falls straight through to the manual-number path. Contacts
   * are never re-prompted mid-flow after a refusal.
   */
  private contactsEnabled: boolean | null = null;

  constructor(private readonly deps: VoiceFlowDeps) {}

  isActive(): boolean {
    return this.flow != null;
  }

  /** 1-based index of the current step, or 0 with no flow. */
  currentStepNumber(): number {
    const kind = this.flow?.kind;
    switch (this.state?.step) {
      case 'recipient': return 1;
      case 'lookup': return 1;
      case 'contact': return 2;
      case 'disambiguate': return 2;
      case 'recipientConfirm': return 3;
      case 'amount': return kind === 'send' ? 4 : 3;
      /** Send-only narration step. */
      case 'reference': return 5;
      case 'confirm': return kind === 'send' ? 5 : 4;
      case 'processing': return kind === 'send' ? 6 : 5;
      default: return 0;
    }
  }

  private emitStatus(promptKey: string): void {
    if (this.deps.onStatus == null || this.flow == null) return;
    const prompt = String(i18n.t(promptKey));
    const lastEntry = this.transcript[this.transcript.length - 1];
    if (this.lastHeard != null && (lastEntry?.speaker !== 'user' || lastEntry.text !== this.lastHeard)) {
      this.transcript.push({ speaker: 'user', text: this.lastHeard });
    }
    if (this.lastPrompt !== prompt) {
      this.transcript.push({ speaker: 'app', text: prompt });
      this.lastPrompt = prompt;
    }
    this.deps.onStatus({
      prompt,
      heard: this.lastHeard,
      step: this.currentStepNumber(),
      of: FLOW_TOTAL_STEPS[this.flow.kind],
      transcript: this.transcript.slice(-10),
    });
  }

  /**
   * Starts a flow: navigates, announces the feature, asks the first question.
   */
  start(flow: VoiceFlow): void {
    this.reset();
    this.flow = flow;
    this.lang = getAppLanguage();

    switch (flow.kind) {
      case 'send':
        this.state = { step: 'recipient' };
        this.deps.navigate('send');
        sayKey('home.sendMoney');
        this.emitStatus('vcmd.whoToPay');
        this.speakThen('vcmd.whoToPay');
        return;
      case 'airtime':
        this.state = { step: 'recipient' };
        this.deps.navigate('airtime');
        sayKey('home.buyAirtime');
        this.emitStatus('vcmd.selfOrOther');
        this.speakThen('vcmd.selfOrOther');
        return;
      case 'cashout':
        this.state = { step: 'recipient' };
        this.deps.navigate('cashout');
        sayKey('home.cashOut');
        this.emitStatus('vcmd.agentQuestion');
        this.speakThen('vcmd.agentQuestion');
        return;
    }
  }

  /**
   * Feeds a final transcript into the active flow.
   *
   * @returns true when the transcript was consumed by the flow; false when
   *   there is no flow and normal command handling should proceed.
   */
  handleTranscript(transcript: string): boolean {
    // No suspension gate here on purpose: a blanket mute after every prompt
    // ate real answers in rehearsal ("Ama" spoken 0.7 s after "Who are you
    // sending to?" was swallowed, and the app asked "didn't catch that").
    // Echo of our own prompts is handled by the provider's content-based
    // guards instead, which spare real answers.
    if (this.flow == null) return false;

    // "Stop / cancel" always wins, in any step, in any language - but only on
    // an exact phrase match. The fuzzy layer maps "skip" and "nope" to stop,
    // which cancelled real transfers during rehearsal, so flows use the exact
    // list while the always-on command layer keeps fuzzy tolerance.
    if (isStopUtterance(transcript)) {
      this.cancel(false);
      return true;
    }

    // Keep the latest answer available to the transcript view, including
    // answers that need to be re-asked because they were not parseable.
    this.lastHeard = transcript.trim();

    switch (this.state?.step) {
      case 'recipient':
        this.handleRecipient(transcript);
        return true;
      case 'lookup':
        // The address book is still answering; a beat of speech here is
        // absorbed so it cannot land on the next step by surprise.
        return true;
      case 'contact':
        this.handleContact(transcript);
        return true;
      case 'disambiguate':
        this.handleDisambiguate(transcript);
        return true;
      case 'recipientConfirm':
        this.handleRecipientConfirm(transcript);
        return true;
      case 'reference':
        this.handleReference(transcript);
        return true;
      case 'amount':
        this.handleAmount(transcript);
        return true;
      case 'confirm':
        this.handleConfirmation(transcript);
        return true;
      default:
        return false;
    }
  }

  private handleRecipient(transcript: string): void {
    const flow = this.flow;
    if (flow == null) return;

    if (flow.kind === 'airtime' && this.awaiting == null) {
      // The answer is "myself" or "someone else", not a name.
      const text = transcript.toLowerCase();
      if (/\b(self|myself|me|mine|my line|for me)\b/.test(text) || /woara|me nkoa|nye nye/.test(text)) {
        // Demo: the user's own line.
        this.advanceAirtime({ name: 'Self', phone: '0241234567' });
        return;
      }
      if (/\b(other|someone else|another|for someone)\b/.test(text) || /obi fofor|ame bubu/.test(text)) {
        this.awaiting = 'phone';
        this.speakThen('vcmd.askPhone');
        return;
      }
      // Maybe they skipped ahead and said a number directly.
      const phone = extractDigitSequence(transcript, 9);
      if (phone != null) {
        this.advanceAirtime({ name: null, phone });
        return;
      }
      this.speakThen('vcmd.selfOrOther');
      return;
    }

    if (this.awaiting === 'phone') {
      const digits = extractDigitSequence(transcript, 9);
      if (digits == null) {
        this.emitStatus('vcmd.askPhone');
        this.speakThen('vcmd.askPhone');
        return;
      }
      this.awaiting = null;
      const local = digits.length > 10 ? `0${digits.slice(-9)}` : digits;
      if (flow.kind === 'send') {
        this.state = { step: 'amount', recipient: { name: null, phone: local }, reference: null };
        this.lastHeard = local;
        this.emitStatus('vcmd.askAmount');
        this.speakThen('vcmd.askAmount');
      } else {
        this.advanceAirtime({ name: null, phone: local });
      }
      return;
    }

    // Phase 3: a spoken name in the send flow is looked up in the device's
    // own address book - entirely on-device, never uploaded. Numbers skip the
    // lookup (the digits are the recipient), and the demo-wallet matcher
    // below remains the fallback when contacts are denied or unavailable, so
    // a missing contacts module can never dead-end a transfer.
    if (flow.kind === 'send' && this.awaiting == null && this.contactsEnabled !== false) {
      if (extractDigitSequence(transcript, 9) == null) {
        const spokenName = transcript.trim();
        this.state = { step: 'lookup', spokenName };
        this.emitStatus('vcmd.contactLooking');
        this.speakThen('vcmd.contactLooking');
        void this.lookupRecipient(spokenName);
        return;
      }
    }

    // Send / cashout first step: recipient by name or number.
    if (flow.kind === 'cashout') {
      // Agent codes are short; accept any digit sequence of 3+.
      const digits = extractDigitSequence(transcript, 3);
      if (digits == null) {
        this.emitStatus('vcmd.agentQuestion');
        this.speakThen('vcmd.agentQuestion');
        return;
      }
      this.state = { step: 'amount', recipient: { name: null, phone: digits }, reference: null };
      this.lastHeard = digits;
      this.emitStatus('vcmd.askAmount');
      this.speakThen('vcmd.askAmount');
      return;
    }

    const recipient = parseRecipient(transcript);
    if (recipient == null) {
      this.emitStatus('vcmd.whoToPay');
      this.speakThen('vcmd.whoToPay');
      return;
    }
    if (recipient.name == null) {
      // Paid by number straight away - no confirmation step needed.
      this.state = { step: 'amount', recipient, reference: null };
      this.lastHeard = recipient.phone;
      this.emitStatus('vcmd.askAmount');
      this.speakThen('vcmd.askAmount');
      return;
    }
    // A named contact: the demo wallet stores one number per name, so the
    // number must be spoken and confirmed before any amount is asked (the
    // single greatest source of mis-sent money).
    this.state = { step: 'contact', recipient };
    this.lastHeard = recipient.name;
    this.emitStatus('vcmd.contactNumber');
    this.speakThen('vcmd.contactNumber');
  }

  /** The contact-number confirmation step (only reached for named contacts). */
  private handleContact(transcript: string): void {
    const state = this.state;
    if (state?.step !== 'contact') return;

    const digits = extractDigitSequence(transcript, 9);
    if (digits == null) {
      this.emitStatus('vcmd.contactNumber');
      this.speakThen('vcmd.contactNumber');
      return;
    }
    const local = digits.length > 10 ? `0${digits.slice(-9)}` : digits;
    const confirmed: FlowRecipient = { name: state.recipient.name, phone: local };
    this.state = { step: 'amount', recipient: confirmed, reference: null };
    this.lastHeard = `${state.recipient.name} ${local}`;
    this.emitStatus('vcmd.askAmount');
    this.speakThen('vcmd.askAmount');
  }

  /**
   * Phase 3: resolves a spoken name against the device address book.
   *
   * The OS permission is requested here — the moment the flow actually needs
   * it, not at launch. A refusal is answered honestly and the flow drops to
   * the manual-number path; a miss does the same; one match reads the name
   * and number back for a yes/no; several matches are numbered and read out
   * one per phone number, because the number is what actually receives the
   * money. Ambiguity is never resolved silently.
   */
  private async lookupRecipient(spokenName: string): Promise<void> {
    const permission = await requestContactsPermission();
    if (this.state?.step !== 'lookup' || this.flow?.kind !== 'send') return;

    if (permission !== 'granted') {
      this.contactsEnabled = false;
      this.state = { step: 'contact', recipient: { name: spokenName, phone: '' } };
      this.emitStatus('vcmd.contactDenied');
      this.speakPlanNative(
        [
          { kind: 'key', key: 'vcmd.contactDenied' },
          { kind: 'key', key: 'vcmd.contactNumber' },
        ],
        `${i18n.t('vcmd.contactDenied')} ${i18n.t('vcmd.contactNumber')}`,
      );
      return;
    }

    let candidates: ContactCandidate[] = [];
    try {
      candidates = await lookupContacts(spokenName);
    } catch {
      candidates = [];
    }
    if (this.state?.step !== 'lookup' || this.flow?.kind !== 'send') return;

    if (candidates.length === 0) {
      // Honest miss: the name stays on the HUD, the fixed line re-asks for
      // the number, and the flow keeps moving.
      this.contactsEnabled = true;
      this.state = { step: 'contact', recipient: { name: spokenName, phone: '' } };
      this.emitStatus('vcmd.contactNotFoundFixed');
      this.speakPlanNative(
        [
          { kind: 'key', key: 'vcmd.contactNotFoundFixed' },
          { kind: 'key', key: 'vcmd.contactNumber' },
        ],
        `${i18n.t('vcmd.contactNotFoundFixed')} ${i18n.t('vcmd.contactNumber')}`,
      );
      return;
    }

    if (candidates.length === 1) {
      this.askRecipientConfirm(spokenName, candidates[0]);
      return;
    }

    this.state = { step: 'disambiguate', spokenName, candidates };
    const parts: SayPlan = [
      { kind: 'key', key: 'vcmd.contactMany' },
      { kind: 'key', key: 'vcmd.contactPick' },
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      parts.push({ kind: 'number', value: index + 1 });
      parts.push({ kind: 'phone', phone: candidates[index].phone });
    }
    const spokenText = [
      i18n.t('vcmd.contactMany'),
      i18n.t('vcmd.contactPick'),
      ...candidates.map((candidate, index) => `${index + 1}. ${candidate.name} ${candidate.phone}`),
    ].join(' ');
    this.emitStatus('vcmd.contactMany');
    this.speakPlanNative(parts, spokenText);
  }

  /** The disambiguation step: "1", "two", "second", "mmienu", "eve"… */
  private handleDisambiguate(transcript: string): void {
    const state = this.state;
    if (state?.step !== 'disambiguate') return;
    const choice = parseSpokenChoice(transcript, state.candidates.length);
    if (choice == null) {
      // Re-ask, never dead-end: the choice list stays on the HUD too.
      this.emitStatus('vcmd.contactPick');
      this.speakThen('vcmd.contactPick');
      return;
    }
    this.askRecipientConfirm(state.spokenName, state.candidates[choice - 1]);
  }

  /**
   * Read-back before any amount is asked (build-plan rule): the chosen name
   * and number are spoken, and a yes is required. The number is always
   * spoken natively digit by digit — it is the truth that receives the money.
   * The name joins when a recorded clip for it exists (demo names);
   * otherwise it stays on the HUD rather than being read by an
   * English-accented device voice.
   */
  private askRecipientConfirm(spokenName: string, candidate: ContactCandidate): void {
    this.state = { step: 'recipientConfirm', spokenName, candidate };
    this.lastHeard = `${candidate.name} ${candidate.phone}`;

    const language = getAppLanguage();
    const parts: SayPlan = [{ kind: 'key', key: 'vcmd.confirmSend' }];
    if (hasVoiceClip(nameClipKey(candidate.name), language)) {
      parts.push({ kind: 'name', name: candidate.name });
    }
    parts.push(
      { kind: 'key', key: 'vcmd.confirmTo' },
      { kind: 'phone', phone: candidate.phone },
      { kind: 'key', key: 'vcmd.sayYesNo' },
    );
    const spokenText = [
      i18n.t('vcmd.confirmSend'),
      candidate.name,
      i18n.t('vcmd.confirmTo'),
      candidate.phone,
      i18n.t('vcmd.sayYesNo'),
    ].join(' ');
    this.emitStatus('vcmd.recipientCheck');
    this.speakPlanNative(parts, spokenText);
  }

  /** The recipient confirmation step: yes proceeds to the amount, no re-asks. */
  private handleRecipientConfirm(transcript: string): void {
    const state = this.state;
    if (state?.step !== 'recipientConfirm') return;
    const answer = parseYesNo(transcript);
    if (answer == null) {
      this.emitStatus('vcmd.recipientCheck');
      this.speakThen('vcmd.recipientCheck');
      return;
    }
    if (answer === 'no') {
      this.state = { step: 'recipient' };
      this.lastHeard = null;
      this.emitStatus('vcmd.whoToPay');
      this.speakThen('vcmd.whoToPay');
      return;
    }
    this.state = {
      step: 'amount',
      recipient: { name: state.candidate.name, phone: state.candidate.phone },
      reference: null,
    };
    this.emitStatus('vcmd.askAmount');
    this.speakThen('vcmd.askAmount');
  }

  /**
   * speakThen for a composed plan: native clip playback when every part has
   * one, otherwise the announce fallback for languages without a native pack
   * (Twi/Ewe deliberately stay silent without clips — never the
   * English-accented device voice reading native orthography).
   */
  private speakPlanNative(parts: SayPlan, fallbackText: string): void {
    const go = () => {
      const language = getAppLanguage();
      if (canSpeakPlan(parts, language)) {
        void playPlan(parts, language);
        return;
      }
      if (language !== 'tw' && language !== 'ee') {
        announce(fallbackText);
      }
    };
    const wait = () => {
      if (!isSelfVoiceAudible()) {
        go();
        return;
      }
      setTimeout(wait, 150);
    };
    setTimeout(wait, 250);
  }

  /** The optional reference / narration step. "Skip" jumps past it. */
  private handleReference(transcript: string): void {
    const state = this.state;
    if (state?.step !== 'reference') return;

    const text = transcript.trim();
    const skipped = text.length === 0 || /^(skip|none|no(ne)?|next|gyae|to|dzo)\.?$/.test(foldText(text));
    const reference = skipped ? null : text.slice(0, 60);
    this.state = {
      step: 'confirm',
      recipient: state.recipient,
      amount: state.amount,
      reference,
    };
    this.lastHeard = reference;
    this.askConfirm(state.amount);
  }

  private handleAmount(transcript: string): void {
    const state = this.state;
    if (state?.step !== 'amount') return;

    const amount = extractAmount(transcript);
    if (amount == null || amount <= 0) {
      this.emitStatus('vcmd.askAmount');
      this.speakThen('vcmd.askAmount');
      return;
    }
    // Send-money only: an optional spoken reference, skippable.
    if (this.flow?.kind === 'send') {
      this.state = {
        step: 'reference',
        recipient: state.recipient,
        amount,
        reference: state.reference,
      };
      this.lastHeard = String(amount);
      this.emitStatus('vcmd.askReference');
      this.speakThen('vcmd.askReference');
      return;
    }
    this.state = {
      step: 'confirm',
      recipient: state.recipient,
      amount,
      reference: state.reference,
    };
    this.lastHeard = String(amount);
    this.askConfirm(amount);
  }

  /** Spoken read-back of the whole transaction, then the yes/no question. */
  private askConfirm(amount: number): void {
    const state = this.state;
    if (state?.step !== 'confirm') return;
    const fee = calculateFee(amount);
    this.state = {
      step: 'confirm',
      recipient: state.recipient,
      amount: state.amount,
      reference: state.reference,
    };

    const readBack = [
      i18n.t('vcmd.confirmSend'),
      formatMoney(state.amount),
      i18n.t('vcmd.confirmTo'),
      state.recipient.name ?? state.recipient.phone,
      `.${i18n.t('vcmd.feeIs')} ${formatMoney(fee)}. ${i18n.t('vcmd.totalIs')} ${formatMoney(state.amount + fee)}.`,
      i18n.t('vcmd.sayYesNo'),
    ].join(' ');

    void (async () => {
      try {
        const parts: SayPlan = [
          { kind: 'key', key: 'vcmd.confirmSend' },
          { kind: 'money', amount: state.amount },
          { kind: 'key', key: 'vcmd.confirmTo' },
          state.recipient.name != null
            ? { kind: 'name', name: state.recipient.name }
            : { kind: 'phone', phone: state.recipient.phone },
          { kind: 'key', key: 'vcmd.feeIs' },
          { kind: 'money', amount: fee },
          { kind: 'key', key: 'vcmd.totalIs' },
          { kind: 'money', amount: state.amount + fee },
          { kind: 'key', key: 'vcmd.sayYesNo' },
        ];
        sayPlan(parts, { language: this.lang, fallback: () => announce(readBack) });
      } catch {
        // Playback is best-effort; the confirm state is already set.
      }
    })();
    this.emitStatus('vcmd.confirmSend');
  }

  private handleConfirmation(transcript: string): void {
    const answer = parseYesNo(transcript);
    if (answer == null) {
      this.emitStatus('vcmd.sayYesNo');
      this.speakThen('vcmd.sayYesNo');
      return;
    }
    if (answer === 'no') {
      this.cancel(false);
      return;
    }
    void this.execute();
  }

  private advanceAirtime(recipient: FlowRecipient): void {
    this.state = { step: 'amount', recipient, reference: null };
    this.emitStatus('vcmd.askAmount');
    this.speakThen('vcmd.askAmount');
  }

  /** Runs the mock transaction and announces the result natively. */
  private async execute(): Promise<void> {
    const state = this.state;
    const flow = this.flow;
    if (state?.step !== 'confirm' || flow == null) return;
    this.state = { step: 'processing', recipient: state.recipient, amount: state.amount };

    const auth = await confirmWithBiometrics();
    if (auth === 'failed') {
      sayKey('send.authFailed');
      this.reset();
      return;
    }
    if (auth === 'unavailable') {
      // Demo path: no fingerprint enrolled - the yes/no just given IS the
      // authorisation. Say so, once, honestly.
      sayKey('vcmd.noBiometrics');
    }

    try {
      let result;
      if (flow.kind === 'send') {
        result = await sendMoney({
          amount: state.amount,
          fee: calculateFee(state.amount),
          recipientPhone: state.recipient.phone,
          recipientName: state.recipient.name ?? 'Voice recipient',
          reference: state.reference ?? undefined,
        });
      } else if (flow.kind === 'airtime') {
        result = await buyAirtime({
          amount: state.amount,
          recipientPhone: state.recipient.phone,
          recipientName: state.recipient.name ?? 'Airtime',
        });
      } else {
        result = await cashOut({
          amount: state.amount,
          agentCode: state.recipient.phone,
          agentName: state.recipient.name ?? 'Agent',
          fee: calculateFee(state.amount),
        });
      }

      if (result.status === 'confirmed') {
        await this.announceCompletion(result.transaction?.reference ?? '');
      } else {
        sayKey(result.reason === 'insufficient_funds' ? 'send.failureFunds' : 'send.failureNetwork');
      }
    } catch {
      sayKey('send.failureGeneric');
    } finally {
      this.reset();
      this.deps.onDone();
    }
  }

  /** Completion: native clip + reference digits where clips exist. */
  private async announceCompletion(reference: string): Promise<void> {
    const digits = reference.match(/(\d+)\s*$/)?.[1] ?? '';
    const parts: SayPlan = [
      { kind: 'key', key: 'vcmd.transactionComplete' },
      { kind: 'key', key: 'vcmd.reference' },
      ...phoneClipKeys(digits).map((key) => ({ kind: 'key' as const, key })),
    ];
    sayPlan(parts, {
      language: this.lang,
      fallback: () =>
        announce(
          `${i18n.t('vcmd.transactionComplete')}. ${i18n.t('vcmd.reference')} ${reference}`,
        ),
    });
  }

  /** Ends the flow, optionally announcing the cancellation. */
  cancel(silent: boolean): void {
    const wasActive = this.flow != null;
    this.reset();
    if (wasActive && !silent) {
      sayKey('vcmd.flowCancelled');
    }
    if (wasActive) {
      this.deps.onStatus?.(null);
      this.deps.onDone();
    }
  }

  private reset(): void {
    this.flow = null;
    this.state = null;
    this.awaiting = null;
    this.lastHeard = null;
    this.transcript = [];
    this.lastPrompt = null;
  }

  /**
   * Speaks a prompt at the next quiet moment (never over our own voice).
   * No transcript gating: the provider's content-based echo guards drop what
   * the mic hears of this prompt without eating a real answer spoken over it.
   */
  private speakThen(key: string): void {
    const go = () => {
      void sayKeyAsync(key).catch(() => false);
      // Device-TTS languages (English, Pidgin, Ga) still hear the prompt when
      // no clip exists. Twi/Ewe deliberately stay silent without a clip -
      // never the English-accented voice reading native orthography.
      const language = getAppLanguage();
      if (language !== 'tw' && language !== 'ee') {
        announce(i18n.t(key));
      }
    };
    const wait = () => {
      if (!isSelfVoiceAudible()) {
        go();
        return;
      }
      setTimeout(wait, 150);
    };
    setTimeout(wait, 250);
  }
}

import { getAppLanguage } from '../i18n';
import type { Transaction } from '../services/transactions';
import { canSpeakPlan, sayPlan, type SayPlan } from './say';

/**
 * One spoken shape for "here is what happened to your money": receipts and MoMo
 * alerts both read the same facts, so both compose from the same clips.
 *
 * The plans come back widest first. A party name with no clip, or an amount out
 * of the number-pack range, would otherwise fail the whole sentence and leave
 * the user in silence, so each rung of the ladder drops one optional part rather
 * than the lot. The caller's fallback (translated text) only runs when no rung
 * composes at all.
 */
export interface MoneySpeech {
  /** Said first: `vcmd.transactionComplete`, or `sms.sayNew` for an alert. */
  introKey: string;
  /** Direction frame: "Sent to", "Cash out at", ... */
  directionKey: string;
  transaction: Transaction;
  /** Balance after the transaction, read as the closing figure. */
  balance: number;
}

export function moneyPlans(speech: MoneySpeech): SayPlan[] {
  const { transaction: tx, balance } = speech;
  const head: SayPlan = [
    { kind: 'key', key: speech.introKey },
    { kind: 'key', key: speech.directionKey },
  ];
  const tail: SayPlan = [
    { kind: 'money', amount: tx.amount },
    ...(tx.fee > 0
      ? [
          { kind: 'key' as const, key: 'vcmd.feeIs' },
          { kind: 'money' as const, amount: tx.fee },
        ]
      : []),
    { kind: 'key', key: 'vcmd.balanceIs' },
    { kind: 'money', amount: balance },
  ];
  const reference: SayPlan = [
    { kind: 'key', key: 'vcmd.reference' },
    { kind: 'digits', value: tx.reference },
  ];

  return [
    [
      ...head,
      { kind: 'name', name: tx.recipientName },
      ...tail,
      ...reference,
    ],
    [
      ...head,
      { kind: 'phone', phone: tx.recipientPhone },
      ...tail,
      ...reference,
    ],
    [...head, ...tail, ...reference],
    [...head, ...tail],
  ];
}

/** Speaks the widest plan this language can compose, or the caller's fallback. */
export function sayMoneyTransaction(
  speech: MoneySpeech,
  options: { fallback: () => void; onDone?: () => void },
): void {
  const language = getAppLanguage();
  const plan = moneyPlans(speech)
    .find((candidate) => canSpeakPlan(candidate, language));
  if (plan == null) {
    options.fallback();
    options.onDone?.();
    return;
  }
  sayPlan(plan, {
    language,
    fallback: options.fallback,
    onDone: options.onDone,
  });
}

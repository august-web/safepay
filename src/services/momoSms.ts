import AsyncStorage from '@react-native-async-storage/async-storage';

import { i18n } from '../i18n';
import { formatMoney, type Transaction } from './transactions';

/**
 * The simulated MTN MoMo alert inbox.
 *
 * A Ghanaian MoMo user keeps a second record of every transaction in their SMS
 * thread, and a blind user cannot read that thread with TalkBack over it. These
 * alerts are the same messages, built locally from the transaction that just
 * happened, in the language the app is set to - so the statement and the SMS
 * thread tell one story. Nothing here touches the device's real SMS store, and
 * no SMS permission is requested.
 */

const STORAGE_KEY = 'sikavoice.momoSms';
const MAX_ALERTS = 30;

export interface MoMoAlert {
  id: string;
  createdAt: number;
  content: string;
  transaction: Transaction;
  /** Balance the message reports, which is the wallet total after it landed. */
  balance: number;
  read: boolean;
}

let alerts: MoMoAlert[] | null = null;
/**
 * The alert whose banner has not been shown yet. Home takes it when it mounts,
 * which is exactly when a receipt has finished reading - so an alert never
 * interrupts a receipt that is still speaking.
 */
let pendingBanner: MoMoAlert | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeSms(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persist(value: MoMoAlert[]): void {
  try {
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Demo state only; an unreadable store must never break a transaction.
  }
}

export async function listAlerts(): Promise<MoMoAlert[]> {
  if (alerts != null) return alerts;
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored != null) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        alerts = parsed as MoMoAlert[];
        return alerts;
      }
    }
  } catch {
    // Fall through to an empty inbox.
  }
  alerts = [];
  return alerts;
}

function templateKey(type: Transaction['type']): string {
  if (type === 'receive') return 'sms.template.received';
  if (type === 'airtime') return 'sms.template.airtime';
  if (type === 'withdraw') return 'sms.template.cashOut';
  return 'sms.template.sent';
}

/** The message body, in the language the app is set to, in MTN's own shape. */
export function alertContent(transaction: Transaction, balance: number): string {
  return i18n.t(templateKey(transaction.type), {
    amount: formatMoney(transaction.amount),
    party: transaction.recipientName,
    phone: transaction.recipientPhone,
    fee: formatMoney(transaction.fee),
    balance: formatMoney(balance),
    reference: transaction.reference,
  });
}

/**
 * Records the alert for a completed transaction. Called at completion, but the
 * banner only surfaces once Home is back and takes it - see `takePendingBanner`.
 */
export async function recordTransactionAlert(
  transaction: Transaction,
  balance: number,
): Promise<MoMoAlert> {
  const alert: MoMoAlert = {
    id: `sms-${transaction.id}`,
    createdAt: Date.now(),
    content: alertContent(transaction, balance),
    transaction,
    balance,
    read: false,
  };
  const current = await listAlerts();
  alerts = [alert, ...current].slice(0, MAX_ALERTS);
  pendingBanner = alert;
  persist(alerts);
  emit();
  return alert;
}

/** The un-shown alert, once. Home calls this when it mounts. */
export function takePendingBanner(): MoMoAlert | null {
  const alert = pendingBanner;
  pendingBanner = null;
  return alert;
}

export async function unreadCount(): Promise<number> {
  return (await listAlerts()).filter((alert) => !alert.read).length;
}

export async function markAlertsRead(): Promise<void> {
  const current = await listAlerts();
  if (!current.some((alert) => !alert.read)) return;
  alerts = current.map((alert) => ({ ...alert, read: true }));
  persist(alerts);
  emit();
}

/** A short figure for the banner: "GH₵ 50.00 from Ama Serwaa" arrives as "GH₵ 50.00". */
export function alertSummary(alert: MoMoAlert): string {
  return formatMoney(alert.transaction.amount);
}

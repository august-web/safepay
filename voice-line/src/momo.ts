/**
 * Mock MoMo ledger for the Voice Line. Mirrors the Track 1 app's mock
 * (`../src/services/transactions.ts`): 1% fee capped at GHS 10, same
 * transaction shape (plus `initiatedVia: 'voice'`, per the brief's shared
 * `transactions` schema). Intentionally DETERMINISTIC — unlike the app
 * mock's 15% random failure — so the IVR demo script and smoke test behave
 * the same on every run. Replace with the real MoMo API via the shared
 * backend when integrating (§4.2 / README "Next steps").
 */

export type LedgerTransactionType = 'send' | 'receive' | 'airtime';
export type LedgerTransactionStatus = 'confirmed' | 'failed';

export interface LedgerTransaction {
  id: string;
  type: LedgerTransactionType;
  amount: number;
  currency: 'GHS';
  recipientPhone: string;
  recipientName: string;
  fee: number;
  reference: string;
  status: LedgerTransactionStatus;
  initiatedVia: 'voice';
  readAloud: boolean;
  createdAt: number;
}

export interface LedgerUser {
  caller: string;
  name: string;
  balance: number;
}

export const FEE_RATE = 0.01;
export const FEE_CAP = 10;
const STARTING_BALANCE = 1200;

export function calculateFee(amount: number): number {
  return Math.min(Math.round(amount * FEE_RATE * 100) / 100, FEE_CAP);
}

export interface SendParams {
  caller: string;
  amount: number;
  recipientPhone: string;
}

export interface SendOutcome {
  status: 'confirmed' | 'failed';
  transaction?: LedgerTransaction;
  reason?: 'insufficient_funds';
}

export class MockLedger {
  private readonly users = new Map<string, LedgerUser>();
  private readonly transactions = new Map<string, LedgerTransaction[]>();
  private referenceCounter = 0;

  constructor() {
    // Demo user shared with the Track 1 app's demo data.
    this.users.set('+233241234567', { caller: '+233241234567', name: 'Kwame Mensah', balance: 1200 });
    this.transactions.set('+233241234567', [
      {
        id: 'demo-voice-1',
        type: 'receive',
        amount: 500,
        currency: 'GHS',
        recipientPhone: '+233241234567',
        recipientName: 'Kwame Mensah',
        fee: 0,
        reference: 'MOCK-RCV-0001',
        status: 'confirmed',
        initiatedVia: 'voice',
        readAloud: true,
        createdAt: Date.now() - 1000 * 60 * 60 * 26,
      },
      {
        id: 'demo-voice-2',
        type: 'send',
        amount: 50,
        currency: 'GHS',
        recipientPhone: '0209876543',
        recipientName: 'Ama Serwaa',
        fee: 0.5,
        reference: 'MOCK-SND-0002',
        status: 'confirmed',
        initiatedVia: 'voice',
        readAloud: true,
        createdAt: Date.now() - 1000 * 60 * 60 * 5,
      },
    ]);
  }

  /** New callers are auto-provisioned with the demo starting balance. */
  ensureUser(caller: string): LedgerUser {
    let user = this.users.get(caller);
    if (!user) {
      user = { caller, name: 'MoMo User', balance: STARTING_BALANCE };
      this.users.set(caller, user);
      this.transactions.set(caller, []);
    }
    return user;
  }

  getBalance(caller: string): number {
    return this.ensureUser(caller).balance;
  }

  listRecent(caller: string, limit = 3): LedgerTransaction[] {
    this.ensureUser(caller);
    const all = this.transactions.get(caller) ?? [];
    return [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  private nextReference(): string {
    this.referenceCounter += 1;
    return `VOICE-${String(this.referenceCounter).padStart(4, '0')}`;
  }

  private record(caller: string, transaction: LedgerTransaction): void {
    const all = this.transactions.get(caller) ?? [];
    all.push(transaction);
    this.transactions.set(caller, all);
  }

  sendMoney(params: SendParams): SendOutcome {
    const user = this.ensureUser(params.caller);
    const fee = calculateFee(params.amount);
    if (user.balance < params.amount + fee) {
      return { status: 'failed', reason: 'insufficient_funds' };
    }
    user.balance = Math.round((user.balance - params.amount - fee) * 100) / 100;
    const transaction: LedgerTransaction = {
      id: `txn-voice-${Date.now()}`,
      type: 'send',
      amount: params.amount,
      currency: 'GHS',
      recipientPhone: params.recipientPhone,
      recipientName: params.recipientPhone,
      fee,
      reference: this.nextReference(),
      status: 'confirmed',
      initiatedVia: 'voice',
      readAloud: true,
      createdAt: Date.now(),
    };
    this.record(params.caller, transaction);
    return { status: 'confirmed', transaction };
  }

  buyAirtime(caller: string, amount: number): SendOutcome {
    const user = this.ensureUser(caller);
    if (user.balance < amount) {
      return { status: 'failed', reason: 'insufficient_funds' };
    }
    user.balance = Math.round((user.balance - amount) * 100) / 100;
    const transaction: LedgerTransaction = {
      id: `txn-voice-${Date.now()}`,
      type: 'airtime',
      amount,
      currency: 'GHS',
      recipientPhone: caller,
      recipientName: 'Self',
      fee: 0,
      reference: this.nextReference(),
      status: 'confirmed',
      initiatedVia: 'voice',
      readAloud: true,
      createdAt: Date.now(),
    };
    this.record(caller, transaction);
    return { status: 'confirmed', transaction };
  }
}

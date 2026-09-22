/**
 * Mock transaction service. Simulates the future Appwrite + MTN MoMo backend
 * (dev brief: `transactions` collection) so the full send-money flow is
 * demonstrable without credentials. Replace with real API calls in Track 1's
 * backend integration step.
 */

export type TransactionType = 'send' | 'receive' | 'airtime' | 'withdraw';
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: 'GHS';
  recipientPhone: string;
  recipientName: string;
  fee: number;
  reference: string;
  status: TransactionStatus;
  createdAt: number;
}

/** Single money formatter for the app, so spoken and printed amounts match. */
export function formatMoney(amount: number): string {
  return `GH₵ ${amount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const FEE_RATE = 0.01; // 1% demo fee, matching MoMo's ballpark.
export const FEE_CAP = 10; // GHS

export function calculateFee(amount: number): number {
  return Math.min(Math.round(amount * FEE_RATE * 100) / 100, FEE_CAP);
}

const BALANCE_KEY = 'sikavoice.balance';
const TRANSACTIONS_KEY = 'sikavoice.transactions';

const DEMO_TRANSACTIONS: Transaction[] = [
  {
    id: 'demo-1',
    type: 'receive',
    amount: 500,
    currency: 'GHS',
    recipientPhone: '+233241234567',
    recipientName: 'Kwame Mensah',
    fee: 0,
    reference: 'MOCK-RCV-0001',
    status: 'confirmed',
    createdAt: Date.now() - 1000 * 60 * 60 * 26,
  },
  {
    id: 'demo-2',
    type: 'send',
    amount: 50,
    currency: 'GHS',
    recipientPhone: '0209876543',
    recipientName: 'Ama Serwaa',
    fee: 0.5,
    reference: 'MOCK-SND-0002',
    status: 'confirmed',
    createdAt: Date.now() - 1000 * 60 * 60 * 5,
  },
  {
    id: 'demo-3',
    type: 'airtime',
    amount: 20,
    currency: 'GHS',
    recipientPhone: '0241234567',
    recipientName: 'Self',
    fee: 0,
    reference: 'MOCK-AIR-0003',
    status: 'confirmed',
    createdAt: Date.now() - 1000 * 60 * 40,
  },
];

const STARTING_BALANCE = 1200;

let memoryBalance: number | null = null;
let memoryTransactions: Transaction[] | null = null;
let hasWebStorage = false;

function getWebStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export async function getBalance(): Promise<number> {
  if (memoryBalance != null) return memoryBalance;
  const storage = getWebStorage();
  if (storage) {
    try {
      const stored = storage.getItem(BALANCE_KEY);
      memoryBalance = stored != null ? Number(stored) : STARTING_BALANCE;
      hasWebStorage = true;
      return memoryBalance;
    } catch {
      // fall through to memory-only
    }
  }
  memoryBalance = STARTING_BALANCE;
  return memoryBalance;
}

export async function listTransactions(): Promise<Transaction[]> {
  if (memoryTransactions != null) return memoryTransactions;
  const storage = getWebStorage();
  if (storage) {
    try {
      const stored = storage.getItem(TRANSACTIONS_KEY);
      if (stored != null) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          memoryTransactions = parsed as Transaction[];
          hasWebStorage = true;
          return memoryTransactions;
        }
      }
    } catch {
      // fall through to defaults
    }
  }
  memoryTransactions = [...DEMO_TRANSACTIONS].sort((a, b) => b.createdAt - a.createdAt);
  return memoryTransactions;
}

function persistBalance(value: number): void {
  if (!hasWebStorage) return;
  try {
    getWebStorage()?.setItem(BALANCE_KEY, String(value));
  } catch {
    // Non-critical demo state; ignore persistence failures.
  }
}

function persistTransactions(value: Transaction[]): void {
  if (!hasWebStorage) return;
  try {
    getWebStorage()?.setItem(TRANSACTIONS_KEY, JSON.stringify(value));
  } catch {
    // Non-critical demo state; ignore persistence failures.
  }
}

export interface SendResult {
  status: 'confirmed' | 'failed';
  transaction?: Transaction;
  reason?: string;
}

/**
 * Simulated MoMo transfer: ~15% network failure so error announcements and
 * retry paths are demonstrable in the demo.
 */
export async function sendMoney(params: {
  amount: number;
  fee: number;
  recipientPhone: string;
  recipientName: string;
}): Promise<SendResult> {
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const balance = await getBalance();
  const total = params.amount + params.fee;
  if (balance < total) {
    return { status: 'failed', reason: 'insufficient_funds' };
  }

  const failed = Math.random() < 0.15;
  const transaction: Transaction = {
    id: `txn-${Date.now()}`,
    type: 'send',
    amount: params.amount,
    currency: 'GHS',
    recipientPhone: params.recipientPhone,
    recipientName: params.recipientName,
    fee: params.fee,
    reference: failed ? `MOCK-ERR-${Date.now() % 10000}` : `MOCK-OK-${Date.now() % 10000}`,
    status: failed ? 'failed' : 'confirmed',
    createdAt: Date.now(),
  };

  if (!failed) {
    memoryBalance = balance - total;
    persistBalance(memoryBalance);
  }
  memoryTransactions = [transaction, ...(memoryTransactions ?? [])];
  persistTransactions(memoryTransactions);

  return failed
    ? { status: 'failed', reason: 'network', transaction }
    : { status: 'confirmed', transaction };
}

export async function buyAirtime(params: {
  amount: number;
  recipientPhone: string;
  recipientName?: string;
  network?: string;
}): Promise<SendResult> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const balance = await getBalance();
  if (balance < params.amount) {
    return { status: 'failed', reason: 'insufficient_funds' };
  }
  const failed = Math.random() < 0.05;
  const transaction: Transaction = {
    id: `txn-${Date.now()}`,
    type: 'airtime',
    amount: params.amount,
    currency: 'GHS',
    recipientPhone: params.recipientPhone,
    recipientName: params.recipientName || 'Airtime Top-up',
    fee: 0,
    reference: `AIR-${Date.now() % 10000}`,
    status: failed ? 'failed' : 'confirmed',
    createdAt: Date.now(),
  };
  if (!failed) {
    memoryBalance = balance - params.amount;
    persistBalance(memoryBalance);
  }
  memoryTransactions = [transaction, ...(memoryTransactions ?? [])];
  persistTransactions(memoryTransactions);
  return failed ? { status: 'failed', reason: 'network', transaction } : { status: 'confirmed', transaction };
}

export async function cashOut(params: {
  amount: number;
  agentCode: string;
  agentName: string;
  fee: number;
}): Promise<SendResult> {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const balance = await getBalance();
  const total = params.amount + params.fee;
  if (balance < total) {
    return { status: 'failed', reason: 'insufficient_funds' };
  }
  const failed = Math.random() < 0.05;
  const transaction: Transaction = {
    id: `txn-${Date.now()}`,
    type: 'withdraw',
    amount: params.amount,
    currency: 'GHS',
    recipientPhone: params.agentCode,
    recipientName: params.agentName || `Agent ${params.agentCode}`,
    fee: params.fee,
    reference: `CSH-${Date.now() % 10000}`,
    status: failed ? 'failed' : 'confirmed',
    createdAt: Date.now(),
  };
  if (!failed) {
    memoryBalance = balance - total;
    persistBalance(memoryBalance);
  }
  memoryTransactions = [transaction, ...(memoryTransactions ?? [])];
  persistTransactions(memoryTransactions);
  return failed ? { status: 'failed', reason: 'network', transaction } : { status: 'confirmed', transaction };
}

export async function importSmsTransaction(data: {
  type: TransactionType;
  amount: number;
  recipientPhone: string;
  recipientName: string;
  fee: number;
  reference: string;
}): Promise<Transaction> {
  const transaction: Transaction = {
    id: `sms-${Date.now()}`,
    type: data.type,
    amount: data.amount,
    currency: 'GHS',
    recipientPhone: data.recipientPhone,
    recipientName: data.recipientName,
    fee: data.fee,
    reference: data.reference,
    status: 'confirmed',
    createdAt: Date.now(),
  };
  const currentList = await listTransactions();
  memoryTransactions = [transaction, ...currentList];
  persistTransactions(memoryTransactions);
  return transaction;
}


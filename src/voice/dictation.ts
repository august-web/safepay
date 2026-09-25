import { extractAmount, fold } from './commands';
import { extractDigitSequence, KNOWN_CONTACTS, type Recipient } from './flowParse';

/**
 * One-shot utterance parsers for the transaction screens (P2).
 *
 * A sighted user taps fields; a blind user says one sentence - "send 50 cedis
 * to Ama", "withdraw 200 from agent 12345", "buy 10 cedis data for my line" -
 * and the screen fills itself in. Parsers reuse the flow engine's number and
 * contact vocabulary (extractAmount, extractDigitSequence, KNOWN_CONTACTS) so
 * everything a user can say mid-flow also works here, in every app language.
 *
 * Every parser returns a PARTIAL result: whatever it could extract. Missing
 * fields stay blank on screen for manual entry, and the read-back always says
 * what was understood - imperfect parses are never silently submitted.
 */

const CEDI_WORDS = new Set(['cedi', 'cedis', 'sedie', 'cedis', 'pesewas']);

/** Is this word position followed (within `window`) by a money word? */
function followedByMoneyWord(words: string[], index: number): boolean {
  return words.slice(index + 1, index + 3).some((w) => CEDI_WORDS.has(w));
}

/** True when the transcript names the user's own line. */
export function mentionsSelf(text: string): boolean {
  return (
    /\b(self|myself|for me|my line|my number|my own)\b/.test(text) ||
    /(woara|me nkoa|menkoa|nye nye|amesia)/.test(text)
  );
}

/** True when the transcript names another person's line. */
export function mentionsOther(text: string): boolean {
  return (
    /\b(other|someone else|another (line|number|person)|for someone)\b/.test(text) ||
    /(obi fofor|amebubu|ame bubu|fofor)/.test(text)
  );
}

/** Extracts a contact or raw phone number, or null. */
function extractContact(transcript: string): Recipient | null {
  const text = fold(transcript ?? '');
  const matches = KNOWN_CONTACTS.filter((c) => text.includes(fold(c.name)));
  if (matches.length > 0) {
    matches.sort((a, b) => b.name.length - a.name.length);
    return { name: matches[0].name, phone: matches[0].phone };
  }
  const digits = extractDigitSequence(transcript, 9);
  if (digits != null) {
    const local = digits.length > 10 ? `0${digits.slice(-9)}` : digits;
    return { name: null, phone: local };
  }
  return null;
}

/** MTN/Telecel/AT prefix map, for a read-only network hint after dictation. */
export function networkForPhone(phone: string): 'MTN' | 'Telecel' | 'AT Ghana' | null {
  if (!/^0\d{9}$/.test(phone)) return null;
  const prefix = phone.slice(0, 3);
  if (['024', '054', '055', '059', '025'].includes(prefix)) return 'MTN';
  if (['020', '050'].includes(prefix)) return 'Telecel';
  if (['027', '057', '026', '056'].includes(prefix)) return 'AT Ghana';
  return null;
}

export interface SendFields {
  amount: number | null;
  recipientName: string | null;
  phone: string | null;
}

/**
 * "send 50 cedis to Ama" / "koma sika aduonum ma Ama" / "send 50 to 0241234567".
 */
export function parseSendUtterance(transcript: string): SendFields {
  const text = fold(transcript ?? '');
  const words = text.split(' ').filter(Boolean);

  // Amount: digit or number-word run. A 9+ digit run is a phone number, not
  // an amount, so prefer money words; extractAmount's 10,000 ceiling already
  // rejects phone-length numbers read as amounts.
  let amount: number | null = null;
  const digitRuns: { value: string; index: number }[] = [];
  words.forEach((word, index) => {
    if (/^\d+$/.test(word)) digitRuns.push({ value: word, index });
  });
  const amountRun = digitRuns.find((run) => followedByMoneyWord(words, run.index));
  if (amountRun != null) {
    amount = Number(amountRun.value);
  } else {
    const parsed = extractAmount(transcript);
    amount = parsed != null && parsed <= 10_000 ? parsed : null;
  }

  const contact = extractContact(transcript);
  let recipientName: string | null = null;
  if (contact?.name != null) {
    recipientName = contact.name;
  } else {
    // Free-text name: words after "to/for/ma/de" that are not numbers.
    const marker = words.findIndex((w) => ['to', 'for', 'ma', 'de', 'na'].includes(w));
    if (marker >= 0 && marker + 1 < words.length) {
      const tail = words
        .slice(marker + 1)
        .filter((w) => !/^\d+$/.test(w) && !CEDI_WORDS.has(w))
        .join(' ');
      if (tail.length > 1 && tail.length <= 30) recipientName = tail;
    }
  }

  // Phone: prefer a digit run that is NOT the amount.
  let phone: string | null = null;
  const phoneRun = digitRuns.find((run) => run.value.length >= 9 && run !== amountRun);
  if (phoneRun != null) {
    const local = phoneRun.value.length > 10 ? `0${phoneRun.value.slice(-9)}` : phoneRun.value;
    phone = local;
  } else if (contact?.name == null && contact != null) {
    phone = contact.phone;
  }

  return { amount, recipientName, phone };
}

export interface CashOutFields {
  amount: number | null;
  agentCode: string | null;
}

/**
 * "withdraw 200 cedis from agent 12345" / "yi sika 200" / "agent 123456".
 *
 * The amount/agent ambiguity is resolved by position: a digit run right
 * before a cedi word is the amount, a run after "agent" (or 5+ digits on its
 * own) is the agent code. Two runs -> both; one run -> by shape and context.
 */
export function parseCashoutUtterance(transcript: string): CashOutFields {
  const text = fold(transcript ?? '');
  const words = text.split(' ').filter(Boolean);

  const runs: { value: string; index: number }[] = [];
  words.forEach((word, index) => {
    if (/^\d+$/.test(word)) runs.push({ value: word, index });
  });

  const agentKeyword = words.findIndex((w) => w === 'agent' || w === 'code' || w === 'kɔntra'.replace('ɔ', 'o'));

  let amount: number | null = null;
  let agentCode: string | null = null;

  if (runs.length >= 2) {
    const amountRun = runs.find((run) => followedByMoneyWord(words, run.index)) ?? runs[0];
    const agentRun = runs.find((run) => run !== amountRun && run.value.length >= 4);
    amount = Number(amountRun.value);
    if (agentRun != null) agentCode = agentRun.value;
  } else if (runs.length === 1) {
    const run = runs[0];
    const nearAgent = agentKeyword >= 0 && Math.abs(run.index - agentKeyword) <= 3;
    if (nearAgent || (run.value.length >= 5 && !followedByMoneyWord(words, run.index))) {
      agentCode = run.value;
    } else {
      amount = Number(run.value);
    }
  }

  // Native number words only ever mean an amount here.
  if (amount == null) {
    const parsed = extractAmount(transcript);
    if (parsed != null && parsed <= 10_000) amount = parsed;
  }

  // Only keep plausible agent codes (demo agents are 5-6 digits).
  if (agentCode != null && !/^\d{4,8}$/.test(agentCode)) agentCode = null;

  return { amount, agentCode };
}

export interface AirtimeFields {
  amount: number | null;
  serviceType: 'credit' | 'data' | null;
  recipientType: 'self' | 'other' | null;
  phone: string | null;
}

/**
 * "buy 10 cedis airtime for myself" / "10 cedis data for 0241234567" /
 * "top up 20 cedis on my line".
 */
export function parseAirtimeUtterance(transcript: string): AirtimeFields {
  const text = fold(transcript ?? '');
  const words = text.split(' ').filter(Boolean);

  let serviceType: AirtimeFields['serviceType'] = null;
  if (/\b(data|bundle|internet|megabytes|mbs|gb)\b/.test(text)) serviceType = 'data';
  else if (/\b(airtime|credit|top ?up|topup|recharge|phone ?credit)\b/.test(text)) serviceType = 'credit';

  let recipientType: AirtimeFields['recipientType'] = null;
  if (mentionsSelf(text)) recipientType = 'self';
  else if (mentionsOther(text)) recipientType = 'other';

  let amount: number | null = null;
  const digitRuns: { value: string; index: number }[] = [];
  words.forEach((word, index) => {
    if (/^\d+$/.test(word)) digitRuns.push({ value: word, index });
  });
  const amountRun = digitRuns.find((run) => followedByMoneyWord(words, run.index));
  if (amountRun != null) {
    amount = Number(amountRun.value);
  } else {
    const parsed = extractAmount(transcript);
    amount = parsed != null && parsed <= 10_000 ? parsed : null;
  }

  // A 9-12 digit run that is not the amount is the recipient number.
  let phone: string | null = null;
  const phoneRun = digitRuns.find((run) => run.value.length >= 9 && run !== amountRun);
  if (phoneRun != null) {
    const local = phoneRun.value.length > 10 ? `0${phoneRun.value.slice(-9)}` : phoneRun.value;
    phone = local;
    if (recipientType == null) recipientType = 'other';
  }

  if (recipientType === 'self' && phone == null) phone = '0241234567'; // demo own line

  return { amount, serviceType, recipientType, phone };
}

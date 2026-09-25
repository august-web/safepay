import { fold } from './commands';
import { DEMO_CONTACTS } from '../services/transactions';

/**
 * Parsers for the conversational voice flows.
 *
 * During a flow the user is answering questions ("how much?", "who?"), not
 * issuing commands, so transcripts are interpreted differently: yes/no
 * confirmation, digit sequences for phone numbers and agent codes, and known
 * contact names. Everything runs on the same diacritic-folded text as command
 * matching, so English spelling drift on Twi/Ewe words still lands.
 */

export type YesNo = 'yes' | 'no';

/** Confirmation words across English, Twi and Ewe (folded). */
const YES_WORDS = new Set([
  'yes', 'yeah', 'yep', 'ok', 'okay', 'correct', 'confirm', 'sure', 'do it',
  'aane', 'ane', 'eni', 'enyie', // Twi: aane
  'ee', 'e', 'en', 'ene', // Ewe: ɛ̃ (folds to e/en drift)
]);

const NO_WORDS = new Set([
  'no', 'nope', 'cancel', 'stop', 'never mind', 'dabi', 'daabi', // Twi: dabi
  'ave', 'ao', 'mavo', // Ewe: ave
]);

/** Digit words: English + Twi + Ewe, for spoken phone numbers and codes. */
const DIGIT_WORDS: Record<string, number> = {
  zero: 0, oh: 0, o: 0, nought: 0, ziro: 0, hwia: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  koro: 1, mmienu: 2, mmensa: 3, mmiesa: 3, enan: 4, enum: 5, ensia: 6,
  enson: 7, enwotwe: 8, enkron: 9,
  deka: 1, eve: 2, eto: 3, ene: 4, ato: 5, ade: 6, adre: 7, enyi: 8, asieke: 9,
};

/** Tens words that compose with a following digit: "aduonu enum" = 25. */
const TENS_WORDS: Record<string, number> = {
  aduonu: 20, aduasa: 30, aduanan: 40, aduonum: 50, aduosia: 60,
  aduason: 70, aduowotwe: 80, aduokron: 90,
  bladeve: 20, blaeto: 30, blaene: 40, blaato: 50, blaade: 60,
  blaadre: 70, blaenyi: 80, blaasieke: 90,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/** Is this word a yes/no answer? Used to route transcripts inside flows. */
export function isYesNoWord(word: string): YesNo | null {
  const w = fold(word);
  if (NO_WORDS.has(w)) return 'no';
  if (YES_WORDS.has(w)) return 'yes';
  return null;
}

/**
 * Reads a yes/no answer out of a transcript. When both kinds of word appear,
 * the later one wins ("no... sorry, yes").
 */
export function parseYesNo(transcript: string): YesNo | null {
  const words = fold(transcript ?? '').split(' ').filter(Boolean);
  let result: YesNo | null = null;
  for (const word of words) {
    if (NO_WORDS.has(word)) result = 'no';
    else if (YES_WORDS.has(word) && result == null) result = 'yes';
  }
  return result;
}

/** True when the transcript is only a yes/no answer with nothing else. */
export function isBareYesNo(transcript: string): boolean {
  const words = fold(transcript ?? '').split(' ').filter(Boolean);
  if (words.length === 0) return false;
  return words.every((w) => YES_WORDS.has(w) || NO_WORDS.has(w) || w === 'the' || w === 'a');
}

/**
 * Extracts a digit sequence from speech: "024 123 4567" (as digits), "zero two
 * four one two three...", or Twi/Ewe digit words. Returns the digits only, or
 * null when the transcript contains no readable digits.
 */
export function extractDigitSequence(transcript: string, minDigits = 3): string | null {
  const text = fold(transcript ?? '');

  // The recogniser often emits numerals directly, sometimes with spaces.
  const merged = text.replace(/(\d)\s+(?=\d)/g, '$1');
  const digitRun = merged.match(/\d{3,}/g);
  if (digitRun != null) {
    const digits = digitRun.join('').replace(/\D/g, '');
    if (digits.length >= minDigits) return digits;
  }

  // Spelled-out digits, with tens composition ("aduonu enum" -> 25).
  const words = text.split(' ').filter(Boolean);
  let digits = '';
  let pendingTens: number | null = null;
  for (const word of words) {
    const tens = TENS_WORDS[word];
    if (tens != null) {
      pendingTens = tens;
      continue;
    }
    const digit = DIGIT_WORDS[word];
    if (digit == null) continue;
    if (pendingTens != null && digit < 10) {
      digits += String(pendingTens + digit);
      pendingTens = null;
    } else {
      if (pendingTens != null) {
        digits += String(pendingTens);
        pendingTens = null;
      }
      digits += String(digit);
    }
  }
  if (pendingTens != null) digits += String(pendingTens);
  return digits.length >= minDigits ? digits : null;
}

/**
 * Known demo contacts, resolved from the wallet service so the spoken name,
 * the confirmation question and the actual transfer all share one record.
 * Every name here has a native name clip (name.ama / name.kwame / name.kofi /
 * name.abena), so the spoken read-back says the recipient natively instead of
 * falling back to English TTS.
 */
export const KNOWN_CONTACTS: readonly { name: string; phone: string }[] = DEMO_CONTACTS;

export type Recipient = { name: string | null; phone: string };

/**
 * Finds a recipient in a transcript: a known contact's name, or any phone-like
 * digit sequence. The phone is normalised to local 0XXXXXXXXX format.
 */
export function parseRecipient(transcript: string): Recipient | null {
  const text = fold(transcript ?? '');

  // Longest contact name that appears wins ("ama serwaa" beats "ama").
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

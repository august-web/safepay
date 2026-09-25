/**
 * Spoken command grammar for SikaVoice.
 *
 * A blind user talks to the app; the app must obey in the language they speak.
 * Transcripts are matched locally - nothing is sent anywhere except the
 * platform recogniser's own audio stream.
 *
 * Matching is deliberately forgiving. The recogniser has no Twi/Ewe model, so
 * it transcribes native words with English spelling drift ("koma sika" for
 * "kɔma sika", "dzo da" for "dzo ɖa"). Every phrase is therefore stored with
 * both its real orthography and its ASCII-drift variants, and matching runs on
 * diacritic-folded, edit-distance-tolerant comparison so "komma sika" still
 * opens Send Money.
 */

export type VoiceIntent =
  | 'balance'
  | 'statement'
  | 'send'
  | 'airtime'
  | 'cashout'
  | 'settings'
  | 'home'
  | 'stop'
  | 'repeat'
  | 'help';

type CommandPattern = {
  intent: VoiceIntent;
  /** Spoken phrases, lower-cased. Longer phrases win over shorter ones. */
  phrases: string[];
};

/**
 * Ordered by phrase length at match time, not by array position, so
 * "send money" always beats "money" regardless of language ordering here.
 */
const COMMAND_PATTERNS: CommandPattern[] = [
  {
    intent: 'balance',
    phrases: [
      // English + Ghanaian English
      'check my balance',
      'check balance',
      'my balance',
      'how much money',
      'how much do i have',
      'money left',
      'my money',
      'balance',
      // Twi
      'me sika a aka',
      'sika a aka',
      'kyerɛ me sika',
      'kyere me sika',
      'me sika',
      'sika',
      // Ewe
      'ga si le asinye',
      'nye ga',
      'ga si le eme',
      'ga',
      // Ga
      'mi shika',
      'shika',
    ],
  },
  {
    intent: 'statement',
    phrases: [
      'statement',
      'my statement',
      'read my statement',
      'transaction history',
      'transactions',
      'history',
      'what did i spend',
      // Twi
      'sika krataa',
      'me sika krataa',
      'abakɔsɛm',
      'abakosem',
      // Ewe
      'ga ƒe ŋkɔkɔ',
      'ga fe nkokɔ',
      'ŋkɔkɔ',
      'nkoko',
      // Ga
      'shika he sane',
      'sane',
    ],
  },
  {
    intent: 'send',
    phrases: [
      'send money',
      'send',
      'transfer money',
      'transfer',
      'pay someone',
      'make a payment',
      // Twi
      'kɔma sika',
      'koma sika',
      'soma sika',
      'soma',
      // Ewe
      'ɖo ga',
      'ɖo gama',
      'do ga',
      'dɔ ga',
      // Ga
      'kɛ shika aya',
      'tsɔ shika aya',
      'shika aya',
    ],
  },
  {
    intent: 'airtime',
    phrases: [
      'airtime',
      'air time',
      'buy airtime',
      'top up',
      'topup',
      'buy data',
      'data bundle',
      'phone credit',
      'credit',
      'internet',
      'recharge',
      'me airtime',
    ],
  },
  {
    intent: 'cashout',
    phrases: [
      'cash out',
      'cashout',
      'withdraw money',
      'withdraw',
      'take money',
      'collect money',
      'agent',
      // Twi
      'yi sika',
      'twe sika',
      // Ewe
      'xe ga',
      'xexɛ ga',
      // Ga
      'mɔ shika',
      'mo shika',
    ],
  },
  {
    intent: 'settings',
    phrases: [
      'settings',
      'setting',
      'preferences',
      'options',
      'accessibility settings',
      'change settings',
      'change language',
      'contrast',
    ],
  },
  {
    intent: 'home',
    phrases: [
      'go home',
      'home',
      'main screen',
      'main menu',
      // Twi
      'san kɔ fie',
      'san ko fie',
      'fie',
      // Ewe
      'ɖo aƒe',
      'do afe',
      'aƒe',
      'afe',
    ],
  },
  {
    intent: 'stop',
    phrases: [
      'stop talking',
      'stop listening',
      'stop',
      'be quiet',
      'quiet',
      'silence',
      'cancel',
      'never mind',
      // Twi
      'gyae',
      'gyae kasa',
      // Ewe
      'dzo ɖa',
      'dzo da',
      'te ɖa',
      'te da',
    ],
  },
  {
    intent: 'repeat',
    phrases: [
      'say that again',
      'say again',
      'repeat that',
      'repeat',
      'once more',
      'what did you say',
      // Ewe
      'gbugbɔ gakpɔ',
      'gbugbo gakpo',
    ],
  },
  {
    intent: 'help',
    phrases: [
      'help',
      'what can i say',
      'what can i do',
      'commands',
      'voice commands',
      'instructions',
      'guide me',
    ],
  },
];

/** Letters with diacritics fold to ASCII so drift transcriptions match. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ɛ/g, 'e')
    .replace(/ɔ/g, 'o')
    .replace(/ŋ/g, 'ng')
    .replace(/ƒ/g, 'f')
    .replace(/ɖ/g, 'd')
    .replace(/ʋ/g, 'v')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Padded so `ga` matches "my ga" but not "again". */
function containsPhrase(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${phrase} `);
}

/**
 * Maps a recognised transcript to an intent.
 *
 * Strategy, in order:
 *  1. Longest fuzzy-contained phrase wins ("send money" beats "money").
 *  2. For a single-word or two-word utterance, tolerate up to 1-2 edits
 *     against every phrase of the same word count ("shika" ~ "shika").
 */
/**
 * Exact stop/cancel detection for active conversational flows.
 *
 * Deliberately skips the fuzzy layer: "skip" and "nope" must never cancel a
 * money transfer because they sit within Levenshtein distance of stop words.
 * Cancelling a transaction on a misheard word is far more expensive than
 * missing one cancellation, and the flow re-asks on anything unrecognised.
 */
export function isStopUtterance(transcript: string): boolean {
  const text = fold(transcript ?? '');
  if (text.length === 0) return false;
  const stop = COMMAND_PATTERNS.find((p) => p.intent === 'stop');
  if (stop == null) return false;
  return stop.phrases.some((phrase) => containsPhrase(text, fold(phrase)));
}

export function matchVoiceIntent(transcript: string): VoiceIntent | null {
  const text = fold(transcript ?? '');
  if (text.length === 0) return null;

  let best: { intent: VoiceIntent; length: number; words: number } | null = null;

  for (const pattern of COMMAND_PATTERNS) {
    for (const phrase of pattern.phrases) {
      const folded = fold(phrase);
      if (!containsPhrase(text, folded)) continue;
      const words = folded.split(' ').filter(Boolean).length;
      if (best == null || folded.length > best.length) {
        best = { intent: pattern.intent, length: folded.length, words };
      }
    }
  }

  const utteranceWords = text.split(' ').filter(Boolean).length;
  if (utteranceWords > 3) return best?.intent ?? null;

  const maxEdits = utteranceWords <= 1 ? 2 : utteranceWords === 2 ? 3 : 4;
  let fuzzyBest: { intent: VoiceIntent; edits: number; words: number } | null = null;

  for (const pattern of COMMAND_PATTERNS) {
    for (const phrase of pattern.phrases) {
      const folded = fold(phrase);
      const phraseWords = folded.split(' ').filter(Boolean).length;
      if (phraseWords !== utteranceWords) continue;
      const edits = levenshtein(text, folded);
      if (edits <= maxEdits && (fuzzyBest == null || edits < fuzzyBest.edits)) {
        fuzzyBest = { intent: pattern.intent, edits, words: phraseWords };
      }
    }
  }

  // Spelling drift produces multi-word utterances whose longest contained
  // phrase is a short generic word ("komma sika" contains "sika" = balance).
  // A multi-word fuzzy match is the more specific reading, so it wins over a
  // shorter contained one; equal word counts keep the exact match.
  if (fuzzyBest != null && (best == null || fuzzyBest.words > best.words)) {
    return fuzzyBest.intent;
  }
  return best?.intent ?? fuzzyBest?.intent ?? null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Extracts a spoken money amount from a transcript, e.g.
 * "send 50 cedis to 024" -> 50, "kɔma sika cedi aduonu" -> 20.
 * Recognises digits, Twi and Ewe number words, and teens/tens compositions.
 */
export function extractAmount(text: string): number | null {
  const normalised = fold(text ?? '');
  const digitMatch = normalised.match(/(\d+)/);
  if (digitMatch != null) return Number(digitMatch[1]);

  const words = normalised.split(' ').filter(Boolean);
  const ones: Record<string, number> = {
    koro: 1, mmienu: 2, mmensa: 3, mmiesa: 3, enan: 4, enum: 5, ensia: 6, enson: 7,
    enwotwe: 8, enkron: 9,
    deka: 1, eve: 2, eto: 3, ene: 4, ato: 5, ade: 6, adre: 7, enyi: 8, asieke: 9,
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  };
  const tens: Record<string, number> = {
    aduonu: 20, aduasa: 30, aduanan: 40, aduonum: 50, aduosia: 60, aduason: 70,
    aduowotwe: 80, aduokron: 90,
    bladeve: 20, blaeto: 30, blaene: 40, blaato: 50, blaade: 60, blaadre: 70,
    blaenyi: 80, blaasieke: 90,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
    eighty: 80, ninety: 90,
  };
  const scales: Record<string, number> = {
    oha: 100, ha: 100, alafa: 100, hundred: 100,
    apem: 1000, akpe: 1000, thousand: 1000,
  };
  const cediWords = new Set(['cedi', 'cedis', 'sedie', 'cedies', 'ghc', 'ghs']);

  let total = 0;
  let current = 0;
  let sawMoneyWord = false;

  for (const word of words) {
    if (ones[word] != null) {
      current += ones[word];
    } else if (tens[word] != null) {
      current += tens[word];
    } else if (scales[word] != null) {
      current = (current || 1) * scales[word];
      total += current;
      current = 0;
      sawMoneyWord = true;
    } else if (cediWords.has(word)) {
      sawMoneyWord = true;
    }
  }
  const amount = total + current;
  if (amount <= 0) return null;
  if (!sawMoneyWord && amount < 1) return null;
  if (amount > 10_000) return null; // Demo safety ceiling.
  return amount;
}

/**
 * Vocabulary handed to the recogniser as biasing strings, which measurably
 * improves accuracy for short commands and Ghanaian language words.
 */
export function commandVocabulary(): string[] {
  const words = new Set<string>();
  for (const pattern of COMMAND_PATTERNS) {
    for (const phrase of pattern.phrases) {
      words.add(phrase);
      for (const word of fold(phrase).split(' ')) {
        if (word.length > 2) words.add(word);
      }
    }
  }
  // Money digits and common amounts bias the recogniser towards numbers.
  for (const n of ['5', '10', '20', '50', '100', '200', '500']) words.add(n);
  return Array.from(words);
}

export const HELPABLE_INTENTS: VoiceIntent[] = [
  'balance',
  'statement',
  'send',
  'airtime',
  'cashout',
  'settings',
  'stop',
  'repeat',
];

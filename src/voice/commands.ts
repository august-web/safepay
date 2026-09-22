/**
 * Spoken command grammar for SikaVoice.
 *
 * The brief lists `expo-speech-recognition` ("Voice commands / STT") in the App
 * Track, and for a blind user talking to the app is often faster than hunting
 * for a control. Commands are matched locally on the transcribed text - nothing
 * is sent anywhere except the platform recogniser's own audio stream.
 *
 * Phrases are matched in every language the app speaks, because the recognised
 * transcript is whatever the engine heard: an Ewe speaker saying "ga" (money)
 * and an English speaker saying "balance" must both work.
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
      'balance',
      'ballance',
      'balans',
      'my balance',
      'check balance',
      'how much money',
      'how much do i have',
      'how much is in my account',
      'money left',
      'my money',
      // Twi
      'me sika',
      'sika a aka',
      'me sika a aka',
      // Ewe
      'my ga',
      'ga si le asinye',
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
      'bank statement',
      'transaction history',
      'transactions',
      'history',
      'what did i spend',
      // Twi
      'abakɔsɛm',
      'me abakɔsɛm',
      // Ewe
      'ŋkɔkɔ',
      'ga ƒe ŋkɔkɔ',
      // Ga
      'sane',
      'shika he sane',
    ],
  },
  {
    intent: 'send',
    phrases: [
      'send money',
      'send',
      'transfer',
      'transfer money',
      'pay someone',
      'make a payment',
      // Twi
      'soma sika',
      'soma',
      // Ewe
      'ɖo ga',
      'dɔ ga',
      // Ga
      'kɛ shika aya',
      'tsɔ shika aya',
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
      'credit',
      'phone credit',
      'buy data',
      'data bundle',
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
      'withdraw',
      'withdraw money',
      'take money',
      'agent',
      'collect money',
      // Twi
      'twe sika',
      // Ewe
      'xe ga',
      // Ga
      'mɔ shika',
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
      'contrast',
      'language',
      'change language',
    ],
  },
  {
    intent: 'home',
    phrases: ['home', 'go home', 'main screen', 'main menu', 'start', 'beginning', 'fie', 'aƒe'],
  },
  {
    intent: 'stop',
    phrases: [
      'stop',
      'stop talking',
      'be quiet',
      'quiet',
      'silence',
      'shut up',
      'cancel',
      'never mind',
      // Twi
      'gyae',
      'gyae kasa',
      // Ewe
      'dzo ɖa',
      'te ɖa',
    ],
  },
  {
    intent: 'repeat',
    phrases: ['repeat', 'say that again', 'again', 'say again', 'once more', 'what did you say'],
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

/** Letters with diacritics survive normalisation (Twi/Ewe/Gã orthography). */
function normalise(transcript: string): string {
  return transcript
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
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
 * Longest matching phrase wins: "send money" is a transfer, "my money" is a
 * balance check, and a transcript containing both picks the more specific one.
 */
export function matchVoiceIntent(transcript: string): VoiceIntent | null {
  const text = normalise(transcript ?? '');
  if (text.length === 0) return null;

  let best: { intent: VoiceIntent; length: number } | null = null;

  for (const pattern of COMMAND_PATTERNS) {
    for (const phrase of pattern.phrases) {
      if (!containsPhrase(text, phrase)) continue;
      if (best == null || phrase.length > best.length) {
        best = { intent: pattern.intent, length: phrase.length };
      }
    }
  }

  return best?.intent ?? null;
}

/**
 * Vocabulary handed to the recogniser as biasing strings, which measurably
 * improves accuracy for short commands and Ghanaian language words.
 */
export function commandVocabulary(): string[] {
  const words = new Set<string>();
  for (const pattern of COMMAND_PATTERNS) {
    for (const phrase of pattern.phrases) {
      // Bias towards single words plus the multi-word phrases.
      words.add(phrase);
      for (const word of phrase.split(' ')) {
        if (word.length > 2) words.add(word);
      }
    }
  }
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

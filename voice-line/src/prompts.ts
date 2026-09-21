/**
 * IVR prompt strings in Akan (Twi) and Ewe.
 *
 * Sourced from the dev brief's IVR examples (language-select greeting,
 * passphrase prompts) and kept consistent with the Track 1 app locales in
 * `../src/i18n/locales/*.json`. These are DRAFT translations — the repo
 * README flags the same caveat for the app strings: get native-speaker
 * review before the demo video.
 */
export type VoiceLanguage = 'tw' | 'ee';

/** BCP-47 locales for telephony TTS, same mapping as the app's speech service. */
export const SPEECH_LOCALES: Record<VoiceLanguage, string> = {
  tw: 'ak-GH',
  ee: 'ee-GH',
};

/** Spoken-money readout. ASCII "GHS" is used (not ₵) so IVR TTS reads it reliably. */
export function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface VoicePrompts {
  languageSelect: string;
  repromptLanguage: string;
  passphrase: string;
  pinFallback: string;
  authFailed: string;
  authLocked: string;
  welcomeBack: string;
  menu: string;
  invalidChoice: string;
  balanceIs: (balance: string) => string;
  recentNone: string;
  recentSend: (amount: string, who: string) => string;
  recentReceive: (amount: string, who: string) => string;
  recentAirtime: (amount: string) => string;
  amountPrompt: string;
  amountInvalid: string;
  insufficient: string;
  recipientPrompt: string;
  recipientInvalid: string;
  confirmSend: (amount: string, to: string) => string;
  confirmInvalid: string;
  confirmed: (amount: string, to: string, reference: string) => string;
  cancelled: string;
  airtimeAmount: string;
  confirmAirtime: (amount: string) => string;
  failed: string;
  sessionExpired: string;
  goodbye: string;
}

const LANGUAGE_SELECT =
  'Akwaaba. Wo ka Twi anaa Ewe? Press 1 for Twi, press 2 for Ewe.';

export const TW_PROMPTS: VoicePrompts = {
  // Greeting stays bilingual: the caller has not picked a language yet.
  languageSelect: LANGUAGE_SELECT,
  repromptLanguage: 'Tia 1 ma Twi, tia 2 ma Ewe.',
  passphrase: 'Bɛyɛ wo din. Ka wo nkyerɛma pa a.',
  pinFallback: 'Tia wo nɔma anan no wɔ fon no so.',
  authFailed: 'Wo nkyerɛma pa no nyɛ wo dea. Yɛw bio.',
  authLocked: 'Wo yɛ no dodoɔ. Twɛn kakra na san yɛ bio.',
  welcomeBack: 'Akwaaba bio.',
  menu: 'Tia 1 na hwɛ wo sika a ɛwɔ mu. Tia 2 na kɔma sika. Tia 3 na tɔ airtime. Tia 4 na tie ndwuma a atwam.',
  invalidChoice: 'Nea wotiae no nyɛ. Yɛw bio.',
  balanceIs: (balance) => `Wo sika a ɛwɔ mu yɛ ${balance}.`,
  recentNone: 'Ndwuma biara nni hɔ da.',
  recentSend: (amount, who) => `Wosomaa ${amount} kɔmaa ${who}.`,
  recentReceive: (amount, who) => `Wonyae ${amount} fii ${who} nkyɛn.`,
  recentAirtime: (amount) => `Wotɔɔ airtime ${amount}.`,
  amountPrompt: 'Cedis ahe na wobɛkɔma? Tia dodoɔ no, na tia hash.',
  amountInvalid: 'Dodoɔ no nyɛ. Hyɛ dodoɔ a ɛsen zero ma.',
  insufficient: 'Wo sika nnya dodoɔ no ne ka no. Yɛ dodoɔ foforɔ.',
  recipientPrompt: 'Onyani no fono nɔma ahe? Tia nɔma du no.',
  recipientInvalid: 'Fono nɔma no nyɛ. Hyɛ Ghana fono nɔma pa ma, sɛ 0241234567.',
  confirmSend: (amount, to) =>
    `Worekɔma ${amount} ma ${to}. Ka yiw sɛ ɛyɛ, anaasɛ ka daabi. Tia 1 ma yiw, tia 2 ma daabi.`,
  confirmInvalid: 'Me ntee wo yie. Ka yiw anaa daabi.',
  confirmed: (amount, to, reference) =>
    `Dwuma no adi mu. Wosomaa ${amount} ma ${to}. Nkyerɛase ${reference}.`,
  cancelled: 'Wogyae dwuma no. Sika nnsɔree.',
  airtimeAmount: 'Airtime dodoɔ ahe na wobɛtɔ ama wo ho? Tia dodoɔ no na tia hash.',
  confirmAirtime: (amount) =>
    `Wobɛtɔ airtime ${amount} ama wo ho. Ka yiw anaa daabi. Tia 1 ma yiw, tia 2 ma daabi.`,
  failed: 'Dwuma no anyɛ yie. Yɛw bio.',
  sessionExpired: 'Wo berɛ asa. Frɛ bio.',
  goodbye: 'Medaase. Nante yie.',
};

export const EE_PROMPTS: VoicePrompts = {
  languageSelect: LANGUAGE_SELECT,
  repromptLanguage: 'Tɔ 1 ɖe Twi ta, tɔ 2 ɖe Ewe ta.',
  passphrase: 'Ŋdi wo nɔ. Gbe wo ŋkuɖoɖo la.',
  pinFallback: 'Tɔ wo nɔma ene la ɖe fon la dzi.',
  authFailed: 'Wo ŋkuɖoɖo mele è nyamenye o. Gbugbɔ ɖo.',
  authLocked: 'Èɖoe ƒe gɔmeɖoanyi geɖe. Ɖo naneke hafi nètrɔ ɖo.',
  welcomeBack: 'Woezɔ.',
  menu: 'Tɔ 1 be nàkpɔ ga si le eme. Tɔ 2 be nàgatsɔ ga. Tɔ 3 be nàtso airtime. Tɔ 4 be nàse dɔwɔwɔ siwo va yi.',
  invalidChoice: 'Nu si nètɔ la mesɔ o. Gbugbɔ ɖo.',
  balanceIs: (balance) => `Ga si le eme nye ${balance}.`,
  recentNone: 'Dɔwɔwɔ aɖeke meli o.',
  recentSend: (amount, who) => `Ètsɔ ${amount} ɖo na ${who}.`,
  recentReceive: (amount, who) => `Èxɔ ${amount} tso ${who} gbɔ.`,
  recentAirtime: (amount) => `Ètso airtime ${amount}.`,
  amountPrompt: 'Ga nenyae nèdi be yèatsɔ ɖo? Tɔ ga la ƒe akpa eye nàtɔ hash.',
  amountInvalid: 'Ga si nède la mesɔ o. Ɗe ga si sɔ gbɔ na zero.',
  insufficient: 'Wò ga metsɔ ga si sɔ kple ga si woxɔ la o. Gbugbɔ ɖo ga bubu.',
  recipientPrompt: 'Ame si adɔ ga la ƒe fon nɔma nenyae? Tɔ nɔma ewo la.',
  recipientInvalid: 'Fon nɔma la mesɔ o. Ɗe Ghana fon nɔma si sɔ, lele 0241234567.',
  confirmSend: (amount, to) =>
    `Ègatsɔ ${amount} ɖo na ${to}. Gblɔ ɛ̃ ne esɔ, alo gblɔ ao. Tɔ 1 ɖe ɛ̃ ta, tɔ 2 ɖe ao ta.`,
  confirmInvalid: 'Menye se wò gbe o. Gblɔ ɛ̃ alo ao.',
  confirmed: (amount, to, reference) =>
    `Dɔa wu ade. Ètsɔ ${amount} ɖo na ${to}. Ƒe nyagblɔɖi ${reference}.`,
  cancelled: 'Ètsɔ dɔa. Gada o.',
  airtimeAmount: 'Airtime nenyae nèdi be yèatso ɖe ɖokuiwò dzi? Tɔ ga la eye nàtɔ hash.',
  confirmAirtime: (amount) =>
    `Èle airtime ${amount} tso ge ɖe ɖokuiwò dzi. Gblɔ ɛ̃ alo ao. Tɔ 1 ɖe ɛ̃ ta, tɔ 2 ɖe ao ta.`,
  failed: 'Dɔa mewu ade o. Gbugbɔ ɖo.',
  sessionExpired: 'Wò ɣeyiɣi nu. Gafɔ bio.',
  goodbye: 'Akpe. Hede nyuie.',
};

export const PROMPTS: Record<VoiceLanguage, VoicePrompts> = {
  tw: TW_PROMPTS,
  ee: EE_PROMPTS,
};

/** "Yes" words the confirm step accepts per language (English included as a backstop). */
export const YES_WORDS: Record<VoiceLanguage, string[]> = {
  tw: ['yiw', 'yoo', 'yew', 'yes'],
  ee: ['ɛ̃', 'ẽ', 'e', 'yes'],
};

/** "No" words the confirm step accepts per language. */
export const NO_WORDS: Record<VoiceLanguage, string[]> = {
  tw: ['daabi', 'no'],
  ee: ['ao', 'no'],
};

function matchesAny(haystack: string, words: string[]): boolean {
  const normalized = haystack
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = normalized.split(' ');
  return words.some((word) => tokens.includes(word));
}

export function interpretConfirmation(speech: string, lang: VoiceLanguage): 'yes' | 'no' | null {
  if (matchesAny(speech, YES_WORDS[lang])) return 'yes';
  if (matchesAny(speech, NO_WORDS[lang])) return 'no';
  return null;
}


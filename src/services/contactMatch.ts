import { fold } from '../voice/commands';

/**
 * On-device contact matching for spoken recipient lookup (Phase 3).
 *
 * Pure functions only: the query and the address book never leave the device,
 * nothing here touches the network, and every rule is testable without a
 * phone. The native address-book filter narrows the rows first; these
 * scorers then rank and rank-trim them the way a blind user needs them read
 * back: best name match first, one candidate per phone number.
 */

export type ContactCandidate = {
  /** Stable per-phone candidate id (contact id + number), for the HUD. */
  id: string;
  name: string;
  phone: string;
};

/** Candidate cap: a spoken choice list longer than four is unusable by ear. */
export const MAX_SPOKEN_CANDIDATES = 4;

/**
 * Normalizes a Ghana phone number to local 0XXXXXXXXX. Returns null for
 * numbers too short to be dialable — email-only or junk rows are skipped.
 */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/\D/g, '');
  let local = cleaned;
  if (local.startsWith('233')) local = `0${local.slice(3)}`;
  if (local.length > 10) local = `0${local.slice(-9)}`;
  if (local.length < 9) return null;
  return local;
}

/**
 * Ranks one folded contact name against the folded spoken query.
 *
 * 4 exact full name · 3 whole first-name/surname token · 2 name starts with
 * the query · 1 query appears inside the name · 0 no match.
 */
export function scoreContactName(foldedName: string, foldedQuery: string): number {
  if (foldedName.length === 0 || foldedQuery.length === 0) return 0;
  if (foldedName === foldedQuery) return 4;
  if (foldedName.split(' ').includes(foldedQuery)) return 3;
  if (foldedName.startsWith(foldedQuery)) return 2;
  if (foldedName.includes(foldedQuery)) return 1;
  return 0;
}

/**
 * Deduplicates and ranks raw (name, phone) rows against the folded query.
 *
 * One row per distinct name+number pair — a contact with two numbers is TWO
 * spoken candidates, because the number is what actually receives the money.
 * Ambiguity is never resolved silently: equal-rank ties keep address-book
 * order, and anything past the spoken cap is dropped rather than mumbled.
 */
export function rankContactRows(
  rows: readonly { id: string; name: string; phone: string }[],
  query: string,
): ContactCandidate[] {
  const foldedQuery = fold(query);
  if (foldedQuery.length === 0) return [];

  const seen = new Set<string>();
  const scored: { candidate: ContactCandidate; rank: number }[] = [];
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (phone == null) continue;
    const key = `${fold(row.name)}|${phone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rank = scoreContactName(fold(row.name), foldedQuery);
    if (rank === 0) continue;
    scored.push({ candidate: { id: row.id, name: row.name.trim(), phone }, rank });
  }

  scored.sort(
    (a, b) =>
      b.rank - a.rank ||
      a.candidate.name.localeCompare(b.candidate.name) ||
      a.candidate.phone.localeCompare(b.candidate.phone),
  );
  return scored.slice(0, MAX_SPOKEN_CANDIDATES).map((entry) => entry.candidate);
}

/**
 * Voice choice parser for the disambiguation step: "1", "two", "second",
 * "mmienu", "eve"… Returns a 1-based index or null when nothing spoken
 * resolves to one of the offered choices.
 */
export function parseSpokenChoice(transcript: string, choiceCount: number): number | null {
  if (choiceCount <= 0) return null;
  const words = fold(transcript).split(' ').filter(Boolean);
  const ORDINALS: Record<string, number> = {
    first: 1, one: 1, '1': 1,
    second: 2, two: 2, '2': 2,
    third: 3, three: 3, '3': 3,
    fourth: 4, four: 4, '4': 4,
    // Twi + Ewe digit words (same vocabulary the flows already accept).
    koro: 1, mmienu: 2, mmensa: 3, mmiesa: 3, enan: 4,
    deka: 1, eve: 2, eto: 3, ene: 4, ato: 5,
  };
  for (const word of words) {
    const ordinal = ORDINALS[word];
    if (ordinal != null && ordinal <= choiceCount) return ordinal;
  }
  // A bare numeral anywhere in the answer ("the 2nd one").
  const numeral = fold(transcript).match(/\d/);
  if (numeral != null) {
    const choice = Number(numeral[0]);
    if (choice >= 1 && choice <= choiceCount) return choice;
  }
  return null;
}

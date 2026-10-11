import { Contact, ContactField, requestPermissionsAsync, getPermissionsAsync } from 'expo-contacts';

import {
  rankContactRows,
  type ContactCandidate,
} from './contactMatch';

/**
 * Device contacts access for spoken recipient lookup (Phase 3).
 *
 * Privacy boundary, per the build plan: least-privilege READ access only,
 * requested at the moment a send flow (or onboarding) first needs it, and the
 * entire lookup runs on-device — names and numbers are matched locally and
 * never leave the phone, never reach the speech gateway, and are never logged.
 *
 * SDK 57 note: the modern top-level permission functions are used
 * (`expo-contacts` exports them directly); `Contact.getAllDetails` is the
 * optimized bulk fetch that avoids building full Contact instances.
 */

export type ContactsPermission = 'granted' | 'denied' | 'permanent' | 'unavailable';

export async function getContactsPermission(): Promise<ContactsPermission> {
  try {
    const status = await getPermissionsAsync();
    if (status.granted) return 'granted';
    if (status.canAskAgain === false) return 'permanent';
    return 'denied';
  } catch {
    return 'unavailable';
  }
}

/** Asks the OS permission dialog (resolves without prompting when granted). */
export async function requestContactsPermission(): Promise<ContactsPermission> {
  try {
    const status = await requestPermissionsAsync();
    if (status.granted) return 'granted';
    if (status.canAskAgain === false) return 'permanent';
    return 'denied';
  } catch {
    return 'unavailable';
  }
}

/** Fallback scan size when the native name filter finds nothing — our fold is
 * more forgiving than the platform's contains() match, so a second pass over
 * a bounded window of the address book still runs entirely on-device. */
const BROAD_SCAN_LIMIT = 400;

/**
 * Looks up a spoken name and returns up to four spoken candidates, one per
 * distinct phone number. Empty result means "no one by that name" — the flow
 * then asks for the number instead (never a silent dead end).
 */
export async function lookupContacts(query: string): Promise<ContactCandidate[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const rows: { id: string; name: string; phone: string }[] = [];

  const collect = (details: AsyncIterableResultShape): void => {
    for (const detail of details) {
      const name = detail.fullName ?? '';
      if (name.trim().length === 0) continue;
      for (const phone of detail.phones ?? []) {
        if (phone.number == null || phone.number.length === 0) continue;
        rows.push({ id: `${detail.id}:${phone.id}`, name, phone: phone.number });
      }
    }
  };

  try {
    collect(
      (await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES], {
        name: trimmed,
        limit: 25,
      })) as AsyncIterableResultShape,
    );
    if (rows.length === 0) {
      collect(
        (await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES], {
          limit: BROAD_SCAN_LIMIT,
        })) as AsyncIterableResultShape,
      );
    }
  } catch {
    // Permission revoked mid-session, or the provider crashed: an empty
    // result sends the flow down the manual-number path, never a dead end.
    return [];
  }

  return rankContactRows(rows, trimmed);
}

/** The bulk-fetch row shape getAllDetails resolves to (fields projection). */
type AsyncIterableResultShape = {
  id: string;
  fullName: string | null;
  phones?: { id: string; number?: string | null }[];
}[];

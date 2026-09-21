import type { TFunction } from 'i18next';

/**
 * Maps a transaction failure reason code from the transactions service to a
 * localized, screen-reader-friendly message. Unknown codes fall back to a
 * generic message so raw enum values never leak into the UI or speech.
 */
export function localizedFailureReason(t: TFunction, reason?: string): string {
  if (reason === 'network') return t('send.failureNetwork');
  if (reason === 'insufficient_funds') return t('send.failureFunds');
  return t('send.failureGeneric');
}

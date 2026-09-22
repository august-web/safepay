/**
 * Remembers the last thing SikaVoice said.
 *
 * Lives in its own module so both the announcer and the TTS service can record
 * into it without an import cycle, and so a spoken "repeat" command replays
 * whatever the user last heard - an announcement or a TTS read-back.
 *
 * `clipKey` is carried alongside the text so repeating a phrase that has a
 * native voice clip plays the clip again instead of dropping to device TTS.
 */
let lastSpokenMessage: string | null = null;
let lastSpokenClipKey: string | null = null;

export function rememberSpoken(message: string, clipKey?: string): void {
  const trimmed = message.trim();
  if (trimmed.length === 0) return;
  lastSpokenMessage = trimmed;
  lastSpokenClipKey = clipKey ?? null;
}

export function lastSpoken(): string | null {
  return lastSpokenMessage;
}

export function lastSpokenClip(): string | null {
  return lastSpokenClipKey;
}

export function clearSpokenHistory(): void {
  lastSpokenMessage = null;
  lastSpokenClipKey = null;
}

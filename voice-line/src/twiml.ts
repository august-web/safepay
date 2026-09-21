/**
 * Minimal TwiML (VoiceResponse) builder for the IVR webhook handlers.
 * Matches the response shape used in the dev brief's Arkesel webhook
 * examples: <Response> containing <Say>, <Gather> (DTMF or speech),
 * <Redirect> and <Hangup/>.
 */

export interface GatherOptions {
  numDigits?: number;
  timeout?: number;
  action?: string;
  method?: 'POST';
  input?: 'dtmf' | 'speech' | 'dtmf speech';
  speechTimeout?: number;
  language?: string;
}

export interface SayOptions {
  language?: string;
  voice?: 'male' | 'female';
}

export const TWIML_CONTENT_TYPE = 'text/xml; charset=utf-8';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function attrsToString(attrs: Record<string, string | number | undefined>): string {
  return Object.entries(attrs)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join('');
}

export class VoiceResponse {
  private readonly parts: string[] = [];

  say(text: string, options: SayOptions = {}): this {
    const attrs = attrsToString({ language: options.language, voice: options.voice });
    this.parts.push(`<Say${attrs}>${escapeXml(text)}</Say>`);
    return this;
  }

  /** <Gather> with a nested <Say> prompt, per the brief's webhook examples. */
  gather(options: GatherOptions, prompt: string, promptOptions: SayOptions = {}): this {
    const sayAttrs = attrsToString({ language: promptOptions.language, voice: promptOptions.voice });
    const gatherAttrs = attrsToString({
      numDigits: options.numDigits,
      timeout: options.timeout,
      action: options.action,
      method: options.method,
      input: options.input,
      speechTimeout: options.speechTimeout,
      language: options.language,
    });
    this.parts.push(
      `<Gather${gatherAttrs}><Say${sayAttrs}>${escapeXml(prompt)}</Say></Gather>`,
    );
    return this;
  }

  redirect(url: string): this {
    this.parts.push(`<Redirect>${escapeXml(url)}</Redirect>`);
    return this;
  }

  hangup(): this {
    this.parts.push('<Hangup/>');
    return this;
  }

  toString(): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${this.parts.join('')}</Response>`;
  }
}

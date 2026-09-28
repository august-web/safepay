#!/usr/bin/env node

/**
 * Smoke-test the University of Ghana HCI Lab speech gateway.
 *
 * Phase II screening requires ASR/TTS to run through the lab's APIs. This
 * script proves the loop before any app code depends on it: for each language
 * it asks the TTS endpoint for one short command phrase, saves the WAV, then
 * feeds that WAV back into the ASR endpoint and checks the returned
 * transcript still matches the expected voice command from
 * `src/voice/commands.ts` (mirrored below - keep the two in step).
 *
 * `--batch <lang>` rehearses the voice-pack re-render plan: several real pack
 * phrases go out in ONE request (joined with ". "), then the reply is split
 * on the silences the model leaves between sentences and each segment is
 * ASR-verified. The whole pack is 181 clips / ~4.5k characters per language,
 * which only fits the weekly TTS quota as ~21 batched requests, so this
 * split has to work before the re-render spends quota on it.
 *
 * The API key is read from the repo-root `.env` (EXPO_PUBLIC_SPEECH_API_KEY)
 * and is never printed. Fill the key in yourself; do not paste it anywhere
 * else.
 *
 * Usage:
 *   node scripts/hci-lab-smoke.mjs             # Twi, Ewe and Ga round-trip
 *   node scripts/hci-lab-smoke.mjs tw ee       # only the named languages
 *   node scripts/hci-lab-smoke.mjs en          # opt-in English probe
 *   node scripts/hci-lab-smoke.mjs --batch tw  # batched request + silence split
 *
 * Quota note (free plan): TTS 15/day, ASR 10/day, and 5 requests/minute.
 * A full language round-trip run costs 3 TTS + 3 ASR; one --batch run costs
 * 1 TTS + 3 ASR. The script paces itself under the per-minute limit.
 *
 * Rendered WAVs land in a temp directory (path printed at the end) so they
 * can be listened to with human ears too.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();

function readEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(`No .env at ${envPath}. Copy .env.example to .env and paste the lab key in yourself.`);
  }
  const values = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match == null) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

let env;
try {
  env = readEnv();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const apiKey = env.EXPO_PUBLIC_SPEECH_API_KEY;
const DEFAULT_BASE_URL = 'https://lab-subscription-platform.vercel.app';

/** The .env.example placeholder is not a URL; treat any non-URL value as unset. */
function resolveBaseUrl(raw) {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/.+/.test(value) ? value : DEFAULT_BASE_URL;
}
const baseUrl = resolveBaseUrl(env.EXPO_PUBLIC_SPEECH_API_BASE_URL);
if (baseUrl !== DEFAULT_BASE_URL) console.log(`Base URL overridden: ${baseUrl}`);

if (apiKey == null || apiKey === '' || apiKey.includes('your_hci_lab')) {
  console.error('EXPO_PUBLIC_SPEECH_API_KEY is not set in .env.');
  console.error('Open .env and paste the key from the HCI Lab dashboard next to EXPO_PUBLIC_SPEECH_API_KEY=, then re-run.');
  process.exit(1);
}

/**
 * One phrase per language, each a real command from src/voice/commands.ts.
 * English support is undocumented by the lab, so `en` only runs when named.
 */
const LANGUAGE_CASES = [
  { lang: 'tw', phrase: 'kyerɛ me sika', expects: 'balance', default: true },
  { lang: 'ee', phrase: 'ɖo ga', expects: 'send', default: true },
  { lang: 'ga', phrase: 'mi shika', expects: 'balance', default: true },
  { lang: 'en', phrase: 'check my balance', expects: 'balance', default: false },
];

/** Keys from the real clip pack, chosen to cover words and full sentences. */
const BATCH_KEYS = ['num.20', 'money.cedis', 'vcmd.transactionComplete'];

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const batchIndex = args.indexOf('--batch');
const batchLang = batchIndex === -1 ? null : (args[batchIndex + 1] ?? 'tw');
const wanted = args.filter((arg) => arg !== '--batch' && arg !== batchLang);

if (batchLang != null && !fs.existsSync(path.join(root, 'src', 'i18n', 'locales', `${batchLang}.json`))) {
  console.error(`No locale file for --batch ${batchLang} (looked for src/i18n/locales/${batchLang}.json).`);
  process.exit(1);
}

const cases = batchLang != null
  ? []
  : wanted.length === 0
    ? LANGUAGE_CASES.filter((c) => c.default)
    : LANGUAGE_CASES.filter((c) => wanted.includes(c.lang));
if (batchLang == null && cases.length === 0) {
  console.error(`No matching languages. Known: ${LANGUAGE_CASES.map((c) => c.lang).join(', ')}`);
  process.exit(1);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hci-lab-smoke-'));

/** Free plan allows 5 requests/minute; pace to stay under it. */
const requestTimes = [];
async function rateLimit() {
  const now = Date.now();
  while (requestTimes.length > 0 && now - requestTimes[0] > 60_000) requestTimes.shift();
  if (requestTimes.length >= 5) {
    const waitMs = 60_000 - (now - requestTimes[0]) + 250;
    console.log(`  (rate limit: waiting ${(waitMs / 1000).toFixed(1)}s before the next request)`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  requestTimes.push(Date.now());
}

async function readError(res) {
  try {
    const body = await res.json();
    const code = body?.error?.code ?? 'unknown';
    const message = body?.error?.message ?? res.statusText;
    const requestId = body?.request_id != null ? ` (request_id ${body.request_id})` : '';
    return `${res.status} ${code}: ${message}${requestId}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

async function tts(phrase, label = phrase.replace(/[^\w]+/g, '-')) {
  await rateLimit();
  const res = await fetch(`${baseUrl}/api/v1/tts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: phrase, model_type: 'ss', speaker: 'PT' }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('audio')) {
    throw new Error(`expected audio, got ${contentType}: ${(await res.text()).slice(0, 200)}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const wavPath = path.join(outDir, `${label}.wav`);
  fs.writeFileSync(wavPath, bytes);
  return {
    wavPath,
    bytes: bytes.length,
    durationSec: res.headers.get('x-duration-sec'),
    sampleRate: res.headers.get('x-sample-rate'),
  };
}

async function asr(wavPath) {
  await rateLimit();
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' }), path.basename(wavPath));
  const res = await fetch(`${baseUrl}/api/v1/asr`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = await res.text();
  let transcript = null;
  try {
    const json = JSON.parse(body);
    transcript = json.transcript ?? json.text ?? json.result?.transcript ?? json.data?.transcript ?? null;
    if (transcript == null) transcript = `(unrecognised response shape: ${body.slice(0, 200)})`;
  } catch {
    transcript = body;
  }
  return { transcript };
}

// --- shared matching helpers (mirrors of src/voice/commands.ts) ---

/** Mirror of fold() in src/voice/commands.ts - keep in step. */
function fold(text) {
  return String(text ?? '')
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

/** Mini subset of COMMAND_PATTERNS covering the test phrases. */
const MATCH_PHRASES = {
  balance: ['check my balance', 'my balance', 'me sika a aka', 'kyere me sika', 'me sika', 'sika', 'mi shika', 'shika'],
  send: ['koma sika', 'soma sika', 'do ga'],
};

function matchIntent(transcript) {
  const text = fold(transcript);
  let best = null;
  for (const [intent, phrases] of Object.entries(MATCH_PHRASES)) {
    for (const phrase of phrases) {
      if (` ${text} `.includes(` ${phrase} `) && (best == null || phrase.length > best.length)) {
        best = { intent, length: phrase.length };
      }
    }
  }
  return best?.intent ?? null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Exact words first, then the bounded edit-distance rule the app uses. */
function segmentVerdict(transcript, expected) {
  const heard = fold(transcript);
  const want = fold(expected);
  if (want !== '' && ` ${heard} `.includes(` ${want} `)) return { pass: true, how: 'exact words' };
  const edits = levenshtein(heard, want);
  const tolerance = Math.max(2, Math.round(want.length * 0.34));
  return { pass: edits <= tolerance, how: `${edits} edits, tolerance ${tolerance}` };
}

// --- batch wav helpers (rehearsal for the pack re-render) ---

function parseWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('TTS reply is not a RIFF/WAVE file');
  }
  let fmt = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = buffer.subarray(offset + 8, Math.min(offset + 8 + size, buffer.length));
    if (id === 'fmt ') {
      fmt = {
        audioFormat: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bitsPerSample: body.readUInt16LE(14),
      };
    } else if (id === 'data') {
      data = body;
    }
    offset += 8 + size + (size % 2);
  }
  if (fmt == null || data == null) throw new Error('WAV is missing its fmt or data chunk');
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`expected 16-bit PCM, got format ${fmt.audioFormat} at ${fmt.bitsPerSample} bits`);
  }
  return { ...fmt, pcm: data };
}

const FRAME_MS = 10;

/** 10 ms frame peaks; frames below the floor count as silence. */
function silenceRuns(wav) {
  const frameSamples = Math.max(1, Math.round((wav.sampleRate * FRAME_MS) / 1000));
  const frameBytes = frameSamples * wav.channels * 2;
  const frames = [];
  let globalPeak = 0;
  for (let offset = 0; offset + frameBytes <= wav.pcm.length; offset += frameBytes) {
    let peak = 0;
    for (let i = offset; i < offset + frameBytes; i += 2) {
      const value = Math.abs(wav.pcm.readInt16LE(i));
      if (value > peak) peak = value;
    }
    if (peak > globalPeak) globalPeak = peak;
    frames.push(peak);
  }
  const floor = Math.max(Math.round(0.02 * 32767), Math.round(0.03 * globalPeak));
  const runs = [];
  let runStart = -1;
  for (let i = 0; i <= frames.length; i += 1) {
    const silent = i < frames.length && frames[i] < floor;
    if (silent && runStart === -1) runStart = i;
    if (!silent && runStart !== -1) {
      runs.push({ start: runStart * frameSamples, end: i * frameSamples, ms: (i - runStart) * FRAME_MS });
      runStart = -1;
    }
  }
  return { runs, frames, frameSamples, floor };
}

function totalSamples(wav) {
  return Math.floor(wav.pcm.length / (wav.channels * 2));
}

/** Trims leading/trailing silence of a segment, keeping a 30 ms pad. */
function trimRange(analysis, fromSample, toSample) {
  const { frames, frameSamples, floor } = analysis;
  const first = Math.ceil(fromSample / frameSamples);
  const last = Math.floor(toSample / frameSamples);
  let start = -1;
  let end = -1;
  for (let i = first; i < last && i < frames.length; i += 1) {
    if (frames[i] >= floor) {
      if (start === -1) start = i;
      end = i;
    }
  }
  if (start === -1) return { start: fromSample, end: toSample };
  const pad = Math.round(frameSamples * 3);
  return { start: Math.max(fromSample, start * frameSamples - pad), end: Math.min(toSample, (end + 1) * frameSamples + pad) };
}

/** Writes a 16-bit PCM slice as a standalone WAV. */
function writeWav(filePath, wav, fromSample, toSample) {
  const bytesPerFrame = wav.channels * 2;
  const pcm = wav.pcm.subarray(fromSample * bytesPerFrame, toSample * bytesPerFrame);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(wav.channels, 22);
  header.writeUInt32LE(wav.sampleRate, 24);
  header.writeUInt32LE(wav.sampleRate * bytesPerFrame, 28);
  header.writeUInt16LE(bytesPerFrame, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
  return pcm.length + 44;
}

function lookupLocaleText(locale, key) {
  let node = locale;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object' || !(part in node)) return null;
    node = node[part];
  }
  return typeof node === 'string' ? node : null;
}

// --- end batch wav helpers ---

async function runBatch(lang) {
  const locale = JSON.parse(fs.readFileSync(path.join(root, 'src', 'i18n', 'locales', `${lang}.json`), 'utf8'));
  const phrases = BATCH_KEYS
    .map((key) => ({ key, text: lookupLocaleText(locale, key) }))
    .filter((p) => p.text != null && p.text.trim() !== '');
  if (phrases.length < 2) {
    console.error(`[batch ${lang}] needs 2+ of ${BATCH_KEYS.join(', ')} in the locale; found ${phrases.length}.`);
    return false;
  }

  const joined = phrases.map((p) => p.text).join('. ');
  console.log(`[batch ${lang}] one request, ${phrases.length} phrases, ${joined.length} chars:`);
  for (const p of phrases) console.log(`  ${p.key}: "${p.text}"`);
  if (joined.length > 250) {
    console.error(`  joined text is ${joined.length} chars - over the 250-char request limit`);
    return false;
  }

  const spoken = await tts(joined, `batch-${lang}`);
  console.log(`  TTS ok: ${spoken.bytes} bytes, ${spoken.durationSec ?? '?'}s at ${spoken.sampleRate ?? '?'} Hz -> ${spoken.wavPath}`);

  const wav = parseWav(fs.readFileSync(spoken.wavPath));
  const analysis = silenceRuns(wav);
  const samples = totalSamples(wav);
  const describe = (r) => `${(r.ms / 1000).toFixed(2)}s at ${(r.start / wav.sampleRate).toFixed(2)}s`;
  console.log(`  ${(samples / wav.sampleRate).toFixed(2)}s decoded; ${analysis.runs.length} silent runs >=${FRAME_MS}ms: ${analysis.runs.map(describe).join(', ') || 'none'}`);

  const internal = analysis.runs.filter((r) => r.start > 0 && samples - r.end > analysis.frameSamples);
  const chosen = internal.slice().sort((a, b) => b.ms - a.ms).slice(0, phrases.length - 1).sort((a, b) => a.start - b.start);
  if (chosen.length < phrases.length - 1) {
    console.error(`  split FAIL: ${chosen.length} internal gaps for ${phrases.length} phrases. Fallbacks: longer separators, a quota bump from dcshcilab, or per-phrase requests spread over weeks.`);
    return false;
  }
  console.log(`  splitting on: ${chosen.map(describe).join(', ')}`);

  const cuts = chosen.map((r) => Math.round((r.start + r.end) / 2));
  const bounds = [0, ...cuts, samples];
  for (let i = 0; i < phrases.length; i += 1) {
    const trimmed = trimRange(analysis, bounds[i], bounds[i + 1]);
    const segmentPath = path.join(outDir, `batch-${lang}-${i + 1}.wav`);
    writeWav(segmentPath, wav, trimmed.start, trimmed.end);
    const seconds = (trimmed.end - trimmed.start) / wav.sampleRate;
    const heard = await asr(segmentPath);
    const verdict = segmentVerdict(heard.transcript, phrases[i].text);
    console.log(`  seg ${i + 1} (${seconds.toFixed(2)}s): want "${phrases[i].text}" heard "${heard.transcript}" -> ${verdict.pass ? 'PASS' : 'CHECK'} (${verdict.how})`);
  }
  return true;
}

if (batchLang != null) {
  let ok = false;
  try {
    ok = await runBatch(batchLang);
  } catch (error) {
    console.error(`  FAIL: ${error.message}`);
  }
  console.log(`\n=== --batch ${batchLang}: ${ok ? 'PASS (segments are separable)' : 'FAIL'} ===`);
  if (!ok) process.exitCode = 1;
} else {
  const results = [];
  for (const testCase of cases) {
    console.log(`\n[${testCase.lang}] "${testCase.phrase}" (expects: ${testCase.expects})`);
    try {
      const spoken = await tts(testCase.phrase);
      console.log(`  TTS ok: ${spoken.bytes} bytes, ${spoken.durationSec ?? '?'}s at ${spoken.sampleRate ?? '?'} Hz -> ${spoken.wavPath}`);
      const heard = await asr(spoken.wavPath);
      const intent = matchIntent(heard.transcript);
      const pass = intent === testCase.expects;
      console.log(`  ASR ok: heard "${heard.transcript}" -> ${intent ?? 'no match'} ${pass ? 'PASS' : 'FAIL'}`);
      results.push({ ...testCase, transcript: heard.transcript, intent, pass, wavPath: spoken.wavPath });
    } catch (error) {
      console.log(`  FAIL: ${error.message}`);
      results.push({ ...testCase, transcript: null, intent: null, pass: false });
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} languages round-trip cleanly ===`);
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.lang}  expects ${r.expects}, heard ${r.intent ?? 'nothing'}`);
  }
  if (passed !== results.length) process.exitCode = 1;
}

console.log(`WAVs saved in ${outDir} - listen before trusting the transcript alone.`);

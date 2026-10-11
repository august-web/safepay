#!/usr/bin/env node

/**
 * Evaluate ASR transcripts without changing the production recognizer.
 *
 * Usage:
 *   node scripts/asr-evaluation.mjs
 *   node scripts/asr-evaluation.mjs path/to/model-output.json
 *
 * Model output is an array of objects with the same `id` as the cases file and
 * a recognized `transcript` field. The default input uses the reference text
 * and is only a parser/matcher smoke test; it is not an ASR accuracy claim.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const casesPath = path.join(root, 'scripts', 'asr-evaluation-cases.json');
const outputPath = process.argv[2] ?? null;
const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const outputs = outputPath == null
  ? cases.map((item) => ({ id: item.id, transcript: item.reference }))
  : JSON.parse(fs.readFileSync(path.resolve(outputPath), 'utf8'));
const outputById = new Map(outputs.map((item) => [item.id, item]));

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

// Mirror of src/voice/flowParse.ts `destutter` (declared below, next to the
// digit vocabulary it guards): the production pipeline runs every transcript
// through this collapse (VoiceCommandProvider.handleTranscript) before
// matching, so the harness must too. Digit tokens never collapse — a repeated
// digit inside a phone number must survive verbatim.
function isDigitToken(word) {
  const w = String(word ?? '').trim().toLowerCase();
  if (w.length === 0) return false;
  if (/^\d+([.,]\d+)?$/.test(w)) return true;
  return digitTokens.has(w);
}

function destutter(transcript) {
  const kept = [];
  for (const word of String(transcript ?? '').split(/\s+/).filter(Boolean)) {
    const prev = kept[kept.length - 1];
    const prevFold = prev != null ? fold(prev) : '';
    const wordFold = fold(word);
    if (
      prev != null &&
      prevFold.length > 0 &&
      wordFold.length > 0 &&
      prevFold === wordFold &&
      !isDigitToken(prev) &&
      !isDigitToken(word)
    ) {
      continue;
    }
    kept.push(word);
  }
  return kept.join(' ');
}

const commandPatterns = [
  ['balance', ['check my balance', 'my balance', 'my money', 'me sika a aka', 'me sika', 'mi shika']],
  ['send', ['send money', 'send', 'transfer', 'kɔma sika', 'koma sika', 'soma sika', 'ɖo ga', 'do ga']],
  ['airtime', ['airtime', 'buy airtime', 'buy data', 'top up']],
  ['cashout', ['cash out', 'cashout', 'withdraw', 'yi sika', 'twe sika']],
  ['statement', ['statement', 'history', 'sika krataa']],
  ['stop', ['stop', 'cancel', 'gyae', 'dzo da', 'dzo ɖa']],
];

function matchIntent(text) {
  const normalized = fold(text);
  let best = null;
  for (const [intent, phrases] of commandPatterns) {
    for (const phrase of phrases) {
      const candidate = fold(phrase);
      if (` ${normalized} `.includes(` ${candidate} `) && (best == null || candidate.length > best.length)) {
        best = { intent, length: candidate.length };
      }
    }
  }
  return best?.intent ?? null;
}

// Mirror of src/voice/commands.ts matchVoiceIntent passes 2-3: same-word-count
// edit tolerance, then the compact-form rescue (degraded audio drops phonemes
// and fuses words: "kɔma sika" → "ɔma si" / "oamase"). Kept in lockstep with
// the production thresholds so the harness verdicts stay meaningful.
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

const compactPatterns = commandPatterns
  .filter(([intent]) => intent !== 'stop')
  .map(([intent, phrases]) => [intent, phrases.map((p) => fold(p).replace(/ /g, ''))]);

function matchIntentFuzzy(text) {
  const exact = matchIntent(text);
  if (exact != null) return exact;

  const words = text.split(' ').filter(Boolean);
  const utteranceWords = words.length;
  let fuzzyBest = null;
  if (utteranceWords > 0 && utteranceWords <= 3) {
    const maxEdits = utteranceWords === 1 ? 2 : utteranceWords === 2 ? 3 : 4;
    for (const [intent, phrases] of commandPatterns) {
      for (const phrase of phrases) {
        const folded = fold(phrase);
        if (folded.split(' ').filter(Boolean).length !== utteranceWords) continue;
        const edits = levenshtein(text, folded);
        if (edits <= maxEdits && (fuzzyBest == null || edits < fuzzyBest.edits)) {
          fuzzyBest = { intent, edits };
        }
      }
    }
    if (fuzzyBest != null) return fuzzyBest.intent;

    const compact = text.replace(/ /g, '');
    if (compact.length >= 4) {
      let compactBest = null;
      for (const [intent, phrases] of compactPatterns) {
        for (const foldedCompact of phrases) {
          if (foldedCompact.length < 5) continue;
          const lcs = lcsLength(compact, foldedCompact);
          const shorter = Math.min(compact.length, foldedCompact.length);
          if (lcs < 4 || lcs < 0.6 * shorter) continue;
          const score = lcs / shorter;
          const coverage = lcs / foldedCompact.length;
          if (
            compactBest == null ||
            score > compactBest.score ||
            (score === compactBest.score && coverage > compactBest.coverage)
          ) {
            compactBest = { intent, score, coverage };
          }
        }
      }
      if (compactBest != null) return compactBest.intent;
    }
  }
  return null;
}

function lcsLength(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [0];
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[b.length];
}

const numberWords = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  aduonu: 20, aduasa: 30, aduanan: 40, aduonum: 50,
};

const digitTokens = new Set(Object.keys(numberWords));

function extractAmount(text) {
  const digit = String(text).match(/\b\d+(?:\.\d+)?\b/);
  if (digit != null) return Number(digit[0]);
  const words = fold(text).split(' ');
  for (const word of words) {
    if (numberWords[word] != null) return numberWords[word];
  }
  return null;
}

function extractPhone(text) {
  const normalized = fold(text);
  const digits = normalized.match(/\d{10,12}/)?.[0];
  if (digits != null) return digits.length > 10 ? `0${digits.slice(-9)}` : digits;
  const spoken = normalized.split(' ').filter((word) => numberWords[word] != null);
  if (spoken.length < 9) return null;
  const sequence = spoken.map((word) => numberWords[word]).join('');
  return sequence.length === 10 ? sequence : null;
}

function evaluate(item, output) {
  const transcript = destutter(output?.transcript ?? '');
  const checks = [];
  if (item.expectedIntent != null) checks.push(matchIntentFuzzy(transcript) === item.expectedIntent);
  if (item.expectedAmount != null) checks.push(extractAmount(transcript) === item.expectedAmount);
  if (item.expectedPhone != null) checks.push(extractPhone(transcript) === item.expectedPhone);
  if (item.expectedConfirmation != null) {
    const normalized = fold(transcript);
    const yes = ['yes', 'aane', 'ɛ̃'].includes(normalized);
    const no = ['no', 'dabi', 'ave'].includes(normalized);
    checks.push(item.expectedConfirmation ? yes : no);
  }
  return {
    id: item.id,
    language: item.language,
    transcript,
    passed: checks.length > 0 && checks.every(Boolean),
    recognizedIntent: matchIntentFuzzy(transcript),
    amount: extractAmount(transcript),
    phone: extractPhone(transcript),
  };
}

const results = cases.map((item) => evaluate(item, outputById.get(item.id)));
const passed = results.filter((item) => item.passed).length;
const report = {
  source: outputPath ?? 'reference smoke transcripts',
  total: results.length,
  passed,
  failed: results.length - passed,
  accuracy: results.length === 0 ? 0 : Number((passed / results.length).toFixed(4)),
  results,
};

console.log(JSON.stringify(report, null, 2));
if (report.failed > 0) process.exitCode = 1;

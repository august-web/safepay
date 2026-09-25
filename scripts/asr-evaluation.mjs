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

const numberWords = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  aduonu: 20, aduasa: 30, aduanan: 40, aduonum: 50,
};

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
  const transcript = output?.transcript ?? '';
  const checks = [];
  if (item.expectedIntent != null) checks.push(matchIntent(transcript) === item.expectedIntent);
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
    recognizedIntent: matchIntent(transcript),
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

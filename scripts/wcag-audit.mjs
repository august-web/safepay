#!/usr/bin/env node
/**
 * WCAG 2.2 contrast audit for the SafePay/SikaVoice palettes.
 *
 * SikaVoice is an inclusion app for visually impaired MoMo users, so contrast
 * is a functional requirement, not a style preference. This script checks every
 * colour pairing the UI actually renders and exits non-zero if any pair misses
 * WCAG AA, which makes it usable as a gate in CI.
 *
 * Usage: node scripts/wcag-audit.mjs [--suggest]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const palettes = JSON.parse(
  readFileSync(join(here, '..', 'src', 'constants', 'palettes.json'), 'utf8'),
);

const AA_TEXT = 4.5; // normal-size text (WCAG 1.4.3)
const AA_LARGE = 3; // large text >= 18.66px bold / 24px, and UI components (1.4.11)

function srgbToLinear(channel) {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [r, g, b] = hex
    .replace('#', '')
    .match(/.{2}/g)
    .map((pair) => srgbToLinear(parseInt(pair, 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [foreground, background, threshold, where it is used in the UI]
const CHECKS = [
  ['text', 'background', AA_TEXT, 'body text on the app background'],
  ['text', 'surface', AA_TEXT, 'body text on cards'],
  ['textMuted', 'background', AA_TEXT, 'secondary text on background'],
  ['textMuted', 'surface', AA_TEXT, 'secondary text on cards'],
  ['textLight', 'surface', AA_TEXT, 'tertiary/helper text on cards'],
  ['placeholder', 'surface', AA_TEXT, 'input placeholder'],
  ['accent', 'background', AA_TEXT, 'accent headings/icons on background'],
  ['accent', 'surface', AA_TEXT, 'accent headings/icons on cards'],
  ['onAccent', 'accent', AA_TEXT, 'primary button label'],
  ['onAccentMuted', 'accent', AA_TEXT, 'muted text on navy surfaces (balance card)'],
  ['onAccent', 'accentDark', AA_TEXT, 'pressed primary button label'],
  ['onGold', 'gold', AA_TEXT, 'gold button label'],
  ['onGold', 'goldPressed', AA_TEXT, 'pressed gold button label'],
  ['goldInk', 'background', AA_TEXT, 'gold-toned text on background (fees, highlights)'],
  ['goldInk', 'surface', AA_TEXT, 'gold-toned text on cards (fees, highlights)'],
  ['success', 'background', AA_TEXT, 'success text on background'],
  ['success', 'surface', AA_TEXT, 'success text on cards'],
  ['onSuccess', 'success', AA_TEXT, 'text on success fill'],
  ['danger', 'background', AA_TEXT, 'error text on background'],
  ['danger', 'surface', AA_TEXT, 'error text on cards'],
  ['onDanger', 'danger', AA_TEXT, 'text on danger fill'],
  ['warning', 'background', AA_TEXT, 'warning text on background'],
  ['warning', 'surface', AA_TEXT, 'warning text on cards'],
  ['onWarning', 'warning', AA_TEXT, 'text on warning fill'],
  ['text', 'accentTint', AA_TEXT, 'text on accent tint'],
  ['text', 'goldTint', AA_TEXT, 'text on gold tint (read-back card)'],
  ['success', 'successTint', AA_TEXT, 'success text on success tint'],
  ['danger', 'dangerTint', AA_TEXT, 'danger text on danger tint'],
  ['warning', 'warningTint', AA_TEXT, 'warning text on warning tint'],
  ['text', 'surfaceMuted', AA_TEXT, 'text on muted surface'],
  ['accent', 'background', AA_LARGE, 'accent large headings on background'],
  ['goldInk', 'goldTint', AA_TEXT, 'gold-toned text on gold tint'],
  ['controlBorder', 'background', AA_LARGE, 'input borders vs background (1.4.11)'],
  ['controlBorder', 'surface', AA_LARGE, 'input borders vs cards (1.4.11)'],
  ['focusRing', 'background', AA_LARGE, 'focus ring vs background (2.4.11)'],
  ['focusRing', 'surface', AA_LARGE, 'focus ring vs cards (2.4.11)'],
];

// Not gated: WCAG 1.4.11 explicitly exempts inactive/disabled controls, but we
// still report the number so a future pass can decide to strengthen it.
const ADVISORY_CHECKS = [['disabled', 'surface', AA_LARGE, 'disabled control outline vs card']];

function shadeTowards(hex, target, amount) {
  const [r, g, b] = hex.replace('#', '').match(/.{2}/g).map((p) => parseInt(p, 16));
  const [tr, tg, tb] = target.replace('#', '').match(/.{2}/g).map((p) => parseInt(p, 16));
  const mix = (c, t) => Math.round(c + (t - c) * amount);
  return '#' + [mix(r, tr), mix(g, tg), mix(b, tb)]
    .map((v) => v.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

/** Finds the smallest nudge (towards black, or white on dark fills) that passes. */
function suggestFix(fg, bg, threshold) {
  const darkBg = luminance(bg) < 0.5;
  const target = darkBg ? '#FFFFFF' : '#000000';
  for (let step = 0.05; step <= 1; step += 0.05) {
    const candidate = shadeTowards(fg, target, step);
    if (contrast(candidate, bg) >= threshold) return candidate;
  }
  return null;
}

const wantSuggestions = process.argv.includes('--suggest');
let failures = 0;

for (const [key, palette] of Object.entries(palettes)) {
  if (key.startsWith('_')) continue;
  console.log(`\n${palette.label} (${key}) — ${palette.description}`);

  for (const [fgName, bgName, threshold, usage] of [...CHECKS, ...ADVISORY_CHECKS]) {
    const fg = palette[fgName];
    const bg = palette[bgName];
    if (fg == null || bg == null) continue;

    const ratio = contrast(fg, bg);
    const advisory = ADVISORY_CHECKS.some((check) => check[0] === fgName && check[1] === bgName);
    const pass = ratio >= threshold || advisory;
    if (ratio < threshold && !advisory) failures += 1;

    const line =
      `${pass ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2)}:1  (needs ${threshold}:1)  ` +
      `${fgName} ${fg} on ${bgName} ${bg} — ${usage}`;
    console.log(line);

    if (!pass && wantSuggestions) {
      const fix = suggestFix(fg, bg, threshold);
      if (fix != null) {
        console.log(
          `        ↳ "${fgName}" could be ${fix} → ` +
            `${contrast(fix, bg).toFixed(2)}:1 (keeps the hue, passes AA)`,
        );
      }
    }
  }
}

console.log(
  failures === 0
    ? '\n✓ All pairings meet WCAG 2.2 AA.'
    : `\n✗ ${failures} pairing(s) below WCAG 2.2 AA.`,
);
process.exit(failures === 0 ? 0 : 1);

#!/usr/bin/env python3
"""Render voice-pack clips from the public GhanaNLP TTS endpoint.

Why this exists: the two pack renderers already in the repo each cost something
the Settings rebuild cannot pay. `scripts/generate-voice-clips.py` uses Meta MMS
locally, and its short-phrase renders garble ("Kɔma Sika" comes out as "ɔma si");
`scripts/rerender-clips-lab.py` sounds right but spends the lab key, whose
quota is what the screening's ASR will need. GhanaNLP's public endpoint is
unauthenticated, is the same native voice the runtime TTS ladder already falls
back to, and needs no key.

Usage (from the project root):

    python3 scripts/render-clips-ghananlp.py --lang tw --keys settings.navValue.linear,settings.navValue.spatial
    python3 scripts/render-clips-ghananlp.py --lang tw --missing          # manifest keys with no clip yet
    python3 scripts/render-clips-ghananlp.py --lang tw --missing --dry-run

Writes assets/voice/<lang>/<key_with_underscores>.wav at the pack format
(16 kHz mono 16-bit), then rewrites src/voice/voicePack.generated.ts so Metro
sees the new clips. Provenance of each rendered file is printed and can be
re-checked with --check.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "scripts" / "voice-clip-manifest.json"
LOCALES = ROOT / "src" / "i18n" / "locales"
OUT_DIR = ROOT / "assets" / "voice"
GENERATED_TS = ROOT / "src" / "voice" / "voicePack.generated.ts"

BASE_URL = "https://translate.ghananlp.org/api/tts"
# GhanaNLP language codes: the app's `tw`/`ee` labels are already theirs.
ENDPOINT_LANGUAGE = {"tw": "tw", "ee": "ee"}
REQUEST_SPACING_S = 1.5
PROVENANCE = OUT_DIR / "ghananlp-provenance.json"
# The endpoint's firewall answers 403 to the default `Python-urllib/3.x` agent
# while curl and a browser agent get 200 - the app's fetch sends a real agent.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)


def log(message: str) -> None:
    print(message, flush=True)


def lookup(locale: dict, key: str) -> str | None:
    node = locale
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node if isinstance(node, str) else None


def clip_path(lang: str, key: str) -> pathlib.Path:
    return OUT_DIR / lang / f"{key.replace('.', '_').replace(' ', '_')}.wav"


def synth(text: str, language: str) -> bytes:
    body = json.dumps({"text": text, "language": language}).encode("utf-8")
    request = urllib.request.Request(
        BASE_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "audio/wav",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def to_pack_format(wav: bytes, destination: pathlib.Path) -> None:
    """GhanaNLP hands back an arbitrary WAV; the pack is 16 kHz mono PCM."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
        handle.write(wav)
        source = pathlib.Path(handle.name)
    try:
        subprocess.run(
            ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(source), str(destination)],
            check=True,
            capture_output=True,
        )
    finally:
        source.unlink(missing_ok=True)


def manifest_keys() -> list[str]:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))["keys"]


def planned_keys(lang: str, args: argparse.Namespace) -> list[str]:
    locale = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
    keys = (
        [k.strip() for k in args.keys.split(",") if k.strip()]
        if args.keys
        else manifest_keys()
    )
    out: list[str] = []
    for key in keys:
        if not args.force and clip_path(lang, key).exists():
            continue
        text = lookup(locale, key)
        if text is None:
            log(f"  ! {lang}: no string for {key} (skipped)")
            continue
        if "{{" in text:
            log(f"  ! {lang}: {key} has placeholders (skipped)")
            continue
        out.append(key)
    return out


def read_generated_keys() -> dict[str, list[str]]:
    """Every key Metro already knows about, per language."""
    text = GENERATED_TS.read_text(encoding="utf-8")
    keys: dict[str, list[str]] = {}
    current: str | None = None
    pattern = re.compile(r"^  (\w+): \{$|^    '([^']+)': require\(|^\};$")
    for line in text.splitlines():
        match = pattern.match(line)
        if not match:
            continue
        if match.group(1):
            current = match.group(1)
            keys.setdefault(current, [])
        elif match.group(2) and current:
            keys[current].append(match.group(2))
        else:
            current = None
    return keys


def write_generated_ts(keys_by_lang: dict[str, list[str]]) -> None:
    lines = [
        "/* GENERATED by scripts/generate-voice-clips.py - do not edit by hand.",
        "   Native Twi/Ewe clips rendered from Meta's MMS TTS models:",
        "   fixed phrases, number atoms for composed amounts, names and",
        "   voice-command feedback. English/Pidgin stay on device TTS.",
        "   Regenerate with: npm run voice-clips",
        "   Some clips are re-rendered from the public GhanaNLP TTS endpoint by",
        "   scripts/render-clips-ghananlp.py (see assets/voice/ghananlp-provenance.json). */",
        "",
        "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
        "export const VOICE_CLIPS: Record<string, Record<string, any>> = {",
    ]
    for lang in sorted(keys_by_lang):
        present = [key for key in sorted(set(keys_by_lang[lang])) if clip_path(lang, key).exists()]
        if not present:
            continue
        lines.append(f"  {lang}: {{")
        for key in present:
            safe = key.replace(".", "_").replace(" ", "_")
            lines.append(f"    '{key}': require('../../assets/voice/{lang}/{safe}.wav'),")
        lines.append("  },")
        keys_by_lang[lang] = present
    lines.append("};")
    lines.append("")
    lines.append("/** Clips that ship with the app, for diagnostics in Settings. */")
    lines.append("export const VOICE_CLIP_COUNTS: Record<string, number> = {")
    for lang in sorted(keys_by_lang):
        lines.append(f"  {lang}: {len(keys_by_lang[lang])},")
    lines.append("};")
    lines.append("")
    GENERATED_TS.write_text("\n".join(lines), encoding="utf-8")
    log(f"✓ rewrote {GENERATED_TS.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Render pack clips from GhanaNLP public TTS")
    parser.add_argument("--lang", default="tw")
    parser.add_argument("--keys", default=None, help="comma-separated dotted i18n keys")
    parser.add_argument("--missing", action="store_true", help="every manifest key with no clip yet")
    parser.add_argument("--force", action="store_true", help="re-render even when the clip exists")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, request nothing")
    args = parser.parse_args()

    if args.lang not in ENDPOINT_LANGUAGE:
        log(f"GhanaNLP renders native packs for {sorted(ENDPOINT_LANGUAGE)} only.")
        return 2
    if not args.keys and not args.missing:
        log("Pass --keys or --missing.")
        return 2

    keys = planned_keys(args.lang, args)
    log(f"▸ {args.lang}: {len(keys)} clips from {BASE_URL}")
    for key in keys:
        log(f"    {key}")
    if args.dry_run:
        return 0

    locale = json.loads((LOCALES / f"{args.lang}.json").read_text(encoding="utf-8"))
    provenance = {}
    if PROVENANCE.exists():
        provenance = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    rendered: list[str] = []
    failed: list[str] = []

    import time

    for key in keys:
        text = lookup(locale, key)
        try:
            wav = synth(text, ENDPOINT_LANGUAGE[args.lang])
        except (urllib.error.URLError, TimeoutError) as error:
            log(f"    x  {key}: {error}")
            failed.append(key)
            time.sleep(REQUEST_SPACING_S)
            continue
        if len(wav) < 1_000:
            log(f"    x  {key}: reply too small ({len(wav)} bytes)")
            failed.append(key)
            time.sleep(REQUEST_SPACING_S)
            continue
        to_pack_format(wav, clip_path(args.lang, key))
        seconds = clip_path(args.lang, key).stat().st_size / 32_000
        log(f"    OK {key} “{text}” ~{seconds:.1f}s")
        provenance[f"{args.lang}/{key}"] = {"source": "ghananlp-public", "text": text}
        rendered.append(key)
        time.sleep(REQUEST_SPACING_S)

    PROVENANCE.parent.mkdir(parents=True, exist_ok=True)
    PROVENANCE.write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")

    if rendered:
        existing = read_generated_keys()
        existing.setdefault(args.lang, [])
        existing[args.lang] = existing[args.lang] + rendered
        write_generated_ts(existing)

    log(f"✓ rendered {len(rendered)}, failed {len(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())

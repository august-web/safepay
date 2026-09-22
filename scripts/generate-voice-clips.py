#!/usr/bin/env python3
"""Generate native Ghanaian voice clips for SikaVoice.

Google's on-device TTS has no Akan, Ewe or Ga voices, so Twi and Ewe text was
being read by an English voice. Meta's MMS TTS models do cover these languages,
so the fixed phrases the user hears most are pre-rendered here and shipped in
the app as audio clips. Dynamic sentences (amounts, recipient names) still go
through device TTS.

Usage (from the project root):

    .tools/tts-venv/bin/python scripts/generate-voice-clips.py            # all languages
    .tools/tts-venv/bin/python scripts/generate-voice-clips.py --lang tw  # one language
    .tools/tts-venv/bin/python scripts/generate-voice-clips.py --check    # report only

The script writes:
  assets/voice/<lang>/<key>.wav     16 kHz mono 16-bit clips
  assets/voice/manifest.json        what was generated (duration, peak level)
  src/voice/voicePack.generated.ts  static require() map for Metro
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import struct
import sys
import wave

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "scripts" / "voice-clip-manifest.json"
LOCALES = ROOT / "src" / "i18n" / "locales"
OUT_DIR = ROOT / "assets" / "voice"
GENERATED_TS = ROOT / "src" / "voice" / "voicePack.generated.ts"

# MMS checkpoints are character-level models trained on lowercase text.
ALLOWED_CHARS = re.compile(r"[^a-zɛɔãɖƒŋʋ\u0300-\u036f ]+")


def load_manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def lookup(locale: dict, key: str) -> str | None:
    node = locale
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node if isinstance(node, str) else None


def normalise(text: str) -> str:
    """Lower-cases and strips anything the character model cannot read."""
    cleaned = ALLOWED_CHARS.sub(" ", text.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def write_wav(path: pathlib.Path, samples, sample_rate: int) -> dict:
    """Writes float samples as 16-bit PCM and returns peak/RMS levels."""
    import numpy as np

    array = np.asarray(samples, dtype="float32").reshape(-1)
    peak = float(np.max(np.abs(array))) if array.size else 0.0
    rms = float(np.sqrt(np.mean(array**2))) if array.size else 0.0
    if peak > 0:
        array = array / peak * 0.95  # normalise so clips are consistently loud
    pcm = (array * 32767.0).astype("<i2")

    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm.tobytes())

    return {
        "seconds": round(len(pcm) / sample_rate, 3),
        "peak": round(peak, 4),
        "rms": round(rms, 5),
        "bytes": path.stat().st_size,
    }


def synth_language(lang: str, model_id: str, keys: list[str], check_only: bool) -> dict:
    locale = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))

    # Missing strings are skipped loudly rather than silently producing silence.
    planned: list[tuple[str, str]] = []
    for key in keys:
        text = lookup(locale, key)
        if text is None:
            print(f"  ! {lang}: no string for {key} (skipped)")
            continue
        if "{{" in text:
            # Interpolated strings are dynamic by definition (an amount, a
            # recipient). They have no stable text to pre-render.
            print(f"  ! {lang}: {key} has placeholders (skipped)")
            continue
        spoken = normalise(text)
        if spoken == "":
            print(f"  ! {lang}: {key} has no speakable characters (skipped)")
            continue
        planned.append((key, spoken))

    print(f"▸ {lang} ({model_id}): {len(planned)} clips")
    if check_only:
        for key, spoken in planned:
            print(f"    {key}: {spoken[:70]}")
        return {}

    import torch
    from transformers import VitsModel, AutoTokenizer

    # A pre-downloaded copy in .tools/mms/<code> avoids re-fetching ~145MB per
    # language on a slow link; the Hub cache is used otherwise.
    local = ROOT / ".tools" / "mms" / model_id.split("mms-tts-")[-1]
    source = str(local) if (local / "model.safetensors").exists() else model_id
    print(f"    loading weights from {source}")

    torch.set_num_threads(max(1, (torch.get_num_threads() or 2) - 1))
    model = VitsModel.from_pretrained(source)
    tokenizer = AutoTokenizer.from_pretrained(source)
    model.eval()

    results: dict[str, dict] = {}
    for key, spoken in planned:
        inputs = tokenizer(spoken, return_tensors="pt")
        with torch.no_grad():
            waveform = model(**inputs).waveform[0]
        path = OUT_DIR / lang / f"{key.replace('.', '_')}.wav"
        info = write_wav(path, waveform.numpy(), model.config.sampling_rate)
        info["text"] = spoken
        results[key] = info
        flag = "OK " if info["rms"] > 0.01 else "SILENT!"
        print(f"    {flag} {key} {info['seconds']}s rms={info['rms']}")

    return results


def write_generated_ts(all_results: dict[str, dict]) -> None:
    """Metro needs literal require() calls, so the map is generated."""
    lines = [
        "/* GENERATED by scripts/generate-voice-clips.py - do not edit by hand.",
        "   Native Twi/Ewe clips rendered from Meta's MMS TTS models.",
        "   (No MMS checkpoint exists for Ga, so Ga keeps device TTS.)",
        "   Regenerate with: npm run voice-clips */",
        "",
        "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
        "export const VOICE_CLIPS: Record<string, Record<string, any>> = {",
    ]
    for lang, clips in sorted(all_results.items()):
        if not clips:
            continue
        lines.append(f"  {lang}: {{")
        for key in sorted(clips):
            require_path = f"../../assets/voice/{lang}/{key.replace('.', '_')}.wav"
            lines.append(f"    '{key}': require('{require_path}'),")
        lines.append("  },")
    lines.append("};")
    lines.append("")
    lines.append("/** Clips that ship with the app, for diagnostics in Settings. */")
    lines.append("export const VOICE_CLIP_COUNTS: Record<string, number> = {")
    for lang, clips in sorted(all_results.items()):
        lines.append(f"  {lang}: {len(clips)},")
    lines.append("};")
    lines.append("")

    GENERATED_TS.parent.mkdir(parents=True, exist_ok=True)
    GENERATED_TS.write_text("\n".join(lines), encoding="utf-8")
    print(f"✓ wrote {GENERATED_TS.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Ghanaian voice clips")
    parser.add_argument("--lang", action="append", help="restrict to a language code")
    parser.add_argument("--check", action="store_true", help="print the plan only")
    args = parser.parse_args()

    manifest = load_manifest()
    languages: dict[str, str] = manifest["languages"]
    if args.lang:
        languages = {k: v for k, v in languages.items() if k in set(args.lang)}
    keys: list[str] = manifest["keys"]

    try:
        import torch  # noqa: F401
    except ImportError:
        print(
            "torch is not installed in .tools/tts-venv.\n"
            "Run: .tools/tts-venv/bin/pip install torch transformers",
            file=sys.stderr,
        )
        if not args.check:
            return 2

    all_results: dict[str, dict] = {}
    for lang, model_id in languages.items():
        all_results[lang] = synth_language(lang, model_id, keys, args.check)

    if args.check:
        return 0

    (OUT_DIR / "manifest.json").parent.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "manifest.json").write_text(
        json.dumps(
            {
                "generatedBy": "scripts/generate-voice-clips.py",
                "models": languages,
                "clips": all_results,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    write_generated_ts(all_results)

    total = sum(len(v) for v in all_results.values())
    silent = [
        f"{lang}/{key}"
        for lang, clips in all_results.items()
        for key, info in clips.items()
        if info["rms"] <= 0.01
    ]
    size = sum(
        info["bytes"] for clips in all_results.values() for info in clips.values()
    )
    print(f"\n✓ {total} clips, {size / 1024 / 1024:.1f} MB")
    if silent:
        print(f"✗ silent clips (regenerate or drop): {', '.join(silent)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

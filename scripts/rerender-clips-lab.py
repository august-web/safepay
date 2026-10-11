#!/usr/bin/env python3
"""Re-render Twi voice-pack phrases through the HCI Lab TTS (quality fix).

The local MMS renders of short phrases garble — "Kɔma Sika" is audible as
"ɔma si" (team-reported 2026-10-03, corroborated by round-trip ASR). The
lab's TTS voices are the screening-grade sound, so this script re-renders a
priority list of pack phrases: several phrases go out in ONE request (joined
with ". ", <=250 chars), the reply WAV is split on the long silences the
model leaves between sentences (~0.5 s, vs <=0.08 s within a phrase), each
segment is converted to the pack format (16 kHz mono, 0.9 peak) and replaces
assets/voice/<lang>/<key>.wav. Every segment is QA'd through the self-hosted
fallback ASR (zero lab quota) and suspect renders are reported for human ears.

Usage:
  .tools/tts-venv/bin/python scripts/rerender-clips-lab.py --lang tw
  .tools/tts-venv/bin/python scripts/rerender-clips-lab.py --lang tw \
      --only vcmd.whoToPay,vcmd.askAmount

Quota: 1 TTS request per ~8 phrases (free plan 15/day, 70/week, 5k chars/week;
the script paces itself under 5 req/min). The QA pass uses only the local
fallback server. Replaced clips are peak-normalized lab audio — provenance is
recorded in BUILD-STATUS.md; assets/voice/manifest.json still describes the
original MMS generation run.
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import wave

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCALES = ROOT / "src" / "i18n" / "locales"
OUT_DIR = ROOT / "assets" / "voice"
FALLBACK_URL = "http://127.0.0.1:8700/api/v1/asr"
MAX_CHARS = 230
TTS_MODEL = {"model_type": "ss", "speaker": "PT"}

# The spoken response surface, in demo order. Numbers/name atoms stay on MMS
# renders for now (they are tiny separate clips; batching them is future work).
DEFAULT_PRIORITY = [
    "vcmd.whoToPay",
    "vcmd.askAmount",
    "vcmd.confirmSend",
    "vcmd.confirmTo",
    "vcmd.sayYesNo",
    "vcmd.contactNumber",
    "vcmd.askReference",
    "vcmd.contactLooking",
    "vcmd.contactNotFoundFixed",
    "vcmd.contactMany",
    "vcmd.contactPick",
    "vcmd.recipientCheck",
    "vcmd.flowCancelled",
    "vcmd.balanceIs",
    "vcmd.askPhone",
    "vcmd.noBiometrics",
    "home.sendMoney",
    "home.cashOut",
    "home.buyAirtime",
    "home.statement",
    "home.quickActions",
    "home.balanceLabel",
    "home.recentTransactions",
    "home.listenBalance",
]


def log(message: str) -> None:
    print(f"[rerender] {message}", flush=True)


def read_env_key() -> str:
    env = (ROOT / ".env").read_text(encoding="utf-8")
    for line in env.splitlines():
        if line.startswith("EXPO_PUBLIC_SPEECH_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no EXPO_PUBLIC_SPEECH_API_KEY in .env")


def fold(text: str) -> str:
    return (
        text.lower()
        .replace("ɛ", "e")
        .replace("ɔ", "o")
        .replace("ŋ", "ng")
        .replace("ɖ", "d")
        .replace("ƒ", "f")
        .replace("ʋ", "v")
    )


def lab_tts(text: str, key: str) -> bytes:
    """Posts one batched render. The gateway intermittently answers 401 when
    calls bunch up (observed 2026-10-04; not an auth failure - the same key
    succeeds seconds later), so transient 401s retry with backoff."""
    request = urllib.request.Request(
        "https://lab-subscription-platform.vercel.app/api/v1/tts",
        data=json.dumps({"text": text, **TTS_MODEL}).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    last_error: Exception | None = None
    for attempt in range(40):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            last_error = error
            body = ""
            try:
                body = error.read().decode("utf-8", "replace")[:200]
            except Exception:  # noqa: BLE001 - diagnostics only
                pass
            log(
                f"  TTS HTTP {error.code} body={body!r} "
                f"keylen={len(key)} head={key[:6]!r} tail={key[-4:]!r}"
            )
            # QUOTA RULE (same lesson as the ASR meter): the gateway counts
            # every request that reaches it, 429s and 401s included. A 429
            # means the day is dry - stop immediately, never retry. Only
            # transient 401/5xx flap gets a few light retries.
            if error.code == 429 or attempt == 2:
                raise
            if error.code not in (401, 502, 503):
                raise
            time.sleep(20)
    raise last_error  # pragma: no cover


def split_on_silences(
    samples: list[int], phrases: int, quiet_frac: float, min_gap_s: float
) -> list[list[int]]:
    """Cuts the 22050 Hz mono render into `phrases` segments on silences
    longer than min_gap_s (the model's between-sentence gaps). The quiet bar
    is RELATIVE to the render's own peak 10 ms RMS - lab renders ship much
    quieter than the MMS clips, so an absolute threshold reads the whole file
    as silence."""
    hop = 220  # 10 ms
    hop_rms = [abs(sum(samples[i : i + hop]) / hop) for i in range(0, len(samples) - hop, hop)]
    peak_rms = max(hop_rms) or 1
    quiet_amp = max(150, int(quiet_frac * peak_rms))
    quiet = [value < quiet_amp for value in hop_rms]
    gaps: list[tuple[int, int]] = []
    start = None
    for index, is_quiet in enumerate(quiet):
        if is_quiet and start is None:
            start = index
        elif not is_quiet and start is not None:
            if (index - start) * hop >= 22050 * min_gap_s:
                gaps.append((start * hop, index * hop))
            start = None
    bounds = [0] + [mid for gap in gaps for mid in ((gap[0] + gap[1]) // 2,)] + [len(samples)]
    segments = [samples[bounds[i] : bounds[i + 1]] for i in range(len(bounds) - 1)]
    segments = [s for s in segments if len(s) > 2205]  # drop <0.1 s slivers
    return segments


def write_pack_wav(samples: list[int], path: pathlib.Path, source_rate: int) -> None:
    tmp = path.with_suffix(".tmp.wav")
    with wave.open(str(tmp), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(source_rate)
        peak = max(abs(s) for s in samples) or 1
        handle.writeframes(
            b"".join(int(s / peak * 32767 * 0.9).to_bytes(2, "little", signed=True) for s in samples)
        )
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(tmp), str(path)],
        check=True,
        capture_output=True,
    )
    tmp.unlink()


def fallback_qa(path: pathlib.Path) -> str:
    boundary = uuid.uuid4().hex
    data = path.read_bytes()
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\n'
        f"Content-Type: audio/wav\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        FALLBACK_URL,
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return str(json.loads(response.read()).get("transcription") or "")
    except Exception as error:  # noqa: BLE001 - QA is best-effort
        return f"<qa-error: {error}>"


def read_samples(wav_bytes: bytes) -> list[int]:
    import array

    with wave.open(io.BytesIO(wav_bytes), "rb") as handle:
        assert handle.getsampwidth() == 2 and handle.getnchannels() == 1, "unexpected TTS WAV shape"
        return array.array("h", handle.readframes(handle.getnframes())).tolist()


def lcs_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    prev = [0] * (len(b) + 1)
    for i in range(1, len(a) + 1):
        curr = [0]
        for j in range(1, len(b) + 1):
            curr.append(prev[j - 1] + 1 if a[i - 1] == b[j - 1] else max(prev[j], curr[j - 1]))
        prev = curr
    return prev[-1] / max(len(a), len(b))


def main() -> int:
    parser = argparse.ArgumentParser(description="Re-render pack phrases via Lab TTS")
    parser.add_argument("--lang", default="tw")
    parser.add_argument("--only", default=None, help="comma-separated key list override")
    parser.add_argument("--quiet-frac", type=float, default=0.4, help="fraction of peak RMS that counts as silence")
    parser.add_argument("--min-gap-s", type=float, default=0.3, help="silence seconds between phrases")
    parser.add_argument("--per-phrase", action="store_true", help="one TTS request per phrase (no silence splitting - the reliable path)")
    parser.add_argument("--full", action="store_true", help="render the ENTIRE pack (generator-plan keys), resuming from provenance")
    parser.add_argument("--daily-cap", type=int, default=14, help="max successful renders this run (leave margin under 15/day)")
    args = parser.parse_args()

    api_key = read_env_key()
    locale = json.loads((LOCALES / f"{args.lang}.json").read_text(encoding="utf-8"))

    def locale_has_string(dotted: str) -> bool:
        node = locale
        for part in dotted.split("."):
            if not isinstance(node, dict) or part not in node:
                return False
            node = node[part]
        return isinstance(node, str)

    if args.full:
        # Mirror of scripts/generate-voice-clips.py's plan: the manifest keys
        # present in this locale, plus number atoms, currency units and every
        # vcmd line - the complete spoken surface.
        manifest_keys = json.loads(
            (ROOT / "scripts" / "voice-clip-manifest.json").read_text(encoding="utf-8")
        )["keys"]
        keys = [manifest_key for manifest_key in manifest_keys if locale_has_string(manifest_key)]
        nums = locale.get("num", {})
        keys += [
            f"num.{number}"
            for number in list(range(0, 20)) + list(range(20, 100, 10)) + [100, 1000]
            if str(number) in nums
        ]
        keys += [f"money.{unit}" for unit in ("cedis", "pesewas") if unit in locale.get("money", {})]
        keys += [f"vcmd.{name}" for name in sorted(locale.get("vcmd", {}))]
        seen: set[str] = set()
        keys = [k for k in keys if not (k in seen or seen.add(k))]
        # Conversation surface first: if the daily grind gets interrupted,
        # the phrases users actually hear are already done.
        priority = set(DEFAULT_PRIORITY)

        def rank(key: str) -> int:
            if key in priority:
                return 0
            if key.startswith("vcmd."):
                return 1
            if key.startswith("home."):
                return 2
            if key.startswith(("num.", "money.", "name.")):
                return 4
            return 3

        keys.sort(key=rank)
    else:
        keys = args.only.split(",") if args.only else DEFAULT_PRIORITY

    def text_for(key: str) -> str | None:
        node = locale
        for part in key.split("."):
            if not isinstance(node, dict) or part not in node:
                return None
            node = node[part]
        return node if isinstance(node, str) else None

    phrases = [(phrase_key, text_for(phrase_key)) for phrase_key in keys]
    phrases = [(phrase_key, text) for phrase_key, text in phrases if text]

    provenance_path = OUT_DIR / args.lang / ".lab-rendered.json"
    done: dict = {}
    if provenance_path.exists():
        done = json.loads(provenance_path.read_text(encoding="utf-8"))
    todo = [(pk, tx) for pk, tx in phrases if done.get(pk) is None]
    log(f"{len(phrases)} pack phrases, {len(done)} already lab-rendered, {len(todo)} to do")

    batches: list[list[tuple[str, str]]] = []
    current: list[tuple[str, str]] = []
    size = 0
    for phrase_key, text in phrases:
        if size + len(text) + 2 > MAX_CHARS and current:
            batches.append(current)
            current, size = [], 0
        current.append((phrase_key, text))
        size += len(text) + 2
    if current:
        batches.append(current)

    if args.per_phrase or args.full:
        # One request per phrase: no silence splitting, no alignment risk.
        batches = [[phrase] for phrase in todo]
    log(f"{len(todo)} phrases queued in {len(batches)} request(s)")
    time.sleep(20)  # pace the first call too - bunched requests draw 401s
    replaced: list[str] = []
    flagged: list[str] = []
    successes = 0
    for batch_index, batch in enumerate(batches):
        joined = ". ".join(text for _, text in batch)
        log(f"batch {batch_index + 1}/{len(batches)}: {len(batch)} phrases, {len(joined)} chars")
        if successes >= args.daily_cap:
            log(f"daily cap {args.daily_cap} reached - resume tomorrow (provenance keeps progress)")
            break
        try:
            wav_bytes = lab_tts(joined, api_key)
        except urllib.error.HTTPError as error:
            log(f"  TTS HTTP {error.code} - stopping (quota?)")
            break
        samples = read_samples(wav_bytes)
        raw_dump = pathlib.Path(f"/tmp/rerender-batch-{batch_index + 1}.wav")
        write_pack_wav(list(samples), raw_dump, 22050)
        if len(batch) == 1:
            # One phrase per request: the whole render IS the phrase (edge
            # silence is trimmed by normalization); splitting would cut the
            # phrase at its own internal pause ("Kɔma | Sika").
            segments = [samples]
        else:
            segments = split_on_silences(samples, len(batch), args.quiet_frac, args.min_gap_s)
        if len(segments) != len(batch):
            log(
                f"  split gave {len(segments)} segments for {len(batch)} phrases - "
                "batch SKIPPED, needs ears"
            )
            flagged.append(f"batch{batch_index + 1}:segment-count")
            time.sleep(13)
            continue
        for (phrase_key, text), samples in zip(batch, segments):
            out = OUT_DIR / args.lang / f"{phrase_key.replace('.', '_')}.wav"
            write_pack_wav(list(samples), out, 22050)
            heard = fold(fallback_qa(out))
            expected = fold(text)
            ok = len(heard) > 0 and (
                heard in expected
                or expected in heard
                or lcs_ratio(heard, expected) >= 0.5
            )
            (replaced if ok else flagged).append(phrase_key)
            done[phrase_key] = {"qa": heard}
            provenance_path.write_text(json.dumps(done, ensure_ascii=False, indent=1), encoding="utf-8")
            successes += 1
            log(f"  {'OK ' if ok else 'FLAG'} {phrase_key}: heard {heard!r}")
        time.sleep(13)  # pace under 5 req/min

    log(f"replaced {len(replaced)}: {', '.join(replaced)}")
    if flagged:
        log(f"FLAGGED for human ears: {', '.join(flagged)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

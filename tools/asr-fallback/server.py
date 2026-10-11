#!/usr/bin/env python3
"""Self-hosted ASR fallback for SafePay: Meta MMS (Akan) on this Mac.

The open-source fallback tier documented in FALLBACKS.md: when the HCI Lab
gateway's daily quota is exhausted, SafePay retries the same multipart upload
against this server (EXPO_PUBLIC_SPEECH_API_BASE_URL_ALT) and the user's utterance is
still transcribed - by Meta's MMS ASR checkpoint facebook/mms-1b-all with the
Akan adapter (CC-BY-NC 4.0, non-commercial - see FALLBACKS.md).

Deliberately dependency-free at the server layer: stdlib http.server plus the
project venv's torch/transformers/numpy. macOS-only by design - .m4a uploads
from the phone are decoded with the built-in `afconvert`, so ffmpeg is not
needed. The route mirrors the lab gateway (/api/v1/asr) and the success body
mirrors the lab shape ({"transcription": ...}), so the app swaps endpoints,
never code.

Usage (from the project root):
  .tools/tts-venv/bin/python tools/asr-fallback/server.py --lang aka --port 8700
  # then on the phone's network:
  #   EXPO_PUBLIC_SPEECH_API_BASE_URL_ALT=http://<this-mac-ip>:8700
  #   EXPO_PUBLIC_SPEECH_API_KEY_ALT=anything   (the server ignores the key)

First run downloads the checkpoint (~4 GB) into the Hugging Face cache.
"""

from __future__ import annotations

import argparse
import json
import re
import threading
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODEL_ID = "facebook/mms-1b-all"
MAX_BYTES = 10 * 1024 * 1024  # mirrors the lab gateway's per-request ceiling

state = {"model": None, "processor": None, "lang": None, "error": None}
infer_lock = threading.Lock()


def log(message: str) -> None:
    print(f"[asr-fallback] {message}", flush=True)


def load_model(lang: str) -> None:
    import torch
    from transformers import Wav2Vec2ForCTC, AutoProcessor

    try:
        log(f"loading {MODEL_ID} (adapter: {lang})")
        torch.set_num_threads(max(1, (torch.get_num_threads() or 2) - 1))
        processor = AutoProcessor.from_pretrained(MODEL_ID, target_lang=lang)
        model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID)
        # Do NOT pass target_lang to from_pretrained on this transformers
        # build: the LM head is sized from the wrong vocabulary and the load
        # throws a size mismatch. Loading the base weights and attaching the
        # language adapter explicitly is the reliable path.
        model.load_adapter(lang)
        model.eval()
        state["model"] = model
        state["processor"] = processor
        state["lang"] = lang
        state["error"] = None
        log("model ready")
    except Exception as error:  # noqa: BLE001 - surfaced through /health
        state["error"] = str(error)
        log(f"MODEL LOAD FAILED: {error}")


def decode_to_wav16k(body: bytes, filename: str) -> Path:
    """Decodes an upload to 16 kHz mono PCM WAV. WAV passes through; anything
    else (the phone uploads .m4a) goes through macOS's built-in afconvert."""
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="safepay-asr-"))
    raw = tmp / ("upload" + (Path(filename).suffix or ".bin"))
    raw.write_bytes(body)

    if raw.suffix.lower() == ".wav":
        return raw

    wav = tmp / "upload.wav"
    import subprocess

    result = subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(raw), str(wav)],
        capture_output=True,
    )
    if result.returncode != 0 or not wav.exists():
        raise RuntimeError(
            "could not decode upload (afconvert failed) - supported: wav, m4a, aac"
        )
    return wav


def wav_to_floats(path: Path):
    import numpy as np

    with wave.open(str(path), "rb") as handle:
        if handle.getframerate() != 16000:
            raise RuntimeError(f"expected 16 kHz after decode, got {handle.getframerate()}")
        frames = handle.readframes(handle.getnframes())
    samples = np.frombuffer(frames, dtype="<i2").astype("float32") / 32768.0
    if samples.ndim > 1:
        samples = samples.reshape(-1)
    return samples


def transcribe(body: bytes, filename: str) -> str:
    import torch

    if state["model"] is None:
        raise RuntimeError("model not loaded yet")

    with infer_lock:  # one CPU inference at a time
        wav = decode_to_wav16k(body, filename)
        audio = wav_to_floats(wav)
        if audio.size == 0:
            raise RuntimeError("empty audio")

        processor = state["processor"]
        inputs = processor(audio, sampling_rate=16000, return_tensors="pt")
        with torch.no_grad():
            logits = state["model"](inputs.input_values).logits
        ids = torch.argmax(logits, dim=-1)
        transcription = processor.batch_decode(ids)[0]
        return transcription.strip()


def extract_multipart_file(body: bytes, content_type: str) -> tuple[bytes, str]:
    """Minimal multipart/form-data extraction for the single `file` part the
    app sends (same request shape as the lab gateway). Header names and the
    part name are matched case-insensitively - serializers differ (expo/fetch
    vs curl vs OkHttp) about quoting and letter case."""
    match = re.search(r'boundary="?([^";]+)"?', content_type)
    if match is None:
        raise RuntimeError("multipart boundary missing")
    boundary = ("--" + match.group(1)).encode()

    for part in body.split(boundary):
        if b"content-disposition" not in part.lower():
            continue
        head, _, payload = part.partition(b"\r\n\r\n")
        payload = payload.rstrip(b"\r\n")
        lowered = head.lower()
        if b'name="file"' in lowered or b"name=file" in lowered:
            filename_match = re.search(rb'filename="([^"]*)"', head)
            filename = (
                filename_match.group(1).decode("utf-8", "replace")
                if filename_match
                else "upload.wav"
            )
            return payload, filename
    snippet = body[:240].decode("utf-8", "replace")
    raise RuntimeError(f"multipart part 'file' not found - body starts: {snippet!r}")


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        if self.path == "/health":
            self._json(
                200,
                {
                    "status": "ok",
                    "fallback": True,
                    "model": MODEL_ID,
                    "lang": state["lang"],
                    "ready": state["model"] is not None,
                    "error": state["error"],
                },
            )
        else:
            self._json(404, {"status": "error", "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/v1/asr":
            self._json(404, {"status": "error", "error": "not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BYTES:
            self._json(413, {"status": "error", "error": "too-big"})
            return
        body = self.rfile.read(length)

        try:
            filename = "upload.wav"
            if "multipart/form-data" in (self.headers.get("Content-Type") or ""):
                body, filename = extract_multipart_file(body, self.headers["Content-Type"])
            transcription = transcribe(body, filename)
            log(f"transcribed {len(body)} bytes ({filename}): {transcription!r}")
            self._json(
                200,
                {
                    "request_id": str(uuid.uuid4()),
                    "status": "success",
                    "transcription": transcription,
                },
            )
        except Exception as error:  # noqa: BLE001 - the gateway speaks JSON errors
            log(f"error: {error}")
            message = str(error)
            code = 415 if "decode" in message or "expected 16 kHz" in message else 500
            self._json(code, {"status": "error", "error": message})

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        log(format % args)


def main() -> int:
    parser = argparse.ArgumentParser(description="SafePay self-hosted ASR fallback")
    parser.add_argument("--lang", default="aka", help="MMS adapter code (aka, ewe, eng...)")
    parser.add_argument("--port", type=int, default=8700)
    args = parser.parse_args()

    threading.Thread(target=load_model, args=(args.lang,), daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    log(f"listening on 0.0.0.0:{args.port} - POST /api/v1/asr, GET /health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("bye")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

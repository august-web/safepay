# Voice Line (IVR) demo — P3

## Demo-day quick start (one command)

```bash
bash ivr/start-demo.sh
```

It starts the IVR server, health-checks it, opens a public Cloudflare
quick tunnel (no account needed) and prints the **public webhook URL** in a
box. Paste `<URL>/voice/webhook` into the Arkesel dashboard and dial the
number. Ctrl+C stops everything. Run it in a normal Terminal window and
leave it open for the whole presentation.

Minimum viable demo per the work order: **one transaction type end-to-end
(Check Balance)** behind a real, live-callable phone flow. Real MoMo
integration is intentionally NOT included — the balance is mocked, the call
flow is real.

## What a caller hears

```
Incoming call
  → "Akwaaba. SikaVoice MoMo line. For Twi press 1, for Ewe press 2."   (DTMF 1/2)
  → language prompt: "Ka wo mfomsoɔ." / "Gblɔ wo gbe nyoƒenɛ."           (passphrase capture)
  → "Medaase / Mesi."
  → "Wo sika a aka: 1204.50 cedi." (mocked balance, Check Balance only)
  → "SikaVoice, MTN MoMo. Vaaso."                                       (hangup)
```

Feature-phone users get Twi/Ewe prompts **without installing anything** —
that is the inclusion pitch for the Voice Line track.

## Run it locally

```bash
node ivr/server.js
# → [ivr] SikaVoice IVR demo listening on :8787
```

## Make it live-callable (demo day)

1. Expose the server publicly:

   ```bash
   ngrok http 8787
   # → https://<random>.ngrok-free.app
   ```

2. In the **Arkesel dashboard → VoiceConnect → Voice Number → Webhook URL**,
   set:

   ```
   https://<random>.ngrok-free.app/voice/webhook
   ```

3. Dial the Arkesel voice number from any phone. The flow runs end-to-end.

## Local sanity check (no airtime)

```bash
curl -s -X POST localhost:8787/voice/webhook \
  -H 'Content-Type: application/json' \
  -d '{"callId":"t1"}' | head -c 400; echo
curl -s -X POST localhost:8787/voice/webhook \
  -H 'Content-Type: application/json' \
  -d '{"callId":"t1","dtmf":"1","recordingUrl":"https://example.test/rec.wav"}' | head -c 400; echo
```

## Stopping point (explicit, per work order)

Check Balance is the ONLY implemented transaction. Send Money on the IVR
track is deliberately left unstarted — a broken live phone demo is worse
than a narrower working one.

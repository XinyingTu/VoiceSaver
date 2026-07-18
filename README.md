# Challenge #1 — ElevenLabs: The Negotiator

A high-fidelity, web-based **Live Voice Negotiation Control Center** for moving services.
It runs a **Simulated Market** (agent-to-agent) where an AI negotiator ("Alex") haggles a
mover dispatcher down from an inflated opening quote, using a verified lower competitor bid
as leverage. The cockpit UI streams the live transcript, ticks a savings counter downward at
the exact leverage breakthrough, and plays a mocked ElevenLabs audio highlight.

> All code, comments, console output, and UI copy are in English.

## Architecture

```
config/
  domain_config.json          # Moving taxonomy, price benchmarks, red-flag threshold
  counterparty_profiles.json  # 3 dispatcher personalities (Tony / Brenda / Greg)
src/
  negotiation_engine.py       # Agent A (Alex) vs Agent B (Mover) — strict 4-turn loop
  audio_generator.py          # Mock ElevenLabs highlight pipeline (real WAV placeholder)
  server.py                   # FastAPI REST server feeding the frontend
frontend/                     # React + Vite + Tailwind cyberpunk cockpit
assets/audio/                 # Generated highlight audio (git-ignored)
```

## Quick start

### 1. Backend

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# (optional) pre-generate the highlight audio for every profile
python -m src.audio_generator

# boot the API on http://localhost:8000
uvicorn src.server:app --reload --port 8000
```

Run the engine standalone (no server needed) to see a transcript in the console:

```bash
python -m src.negotiation_engine --profile greg_hard_seller
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The frontend talks to the backend at `http://localhost:8000` (override with
`VITE_API_BASE`).

## Key REST endpoints

| Method | Path                              | Purpose                                          |
| ------ | --------------------------------- | ------------------------------------------------ |
| GET    | `/api/health`                     | Liveness probe                                   |
| GET    | `/api/job`                        | Structured intake spec + document overview       |
| GET    | `/api/profiles`                   | The 3 dispatcher profiles (safe subset)          |
| GET    | `/api/negotiation/{profile_id}`   | Full simulated negotiation result JSON           |
| GET    | `/api/audio/{profile_id}`         | Streams the mocked highlight WAV                  |

## Design notes

- The **Simulated Market** is deterministic and self-contained: no external API keys are
  required to run the demo. Agent A and Agent B are driven by clearly separated system
  prompts + rule-based price logic so the negotiation is reproducible and auditable.
- Agent A never fabricates bids or lies about inventory; it only ever wields the *real*
  competitor quote supplied in the job intake.
- Agent B lowers its price **only** when Alex presents valid, verifiable competitive
  leverage — matching each dispatcher's personality.
- A `red_flag` fires when a mover drops more than `red_flag_discount_threshold` (0.30) from
  its own opening quote, exposing a padded lowball opener.

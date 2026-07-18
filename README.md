# VoiceSaver — Universal Automated Negotiation Cockpit

An AI voice proxy that calls, compares, and haggles service quotes on behalf of a
consumer. This build targets the **moving-services** vertical (fully
vertical-agnostic via config) and implements the three brief beats:

1. **The Estimator** — dual-path intake (voice interview *or* document vision/OCR)
   into one structured JSON spec, with a **spec-lock guardrail**.
2. **The Caller** — real-time voice market query. Ships a clearly-labeled
   **simulated agent-to-agent market** locally; real ElevenLabs/Twilio/Yelp paths
   are wired as env-gated integration points.
3. **The Closer** — dynamic haggling using **cross-call logged leverage**, the
   **30%-below-benchmark lowball fraud rule**, **dynamic outcome classification**
   (ITEMIZED_QUOTE / CALLBACK_COMMITMENT / DOCUMENTED_DECLINE), and a ranked
   **Closing Ledger** with itemized fee breakdowns.

> All code, comments, console output, and UI copy are in English.
> Scenario: the brief's Daniel example — Rock Hill, SC → Charlotte, NC (45 mi, 2BR).

## What is real vs. simulated

| Capability | Status |
| --- | --- |
| 4 negotiation tools as **live function-calling webhooks** (`/api/tools/*`) | **Real**, callable by an ElevenLabs Agent |
| Document intake **one-shot vision API call** | **Real** (env-gated on `OPENAI_API_KEY`; never fabricates) |
| Cross-call leverage, benchmark, lowball flag, outcome classifier, fee decomposition | **Real** deterministic logic |
| Agent-to-agent negotiation for the no-keys demo | **Simulated**, clearly labeled (`mode: simulated_agent_to_agent`) |
| Live voice (ElevenLabs Agents), outbound dialing (Twilio/SIP), market list (Yelp/Google Places) | **Documented stubs** — need credentials |
| Ledger audio playback | **Labeled simulated** placeholder; real path uses the actual call recording |

## Architecture

```
config/   domain_config.json · counterparty_profiles.json · job_spec.json · negotiator_prompt.txt
src/      config_loader.py
          negotiation_tools.py     # get_price_benchmark · log_competitor_quote · check_lowball_flag · classify_outcome
          document_parser.py       # REAL one-shot vision extraction -> same schema
          negotiator_agent.py      # ElevenLabs agent config + labeled dynamic sim market (cross-call leverage, ADA shield)
          counterparty_channel.py  # simulated (real) · human-in-loop (widget) · Twilio/Yelp (stubs)
          report_builder.py        # Closing Ledger
          audio_generator.py       # labeled simulated playback only
          server.py                # FastAPI: tool webhooks + intake + session + report + audio
frontend/ React + Vite + Tailwind cockpit (WCAG 2.1 AA)
```

## Quick start

### Backend
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# optional: real document vision + live voice/market integrations
export OPENAI_API_KEY=sk-...        # enables /api/intake/vision
# export ELEVENLABS_API_KEY / TWILIO_* / YELP_API_KEY   # enable live stubs

uvicorn src.server:app --reload --port 8000
```
CLI sanity checks (no keys needed):
```bash
python -m src.negotiator_agent           # print the simulated 3-call session
python -m src.negotiator_agent --config  # print the ElevenLabs agent config
python -m src.document_parser --demo      # labeled offline intake fixture
OPENAI_API_KEY=sk-... python -m src.document_parser --image quote.jpg   # real vision call
```

### Frontend
```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```
Override the API host with `VITE_API_BASE` (defaults to `http://localhost:8000`).

## Key endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/api/job_spec` | Lockable structured spec + ADA state |
| POST | `/api/job_spec/lock` | Lock the reviewed spec (gates the CTA) |
| POST | `/api/intake/vision` | Real one-shot vision extraction of an uploaded doc |
| POST | `/api/tools/get_price_benchmark` | Live tool webhook |
| POST | `/api/tools/log_competitor_quote` | Live tool webhook (session leverage) |
| POST | `/api/tools/check_lowball_flag` | Live tool webhook (30% rule) |
| POST | `/api/tools/classify_outcome` | Live tool webhook (3 states) |
| GET  | `/api/agent/config` | ElevenLabs agent config (prompt + tool schemas) |
| POST | `/api/session/run` | Run the ordered simulated session + build report |
| GET  | `/api/audio/{profile_id}` | Labeled simulated playback WAV |

## Honesty & accessibility guardrails

- The proxy **never fabricates** competitor quotes or inventory; only quotes logged
  via `log_competitor_quote` can be cited as leverage.
- **AI identity disclosure** is always honest. The **ADA Voice Equity Shield** is
  off by default and only activates after explicit user self-attestation.
- Frontend is **WCAG 2.1 AA**: separate background/body-text tokens, every status
  carries **icon + text** (never color alone), motion is reducible, the transcript
  is `aria-live`, and icon-only controls have `aria-label`s.

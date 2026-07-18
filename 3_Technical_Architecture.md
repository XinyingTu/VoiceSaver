# Technical Architecture & System Implementation Document

## 3.1 Structural Overview & Data Flow

The core of the system is a real-time voice session hosted on the **ElevenLabs Conversational AI Agents Platform** — not a pipeline that generates a full text dialogue first and converts it to speech afterward. Negotiation logic (price comparison, strategy, red-flag detection, outcome classification) is exposed to the live conversation as **agent tools (function calling)**, triggered dynamically as the call unfolds.

```text
+------------------------+      REST/WS    +--------------------------+
|   React Web Frontend   | <-------------> |      FastAPI Server      |
| (Live transcript, SVG  |  JSON + Audio   |   (src/server.py:8000)   |
|  waveform, CountUp)    |    Stream       |                          |
+------------------------+                 +--------------------------+
                                                       |
                     +---------------------------------+---------------------------------+
                     |                                 |                                 |
                     v                                 v                                 v
      +----------------------------+   +----------------------------+   +----------------------------+
      |  src/document_parser.py    |   |  src/negotiator_agent.py   |   |  src/negotiation_tools.py  |
      |  (Vision/OCR intake path)  |   |  (ElevenLabs Agent config, |   |  (benchmark lookup,        |
      |                            |   |   real-time voice session) |   |   red-flag check, outcome  |
      +----------------------------+   +----------------------------+   |   classifier, quote log)   |
                                                       |                 +----------------------------+
                                        +--------------+--------------+
                                        |                             |
                                        v                             v
                         +----------------------------+  +----------------------------+
                         |  Real business (Twilio/SIP)|  |  Counterparty ElevenLabs   |
                         |  or human-in-the-loop      |  |  Agent (agent-to-agent)    |
                         +----------------------------+  +----------------------------+
```

**Core principle**: every conversation is a real-time voice session (whether the counterparty is a real business, a human role-playing, or another ElevenLabs agent). Transcripts are streamed live via ASR as the call happens — never assembled beforehand and read back. Recordings are recordings of the actual live call — never post-hoc synthesized audio.

## 3.2 Data Models & Configuration

### 3.2.1 Core Industry Benchmarks: `config/domain_config.json`

Keeps the platform fully vertical-agnostic; switching from moving to auto body repair requires only swapping this file, no code changes. **`fee_line_items` defines the itemized breakdown every quote must be decomposed into** — a captured quote is not compliant if it is only a single total number; it must map onto these named line items (any item not mentioned by the counterparty is simply logged as `0` / not offered, which itself is useful comparison signal).

```json
{
  "vertical": "moving_services",
  "benchmarks": {
    "base_rate_per_mile": 15.00,
    "average_2_bedroom_move_total": 2200.00,
    "red_flag_discount_threshold": 0.30
  },
  "job_spec_taxonomy": [
    "household_size",
    "origin_zip",
    "destination_zip",
    "inventory_items",
    "stair_flights"
  ],
  "fee_line_items": [
    "base_labor_fee",
    "mileage_fee",
    "stair_carry_fee",
    "long_carry_fee",
    "packing_materials_fee",
    "fuel_surcharge"
  ]
}
```

### 3.2.2 Counterparty Style Profiles (for human role-play or agent-to-agent config): `config/counterparty_profiles.json`

Defines 3 distinct negotiation styles, used either as a human role-play reference sheet or as the system-prompt configuration for a counterparty ElevenLabs Agent. In both cases this only defines **personality and strategic tendency** — actual responses are still generated live during the real conversation, never pre-scripted.

```json
{
  "profiles": [
    {
      "id": "mover_001_lowballer",
      "name": "Slick Moving Co. (Dispatcher: Tony)",
      "style": "Friendly bait lowballer with hidden fees",
      "initial_price": 1200.00,
      "flexibility_score": 0.00,
      "system_prompt_addon": "You give an unrealistically low quote up front. You avoid answering detailed inventory questions and intend to add charges for stairs later. Speak naturally and improvise based on what the caller actually says."
    },
    {
      "id": "mover_002_tough",
      "name": "Apex Cargo Lines (Dispatcher: Brenda)",
      "style": "Gruff, unyielding, blocks automated systems",
      "initial_price": 2600.00,
      "flexibility_score": 0.35,
      "system_prompt_addon": "You are busy and impatient. If you suspect the caller is an AI, say so and threaten to hang up. Only soften and consider a lower price if the caller provides a specific, verifiable competitor quote — or, if applicable, a genuine accessibility-proxy disclosure. Improvise naturally rather than following a script."
    },
    {
      "id": "mover_003_hard_seller",
      "name": "SafeJourney Van Lines (Dispatcher: Greg)",
      "style": "Aggressive, unyielding high-pressure salesperson",
      "initial_price": 3100.00,
      "flexibility_score": 0.10,
      "system_prompt_addon": "You push for an immediate deposit. If the caller negotiates or asks for a price match, grow more insistent and decline to change terms. Improvise naturally rather than following a script."
    }
  ]
}
```

## 3.3 Core Logic Modules

### 3.3.1 Document Intake Path: `src/document_parser.py`

- Accepts user-uploaded photos, handwritten quotes, bills, or inventory PDFs.
- Uses a vision/OCR model to extract structured fields.
- Outputs the **exact same JSON schema** as the voice-interview path (matching `job_spec_taxonomy`), so the frontend's spec-lock step can display, edit, and confirm either source identically.

### 3.3.2 Real-Time Negotiator Agent: `src/negotiator_agent.py`

- Configures a real-time voice agent on the **ElevenLabs Agents Platform**, loaded with: the locked job spec JSON, `config/negotiator_prompt.txt` (persona and honesty constraints), and a set of **tools** callable during the live conversation.
- **Available tools** (exposed via Agent Tools/MCP):
  - `get_price_benchmark(vertical, job_spec)`: reads benchmark pricing from `domain_config.json` to sanity-check an incoming quote.
  - `log_competitor_quote(quote)`: records a confirmed competing quote **as a structured object broken down by `fee_line_items`**, not a single total; only logged quotes may later be cited as leverage — the agent may never reference a quote that hasn't been logged.
  - `check_lowball_flag(quote, benchmark)`: returns `LOWBALL_FRAUD_RISK` if a quote is 30%+ below benchmark.
  - `classify_outcome(transcript_so_far)`: dynamically classifies the call, during or at the end of the conversation, into one of `ITEMIZED_QUOTE` / `CALLBACK_COMMITMENT` / `DOCUMENTED_DECLINE` based on actual content — never a fixed number of turns.
- **Cross-call state persistence (required for the leverage requirement)**: all quotes logged via `log_competitor_quote` are stored against a single shared `session_id` for the job, not reset between calls. This is what allows a quote obtained in an earlier call to be genuinely cited as leverage in a later call — the negotiator agent must load the full set of previously logged quotes for the session before each new call begins.
- **Conditional ADA Shield injection**: `ada_shield_active` defaults to `False`, and is only set to `True` when the user has explicitly self-attested, during intake, a genuine vocal/cognitive-processing/hearing accessibility need (a user self-attestation, never a system inference or fabrication).
  - When `True`: if the counterparty objects to an automated caller or threatens to hang up, the agent truthfully discloses that it is an authorized AI voice proxy assisting a user with an accessibility need.
  - When `False` (default): if asked about its identity, the agent plainly answers "I'm an AI assistant," with no accessibility language, and continues the quoting flow normally.
- **Honesty constraint**: the system prompt explicitly forbids inventing inventory, fabricating competitor quotes, or overstating the best price obtained — any leverage referenced must come from data actually recorded via `log_competitor_quote`, never freely generated text.

### 3.3.3 Counterparty Connection Layer: `src/counterparty_channel.py`

Supports the three brief-approved counterparty setups, which can coexist:

- **Real outbound calls**: routes the ElevenLabs Agent through Twilio/SIP to dial real business phone lines.
- **Human-in-the-loop**: exposes a voice entry point (e.g. an in-browser WebRTC call, or ElevenLabs' own built-in test/embed conversation widget) for a team member to answer and role-play a persona from `counterparty_profiles.json` live against the agent.
- **Agent-to-agent**: spins up a second, independent ElevenLabs Agent instance as the counterparty, loaded with the matching `system_prompt_addon` as its persona, holding a genuinely live, voice-first conversation with the negotiator agent (neither side is text-generated-then-spoken).

### 3.3.4 Report Aggregation: `src/report_builder.py`

- After calls complete, aggregates per call: the structured itemized quote, the `classify_outcome` result, any `check_lowball_flag` badge, the full live transcript, and the raw call recording.
- Produces the ranking and recommendation, citing specific transcript excerpts as evidence, feeding the Closing Ledger view.

## 3.4 Tonight's Execution Plan (Solo, Time-Boxed to ~5 Hours)

Given a solo build with a hard 11pm deadline, scope is deliberately compressed to what actually satisfies the brief's Success Criteria, cutting everything that's a "nice to have":

| # | Step | Time | Notes |
|---|------|------|-------|
| 1 | Lock the scenario using the brief's own Daniel example (Rock Hill → Charlotte, 45 mi, 2BR, real quotes $1,158–$6,506) | 15 min | Skip original market research — the numbers are already provided and citable. |
| 2 | Write a pre-filled, lockable `job_spec.json`; frontend shows it with a "Confirm & Lock" button | 20 min | Consider generating the page quickly via Lovable rather than hand-coding, to save time. |
| 3 | Configure the ElevenLabs negotiator agent (system prompt: honesty constraints, identity disclosure, itemized-quote extraction, structured-outcome closing statement, conditional ADA Shield branch) | 45–60 min | The one part that must be hand-crafted carefully — no shortcut tool applies here. |
| 4 | Document intake: run one photographed quote through a single one-shot vision-model API call (e.g. using the provided OpenAI credit) that maps it into the same JSON schema as the voice path | 20–30 min | **This is a stated "Required" item in the brief, not optional** — skipping it entirely means an explicit hard requirement is unmet. A single API call is enough; a full OCR pipeline is not needed. |
| 5 | Run 3 live calls, **in this specific order**, using ElevenLabs' built-in real-time test/embed conversation — you personally role-play each dispatcher persona via microphone: <br>**Call 1 — Lowballer** (`mover_001_lowballer`): establishes a concrete, real anchor quote via `log_competitor_quote`. <br>**Call 2 — Tough negotiator** (`mover_002_tough`, `ada_shield_active = True`): the agent explicitly cites Call 1's logged quote as leverage mid-call; as the human playing Brenda, actually lower the price in response — this is the one moment that satisfies "price/terms measurably change during the call because of leverage," so it must not be skipped or left to chance. This call also demonstrates the ADA Shield triggering naturally. <br>**Call 3 — Hard seller** (`mover_003_hard_seller`): let this one end in a genuine decline, so all three outcome states (`ITEMIZED_QUOTE`, `CALLBACK_COMMITMENT`-or-similar, `DOCUMENTED_DECLINE`) are represented across the demo, not the same outcome three times. | 45–60 min | Screen + audio record all 3. The ordering is what turns "the agent has this capability" into "the demo actually proves it happened." |
| 6 | Manually compile the final report (3 rows: itemized fee breakdown, red-flag triggered Y/N, outcome classification, key transcript citation — including the citation showing the Call 2 price drop) — no automated backend needed | 30–45 min | Judges are evaluating the closed loop's logic, not a working pipeline. |
| 7 | Record a ~5-minute demo video: locked spec screen → document intake moment → 3 live call clips in order (highlighting real friction, and explicitly calling out the Call 2 leverage/price-drop moment) → final report. Narrate explicitly how the four Conversation Requirement points were handled: AI disclosure, friction handling, the honesty line, and structured call endings | 30–45 min | These four points, plus the leverage-driven price change, are explicitly named in the Success Criteria — stating them out loud is safer than hoping judges infer them. |

**Tooling notes** (from available sponsor credits):
- **Tavily**: optionally spend 10–15 min verifying a real benchmark figure or two (e.g. average 2BR move cost, FMCSA lowball-threshold guidance) and cite the source in the report — directly supports the brief's "prove the pain with real numbers" criterion, at low time cost.
- **Lovable**: use to generate the frontend (spec-lock page, embedded ElevenLabs widget, report table) from a natural-language description instead of hand-coding, freeing time for the call recordings and demo video.
- **OpenAI credit**: use for the one-shot vision-model call in Step 4.
- Emdash and Woz are skipped — they're developer productivity tools, not something a solo build with this scope needs to configure under time pressure.

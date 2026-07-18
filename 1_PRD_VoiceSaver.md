# Product Requirement Document (PRD)

## 1.1 Product Vision & Core Value

- **Product Name**: VoiceSaver (Universal Automated Negotiation Cockpit)

- **Target Audience**: All consumer and B2B buyers seeking automated market discovery and pricing transparency in phone-priced industries (moving, auto repair, medical billing, etc.).

- **Core Value Proposition**: Highly fragmented service industries intentionally conceal pricing to lock buyers into predatory "sight-unseen" phone estimates. VoiceSaver acts as a universal AI voice proxy that calls, compares, and haggles entirely on behalf of the consumer — for the first time, software can literally pick up the phone.

- **The Curb-Cut Principle**: The product is designed as a universally useful, high-utility automated savings tool for the general public. Its accessibility layer — the **ADA Voice Equity Shield** — is not a separate "special mode," but an integrated, opt-in capability available to any user who genuinely needs it. When a user has self-attested a real vocal, cognitive-processing, or hearing accessibility need and has explicitly enabled the Shield, the agent will truthfully disclose that context if a dispatcher exhibits automated-blocking behavior (e.g. threatens to hang up because it suspects an AI caller). This is a truthful disclosure mechanism, not a fabricated claim, and it never activates for users who have not opted in.

## 1.2 System Modules & Hard Requirements (The Three Beats)

As mandated by the challenge brief, the system architecture must complete three foundational beats:

### 1.2.1 Beat 1: The Estimator (Dual-Path Unified Intake)

- **Voice Interview Path**: An ElevenLabs Conversational Agent interviews the user on vertical-specific variables (e.g., rooms, stairs, inventory items for moving).

- **Document Intake Path**: A vision/OCR model processes user-supplied assets (photos, existing handwritten quotes, bills, or inventory PDFs) into the same structured spec.

- **Unified Schema Consolidation**: Both paths must parse data into the *exact same structured JSON specification schema*.

- **User Confirmation Guardrail (required interaction)**: The user must review and explicitly lock the JSON job specification before any outbound calls can be initiated. The primary call-to-action remains disabled until the spec is locked — this directly targets the "sight-unseen estimate expansion" trap.

### 1.2.2 Beat 2: The Caller (Real-Time Voice Market Query)

- **Real-World Market Discovery**: Programmatically generate a target outbound call list by pulling local merchant data via Yelp Fusion or Google Places API, rather than manual lookup.

- **Three Valid Counterparty Setups** (any one or a combination — all must be real, live voice conversations, never text generated then played back as audio):
  1. **Real outbound calls**: The agent (via ElevenLabs Agents + Twilio/SIP) calls real businesses directly.
  2. **Human-in-the-loop**: A team member answers/plays distinct counterparts (the tough negotiator, the lowballer with hidden fees, the hard-sell upseller) in a live voice conversation with the agent.
  3. **Simulated market (agent-to-agent)**: A separate counterparty ElevenLabs Agent is configured, and the two agents hold a genuine real-time voice conversation (not pre-generated text later converted to speech).

- **Friction Resilience**: The caller must handle real conversational friction — interruptions (barge-in), evasive answers, "someone will call you back" — with reasonable latency and natural turn-taking, so the call sounds like a serious buyer rather than a bot reciting lines.

- **Consistency Control**: The caller describes the confirmed job specification identically across every session, establishing a genuinely comparable fee baseline.

- **Structured Extraction**: Regardless of counterparty setup, every completed call must yield a structured, comparable itemized quote rather than a vague summary.

### 1.2.3 Beat 3: The Closer (Negotiation, Auditing & Reporting)

- **Dynamic Strategy Haggling**: Leverages legitimate competitive bids collected earlier in the loop (e.g., "I have a verified quote for $1,850 — can you match or beat it?") to pressure the opponent's pricing.

- **The 30% Fraud Red-Flag Rule**: Cross-references every incoming offer against industry pricing benchmarks. If an offer falls 30% or more below the market baseline, the system automatically flags it as a "Lowball Fraud Warning Risk" (per FMCSA trends) rather than a competitive win.

- **Dynamic Outcome Classification**: The agent must determine, based on how the actual conversation unfolds — not a fixed number of turns — which of the three deterministic outcome states the call belongs to (see 1.3). For example: an explicit, comparable price quoted → `ITEMIZED_QUOTE`; a promise that a supervisor will call back → `CALLBACK_COMMITMENT`; a refusal to quote or a hang-up → `DOCUMENTED_DECLINE`.

- **Unified Closing Dossier**: Compiles a plain-language summary ranking the quotes, backed by verifiable transcript logs, full call recordings, and itemized fee breakdowns.

## 1.3 Strict Conversation Design Guardrails

- **Honesty Line Limitation**: The agent is strictly constrained from fabricating non-existent competitor rates or modifying the user's asset inventory. It wins purely through legal, transparent market leverage — any price leverage referenced in conversation must trace back to an actually logged competing quote, never a model-generated fabrication.

- **Genuine Conversation Requirement (no staged screenplay)**: All negotiations must take place as real, live voice conversations — whether against a real business, a human role-playing a counterpart, or another agent in real time. Price or terms must change *during* the call because of leverage the agent gathered in the moment, not because a script said so. The system must never generate a full dialogue with a text model first and then convert it into audio for playback.

- **Graceful AI Identity Disclosure**: If directly asked "Are you a robot/AI?", the agent must answer transparently and honestly. For users who have not enabled the ADA Voice Equity Shield, the disclosure stops there — no accessibility-related language is used.

- **ADA Shield Self-Attestation & Conditional Trigger**: The ADA Voice Equity Shield is **off by default**. It can only be enabled when the user, during intake, explicitly checks a box self-attesting that they (or the person they represent) genuinely have a vocal, cognitive-processing, or hearing-related accessibility need — the user is responsible for the truthfulness of that self-attestation; the system never infers or fabricates this need on the user's behalf. Only in sessions where the Shield is enabled will the agent, upon encountering automated-blocking behavior, truthfully state that it is a voice proxy assisting a user with an accessibility need. When the Shield is off (default), the agent answers identity questions with a plain, honest "I'm an AI assistant" and continues the quoting flow normally — no accessibility language is invoked.

- **Triple Structured Outcomes**: Every interaction must map onto one of three deterministic, non-vague final states:

  1. `ITEMIZED_QUOTE`: A complete, comparable, itemized quote is extracted.
  2. `CALLBACK_COMMITMENT`: An official callback is booked with a supervisor commitment.
  3. `DOCUMENTED_DECLINE`: A clear refusal to quote or an adversarial hang-up is recorded.

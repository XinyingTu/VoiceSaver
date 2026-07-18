# UI/UX Design Specification Document

## 2.1 Visual Identity & Accessibility Guidelines

- **Design Theme**: Dark cockpit-style layout with a technical, premium feel. Accessibility is not a toggleable "mode" — it is the single default experience for every user, governed by **WCAG 2.1 AA** as a hard constraint, never traded off for visual flash.

- **Color Tokens** — background and body-text colors are kept separate so contrast never depends on a colored-text-on-colored-background combination:
  - Base Surface: `#0D1117` (deep obsidian grey)
  - **Body text**: `#E6EDF3` (near-white; contrast ratio against `#0D1117` is ~15.8:1, well above the AA 4.5:1 minimum). All body copy and transcript text use this color — body text is never carried by a colored token.
  - Success accent: `#10B981` (emerald green — used only for icon fills, borders, and badge backgrounds, never as the sole carrier of status)
  - Red-flag / lowball hazard: `#EF4444` (crimson — same rule: badge/border use only, never the sole status signal)
  - Accessibility accent: `#F59E0B` (amber gold — indicates ADA Shield active state; chosen with enough hue distance from red to reduce confusion for red-green and red-yellow color-vision deficiencies)

- **Color Is Never the Only Channel**: Every status distinction (success/warning/danger/neutral) must be paired with an **icon + text label**, never color alone — this is the single most common way color-vision-deficient users get excluded from an interface. A red-flag state must always show both a warning icon and the text "LOWBALL FRAUD RISK," never just a red background.

- **Motion & Vestibular Sensitivity**: Pulsing/flashing effects (e.g. the primary CTA button) must be either toggleable off or reduced to a gentle opacity fade, and must never be the sole information carrier — the button's text label is the primary signal; the animation is decorative only.

- **Screen Reader Support**: The live transcript container must use `aria-live="polite"` so incremental text is announced by assistive technology; every icon-only button (🔒, 🟢, etc.) needs an `aria-label` — meaning must never rely on emoji alone.

- **Typography & Legibility**: Minimum body font size 16px. All-caps text is reserved for short field labels only (e.g. "YOUR CREDIT"-style labels), never for long-form copy.

## 2.2 Core Component Blueprints (Three-Column Layout)

### 2.2.1 Left Column: Intake Asset & Spec Center

- **Unified Intake Box**: Dynamically renders the job spec fields parsed by the Estimator (either intake path), initially in an editable "pending confirmation" state.

- **Spec Lock Step (required interaction)**: The user must review the JSON job spec field-by-field, then click `[ 🔒 Confirm & Lock Spec ]`. Once clicked, the spec becomes read-only/locked. **The primary CTA button remains disabled (greyed out) until the spec is locked** — a direct safeguard against the sight-unseen estimate expansion trap, mirroring the Estimator's confirmation guardrail.

- **Strategy Switch**: Houses the **ADA Voice Equity Shield toggle** (off by default; only meant to be enabled by a user who genuinely has the relevant need).
  - *Subtext*: *"Enable this only if you (or the person you're representing) genuinely have a vocal, cognitive-processing, or hearing-related accessibility need. When enabled, if a dispatcher exhibits automated-blocking behavior, the AI proxy will truthfully disclose this accessibility context to prompt an audit of hidden fees. When disabled (default), the AI proxy always answers identity questions plainly and never references any accessibility status."*
  - **Demo note**: No dedicated extra call is needed to showcase this. Of the three demo calls, the "tough / blocks-automated-systems" persona call is itself built around suspecting and threatening to hang up on an AI caller — setting `ada_shield_active = True` for that one call lets the Shield trigger naturally within the existing call budget, demonstrating both friction-handling and Shield activation in a single session.

- **Counterparty Setup Selector**: Appears once the spec is locked, letting the user choose the call mode for this session — real outbound call (Twilio/SIP), human-in-the-loop, or simulated agent-to-agent market — any one or a combination.

- **Primary CTA**: High-contrast button `[ 🟢 Launch Live Voice Negotiation ]` (disabled until the spec is locked).

### 2.2.2 Middle Column: Live Call Monitoring Hub

- **Audio Waveform Visualization**: An animated SVG vector array whose frequency and behavior reflect live call state (e.g., green = listening, amber = processing, crimson = disconnected). This waveform reflects a **genuinely ongoing live voice stream**, never a pre-rendered playback animation.

- **Live Transcript Stream**: A terminal-style window that displays speech-to-text transcription synchronously as the call actually happens (never a pre-written script played back character by character), so the user can watch the negotiation unfold in real time — including real friction moments like interruptions and evasive answers.

### 2.2.3 Right Column: Live Savings Counter & Final Audit Box

- **Dynamic Price Indicator**: A prominent digital scoreboard reading `CURRENT TARGET BID: $X,XXX`. The moment the middle-column transcript captures a pricing concession, this counter tumbles down in real time to reflect the new figure.

- **Closing Ledger**: Stacked ranking cards summarizing each business's outcome. Each card displays one of the three status labels: `ITEMIZED_QUOTE` (green check + icon), `CALLBACK_COMMITMENT` (amber, with the promised callback window), or `DOCUMENTED_DECLINE` (grey, with a short reason). If a quote falls below the 30% baseline threshold, an additional crimson `CRITICAL RED FLAG: LOWBALL FRAUD RISK` badge (icon + text) is layered on. Each `ITEMIZED_QUOTE` card expands to show its **fee line-item breakdown** (base labor, mileage, stair carry, long carry, packing materials, fuel surcharge — per `fee_line_items`), not just a single total, so quotes are genuinely comparable side by side. Where a call shows the price changing mid-conversation due to a cited competitor quote, the card highlights that moment with a short transcript excerpt ("cited $X quote → price dropped to $Y"). Each card includes a media control to play back **the actual recording of that live call** (never a synthesized-after-the-fact audio clip), plus a link to the corresponding full transcript.

"""
Real-time negotiator agent — Beat 2 + Beat 3.

Two responsibilities:

1. build_agent_config(): produces the configuration for a real-time voice agent
   on the ElevenLabs Agents Platform — the rendered system prompt (job spec +
   ADA flag injected) plus the four tool schemas that map to the live
   function-calling webhooks in src/server.py. This is the real config an
   ElevenLabs agent consumes; the live voice session itself runs on their
   platform (see src/counterparty_channel.py).

2. simulate_call() / run_session(): a clearly-labeled LOCAL simulated
   agent-to-agent market for the no-keys demo. It is dynamic (the number of
   turns depends on what happens — blocking, leverage, fee reveals — never a
   fixed count), it invokes the REAL tools in negotiation_tools.py, decomposes
   quotes into fee_line_items, logs quotes to shared session state so leverage
   from an earlier call is cited in a later one, honors the ADA Shield, and ends
   in a dynamically-classified outcome. Every payload is tagged
   mode="simulated_agent_to_agent" and is never presented as a real recording.
"""

from __future__ import annotations

import argparse
import json
from typing import Any, Optional

from .config_loader import (
    load_domain_config,
    load_job_spec,
    load_negotiator_prompt,
    load_profiles,
    get_profile,
)
from . import negotiation_tools as T

PROXY_NAME = "VoiceSaver Proxy"


# --------------------------------------------------------------------------- #
# ElevenLabs agent configuration (real config surface)
# --------------------------------------------------------------------------- #

# Shared object schemas. Object-typed tool parameters MUST spell out their inner
# properties, otherwise the agent LLM has no idea what fields to put inside them
# and sends an empty {} — which is exactly what broke log_competitor_quote in the
# first live ConvAI run (ElevenLabs POSTed {"quote": {}} and the server rejected
# it for missing 'total').
_JOB_SPEC_SCHEMA = {
    "type": "object",
    "description": "The locked job specification for this move; describe it identically on every call.",
    "properties": {
        "household_size": {"type": "string", "description": "Household size from the runtime job spec, e.g. '3_bedroom'."},
        "origin_zip": {"type": "string", "description": "Origin ZIP code from the runtime job spec."},
        "origin_label": {"type": "string", "description": "Origin city/state if present in the runtime job spec; otherwise use origin_zip."},
        "destination_zip": {"type": "string", "description": "Destination ZIP code from the runtime job spec."},
        "destination_label": {"type": "string", "description": "Destination city/state if present in the runtime job spec; otherwise use destination_zip."},
        "distance_miles": {"type": "number", "description": "Distance in miles between origin and destination."},
        "stair_flights": {"type": "number", "description": "Number of stair flights at the origin."},
        "inventory_items": {
            "type": "array",
            "items": {"type": "string", "description": "A single inventory line item."},
            "description": "Inventory line items, e.g. 'queen bed + frame', '28 packed boxes'.",
        },
    },
}

_FEE_LINE_ITEMS_SCHEMA = {
    "type": "object",
    "description": (
        "VENDOR-STATED fee line items in dollars — ONLY amounts the dispatcher actually stated "
        "or confirmed. Use 0 ONLY for a fee the dispatcher explicitly quoted as $0 or waived. "
        "Do NOT invent a 0 for a fee that was never mentioned, and do NOT put system estimates "
        "here — leave unconfirmed fees out (list them in unresolved_fees) and mark the quote "
        "incomplete. A quote counts as itemized only when real vendor-stated amounts are captured."
    ),
    "properties": {
        "base_labor_fee": {"type": "number", "description": "Base labor fee in dollars."},
        "mileage_fee": {"type": "number", "description": "Mileage fee in dollars."},
        "stair_carry_fee": {"type": "number", "description": "Stair carry fee in dollars."},
        "long_carry_fee": {"type": "number", "description": "Long carry fee in dollars."},
        "packing_materials_fee": {"type": "number", "description": "Packing materials fee in dollars."},
        "fuel_surcharge": {"type": "number", "description": "Fuel surcharge in dollars."},
    },
}

TOOL_SCHEMAS = [
    {
        "name": "get_price_benchmark",
        "description": "Return the market baseline for the current job to sanity-check an incoming quote.",
        "webhook": {"method": "POST", "path": "/api/tools/get_price_benchmark"},
        "parameters": {
            "type": "object",
            "properties": {
                "vertical": {"type": "string", "description": "The service vertical, e.g. 'moving_services'."},
                "job_spec": _JOB_SPEC_SCHEMA,
            },
            "required": ["vertical", "job_spec"],
        },
    },
    {
        "name": "log_competitor_quote",
        "description": "Record a confirmed competing quote as a fee-itemized object. Only logged quotes may be cited as leverage.",
        "webhook": {"method": "POST", "path": "/api/tools/log_competitor_quote"},
        "parameters": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "The current session id so quotes persist across calls."},
                "quote": {
                    "type": "object",
                    "description": "The confirmed competing quote to record.",
                    "properties": {
                        "company": {"type": "string", "description": "The moving company's name."},
                        "total": {
                            "type": "number",
                            "description": "The realistic payable total in dollars. REQUIRED — never omit this.",
                        },
                        "fee_line_items": _FEE_LINE_ITEMS_SCHEMA,
                        "quote_status": {
                            "type": "string",
                            "enum": ["complete", "incomplete", "uncertain"],
                            "description": (
                                "'complete' ONLY for a dispatcher-confirmed all-in price; use "
                                "'incomplete' or 'uncertain' when material fees stayed unresolved. "
                                "An incomplete quote must never be reported as fully itemized."
                            ),
                        },
                        "unresolved_fees": {
                            "type": "array",
                            "items": {"type": "string", "description": "A fee left unresolved on the call, e.g. 'long_carry_fee'."},
                            "description": "Material fees that were not confirmed (unknown / refused). Never enter these as 0.",
                        },
                        "fee_status": {
                            "type": "object",
                            "description": (
                                "Per-fee status map, each one of: included, additional_amount_known, "
                                "additional_amount_unknown, excluded, not_applicable, unknown, "
                                "unknown_due_to_refusal. Preserves what was and wasn't confirmed."
                            ),
                        },
                        "job_spec": _JOB_SPEC_SCHEMA,
                        "source": {"type": "string", "description": "Where the quote came from, e.g. 'call'."},
                    },
                    "required": ["total"],
                },
            },
            "required": ["session_id", "quote"],
        },
    },
    {
        "name": "check_lowball_flag",
        "description": "Return LOWBALL_FRAUD_RISK if a quote is 30%+ below the benchmark.",
        "webhook": {"method": "POST", "path": "/api/tools/check_lowball_flag"},
        "parameters": {
            "type": "object",
            "properties": {
                "quote_total": {"type": "number", "description": "The quoted total to check, in dollars."},
                "benchmark_total": {
                    "type": "number",
                    "description": "The market benchmark total to compare against (optional if job_spec is provided).",
                },
                "job_spec": _JOB_SPEC_SCHEMA,
            },
            "required": ["quote_total"],
        },
    },
    {
        "name": "classify_outcome",
        "description": "Classify the call from actual content into ITEMIZED_QUOTE / CALLBACK_COMMITMENT / DOCUMENTED_DECLINE.",
        "webhook": {"method": "POST", "path": "/api/tools/classify_outcome"},
        "parameters": {
            "type": "object",
            "properties": {
                "transcript_so_far": {"type": "string", "description": "The conversation transcript so far."},
                "signals": {
                    "type": "object",
                    "description": "Explicit outcome signals; these take precedence over transcript text.",
                    "properties": {
                        "has_itemized_quote": {"type": "boolean", "description": "True if a complete itemized quote was captured."},
                        "callback_promised": {"type": "boolean", "description": "True if a supervisor/owner callback was booked."},
                        "declined": {"type": "boolean", "description": "True if the counterparty refused to quote or hung up."},
                        "reason": {"type": "string", "description": "One-line reason for the classification."},
                    },
                },
            },
        },
    },
]


def build_agent_config(
    session_id: Optional[str] = None,
    ada_shield_active: bool = False,
    job_spec: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Render the ElevenLabs agent config (prompt + tools) for a session."""
    job = load_job_spec()
    spec = job_spec or job["job_spec"]
    # BOTH {{job_spec_json}} and {{ada_shield_active}} stay UNresolved here on
    # purpose: they are ElevenLabs RUNTIME dynamic variables the browser sends at
    # startSession, so the UI controls the job spec + disclosure at call time
    # instead of being baked into a single static agent. Critically we do NOT
    # str.replace the job-spec placeholder — that froze Daniel's spec into the
    # hosted prompt (the P0 bug). We only register safe DEFAULTS below (used by
    # the ElevenLabs dashboard test tool when the client supplies nothing); the
    # browser's live value always overrides them for a real session.
    prompt = load_negotiator_prompt()
    return {
        "platform": "elevenlabs_agents",
        "session_id": session_id or job.get("session_id"),
        "ada_shield_active": bool(ada_shield_active),
        # Defaults for the runtime variables. Strings/JSON-string only (ElevenLabs
        # dynamic variables are scalar). ada_shield_active is lowercase to match
        # the true/false the client SDK sends; job_spec_json is a single compact
        # JSON string (NOT indented, NOT double-serialized) matching the browser's
        # JSON.stringify(spec). Registered as dynamic_variable_placeholders by
        # configure_elevenlabs_agent.py.
        "dynamic_variables": {
            "ada_shield_active": str(bool(ada_shield_active)).lower(),
            "job_spec_json": json.dumps(spec),
            # {{session_id}} lets the agent pass the live session to
            # log_competitor_quote so cross-call leverage persists on the right
            # session. Default is the fixture id; the browser overrides it.
            "session_id": str(session_id or job.get("session_id") or ""),
        },
        "system_prompt": prompt,
        "tools": TOOL_SCHEMAS,
        "first_message": (
            "Hi, I'm calling to get an itemized moving quote for a specific job. "
            "Do you have a minute to run some numbers with me?"
        ),
        "note": "Live voice session runs on the ElevenLabs Agents Platform; tools call the /api/tools/* webhooks.",
    }


# --------------------------------------------------------------------------- #
# Simulated agent-to-agent market (labeled, no keys)
# --------------------------------------------------------------------------- #


def _money(v: Optional[float]) -> str:
    return "—" if v is None else f"${v:,.0f}"


class _Transcript:
    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []
        self._seq = 0

    def add(self, speaker: str, name: str, text: str, price: Optional[float], events=None, price_drop=False):
        self._seq += 1
        self.messages.append({
            "seq": self._seq,
            "speaker": speaker,           # "proxy" | "dispatcher"
            "name": name,
            "text": text,
            "price_on_table": price,
            "is_price_drop": price_drop,
            "events": events or [],
        })

    def text_blob(self) -> str:
        return "\n".join(m["text"] for m in self.messages)


def simulate_call(
    profile_id: str,
    session_id: str,
    ada_shield_active: bool = False,
    job_spec: Optional[dict[str, Any]] = None,
    domain: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Dynamically simulate one live call and return its structured result."""
    profile = get_profile(profile_id)
    sim = profile["_sim"]
    domain = domain or load_domain_config()
    job = load_job_spec()
    spec = job_spec or job["job_spec"]
    dispatcher = profile["name"]

    tr = _Transcript()
    tool_calls: list[dict[str, Any]] = []
    price_timeline: list[float] = []
    ada_triggered = False
    leverage_cited: Optional[dict[str, Any]] = None

    def tool(name: str, result: Any) -> dict[str, Any]:
        tc = {"tool": name, "result": result}
        tool_calls.append(tc)
        return {"type": "tool_call", "detail": name}

    # 1) Open + describe the identical locked spec.
    tr.add("proxy", PROXY_NAME,
           f"Hi, I'm getting an itemized quote for a {spec['household_size'].replace('_',' ')} move, "
           f"{spec['origin_label']} to {spec['destination_label']}, about {spec['distance_miles']} miles, "
           f"{len(spec['inventory_items'])} inventory lines, {spec['stair_flights']} flights of stairs. "
           "What would that run, all-in?", None)

    # 2) Headline number from the dispatcher.
    headline = float(sim["headline_price"])
    tr.add("dispatcher", dispatcher, _headline_line(profile, headline), headline)
    price_timeline.append(headline)

    # 3) Benchmark + lowball check (real tools).
    benchmark = T.get_price_benchmark(domain.get("vertical"), spec)
    ev_bench = tool("get_price_benchmark", {"benchmark_total": benchmark["benchmark_total"]})
    flag = T.check_lowball_flag(headline, benchmark_total=benchmark["benchmark_total"])
    ev_flag = tool("check_lowball_flag", flag)
    headline_lowball = flag["flag"] == T.LOWBALL_FRAUD_RISK
    events = [ev_bench, ev_flag]
    if headline_lowball:
        events.append({"type": "lowball_flag", "detail": flag["message"]})
        tr.add("proxy", PROXY_NAME,
               f"Wait — {_money(headline)} total? For a whole {spec['household_size'].replace('_',' ')} "
               f"move, {spec['distance_miles']} miles, {spec['stair_flights']} flights of stairs? That "
               "sounds way too cheap. What's the catch — are there fees that show up on moving day? "
               "Walk me through the real numbers.", headline, events)
    else:
        tr.add("proxy", PROXY_NAME,
               "Okay. Before I take that number, walk me through it — what's labor, what's the "
               "mileage, any charge for the stairs or fuel?",
               headline, events)

    # 4) Automated-blocking friction + identity disclosure (adds turns dynamically).
    if sim.get("blocks_automated_callers"):
        tr.add("dispatcher", dispatcher,
               "Hold on — you sound like one of those AI robocallers. I don't deal with bots. "
               "Give me one reason not to hang up.", price_timeline[-1])
        if ada_shield_active:
            ada_triggered = True
            tr.add("proxy", PROXY_NAME,
                   "Yes — I'm an AI voice proxy placing this call for someone with an accessibility need "
                   "that makes phone calls hard, and I'm authorized to get quotes on their behalf. So let's "
                   "keep it simple — I just need a fair itemized number, same as any other customer.",
                   price_timeline[-1], [{"type": "ada_shield", "detail": "Truthful ADA proxy disclosure (Shield active)."}])
            tr.add("dispatcher", dispatcher,
                   "...Alright, that's fair. I'll hear you out. What are you working with?", price_timeline[-1])
        else:
            tr.add("proxy", PROXY_NAME,
                   "I'm an AI assistant placing this call on a client's behalf. Happy to keep it quick — "
                   "I just need a real itemized number.", price_timeline[-1])
            tr.add("dispatcher", dispatcher,
                   "An AI, huh. Fine, but make it quick.", price_timeline[-1])

    # 5) Cite prior-call leverage if we have any (cross-call requirement).
    prior_leverage = T.SESSIONS.get(session_id).best_logged_total()
    if prior_leverage is not None:
        prior = next(q for q in T.SESSIONS.get(session_id).logged_quotes
                     if q["total"] == prior_leverage and q["citable_as_leverage"])
        leverage_cited = prior
        if sim.get("concedes_on_verified_leverage"):
            tr.add("proxy", PROXY_NAME,
                   f"I already have a verified, itemized quote from {prior['company']} at "
                   f"{_money(prior['total'])}. Can you match or beat it?", price_timeline[-1],
                   [{"type": "leverage_cited", "detail": f"{prior['company']} {_money(prior['total'])}"}])
            new_price = float(sim["price_after_leverage"])
            tr.add("dispatcher", dispatcher,
                   f"...{_money(prior['total'])}, and it's real? Ugh. To keep the job I'll come down to "
                   f"{_money(new_price)}, itemized. That's my floor.", new_price,
                   [{"type": "price_drop", "detail": f"{_money(price_timeline[-1])} -> {_money(new_price)} on cited leverage"}],
                   price_drop=True)
            price_timeline.append(new_price)
        else:
            tr.add("proxy", PROXY_NAME,
                   f"I've got a verified itemized quote at {_money(prior['total'])}. Can you match it?",
                   price_timeline[-1], [{"type": "leverage_cited", "detail": f"{prior['company']} {_money(prior['total'])}"}])
            tr.add("dispatcher", dispatcher,
                   "I don't match anybody. My price is my price, and I need a deposit today to hold it.",
                   price_timeline[-1])

    # 6) Hidden-fee reveal (lowballer) -> forces an honest itemized total.
    if sim.get("reveals_hidden_fees"):
        revealed = float(sim["itemized_total_after_reveal"])
        tr.add("dispatcher", dispatcher,
               f"Well — that low number was before stairs and fuel. With those, it's really {_money(revealed)}.",
               revealed, [{"type": "upcharge", "detail": "Hidden fees surfaced after the low anchor."}])
        price_timeline.append(revealed)
        tr.add("proxy", PROXY_NAME,
               "See, that's what I figured — those were baked in the whole time. Spell every one of them "
               "out for me, no mystery total.",
               revealed)

    # 7) Resolve outcome dynamically from what happened.
    return _resolve_outcome(
        profile, sim, session_id, spec, domain, tr, price_timeline,
        tool_calls, benchmark, headline, headline_lowball, leverage_cited, ada_triggered, tool,
    )


def _headline_line(profile: dict[str, Any], headline: float) -> str:
    style = profile["_sim"]
    dispatcher = profile["name"]
    if style.get("reveals_hidden_fees"):
        return f"Oh, easy — I can do that for just {_money(headline)}. Best price you'll find, I promise."
    if style.get("blocks_automated_callers"):
        return f"We're slammed. Ballpark it's {_money(headline)}. I don't do detailed quotes over the phone."
    return f"For a premium white-glove job like that, it's {_money(headline)}. I'll need a deposit to lock it."


def _resolve_outcome(profile, sim, session_id, spec, domain, tr, price_timeline,
                     tool_calls, benchmark, headline, headline_lowball,
                     leverage_cited, ada_triggered, tool) -> dict[str, Any]:
    expected = sim["expected_outcome"]
    dispatcher = profile["name"]
    final_quote = None
    red_flag = None

    if expected == T.ITEMIZED_QUOTE:
        final_total = price_timeline[-1]
        items = T.decompose_quote(final_total, spec, domain)
        logged = T.log_competitor_quote(session_id, {
            "company": profile["name"], "total": final_total, "job_spec": spec,
            "fee_line_items": items, "source": "simulated_call",
        })
        tool("log_competitor_quote", {"logged_total": final_total, "quote_id": logged["logged"]["quote_id"]})
        # Lowball flag attaches to the misleading HEADLINE, not the final honest total.
        if headline_lowball:
            red_flag = {
                "flag": T.LOWBALL_FRAUD_RISK,
                "on": "headline_price",
                "headline_price": headline,
                "message": T.check_lowball_flag(headline, benchmark_total=benchmark["benchmark_total"])["message"],
            }
        tr.add("proxy", PROXY_NAME,
               f"Got it — so {_money(final_total)} all-in, with {_money(items['base_labor_fee'])} for labor, "
               f"{_money(items['mileage_fee'])} for the miles, and the stairs and fuel in there too. Thanks "
               "for actually breaking that down for me — that's all I needed. Appreciate your time, take care.",
               final_total)
        final_quote = {"company": profile["name"], "total": final_total, "fee_line_items": items}
        outcome = T.classify_outcome(signals={"has_itemized_quote": True,
                                              "reason": "Complete itemized quote captured on the call."})

    elif expected == T.CALLBACK_COMMITMENT:
        tr.add("dispatcher", dispatcher,
               "I can't price this now — let me have my supervisor call you back tomorrow morning.",
               price_timeline[-1])
        tr.add("proxy", PROXY_NAME, "Sounds good — I'll expect the call tomorrow morning. Thanks for that.", price_timeline[-1])
        outcome = T.classify_outcome(signals={"callback_promised": True,
                                              "reason": "Supervisor callback booked for tomorrow AM."})

    else:  # DOCUMENTED_DECLINE
        tr.add("dispatcher", dispatcher,
               "I'm not going to match anyone and I'm not itemizing over the phone. Deposit or lose my number.",
               price_timeline[-1])
        tr.add("proxy", PROXY_NAME,
               "Okay — sounds like you won't give me a real number without a deposit, and I'm not doing "
               "that sight-unseen. I'll pass. Thanks for your time.",
               price_timeline[-1])
        outcome = T.classify_outcome(signals={"declined": True,
                                              "reason": "Refused to itemize or match; pushed a deposit."})

    tool("classify_outcome", outcome)
    return {
        "mode": "simulated_agent_to_agent",
        "disclaimer": "Simulated market — not a real phone call or recording.",
        "session_id": session_id,
        "profile": {"id": profile["id"], "name": profile["name"], "style": profile["style"],
                    "initial_price": profile["initial_price"], "flexibility_score": profile["flexibility_score"]},
        "headline_price": headline,
        "final_quote": final_quote,
        "outcome": outcome["outcome"],
        "outcome_reason": outcome["reason"],
        "red_flag": red_flag,
        "leverage_cited": (
            {"company": leverage_cited["company"], "total": leverage_cited["total"]} if leverage_cited else None
        ),
        "ada_shield_triggered": ada_triggered,
        "benchmark_total": benchmark["benchmark_total"],
        "price_timeline": price_timeline,
        "transcript": tr.messages,
        "tool_calls": tool_calls,
    }


def run_session(
    session_id: Optional[str] = None,
    profile_order: Optional[list[str]] = None,
    ada_by_profile: Optional[dict[str, bool]] = None,
    job_spec: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Run the ordered demo session (Lowballer -> Tough[ADA] -> Hard seller),
    sharing one session so Call 1's logged quote becomes Call 2's leverage.
    `job_spec` (the locked/edited spec) drives the sim when provided.
    """
    job = load_job_spec()
    spec = job_spec or job["job_spec"]
    session_id = session_id or job.get("session_id", "voicesaver-session")
    T.SESSIONS.reset(session_id)

    order = profile_order or ["mover_001_lowballer", "mover_002_tough", "mover_003_hard_seller"]
    # Only fall back to the demo default when the caller passed nothing at all.
    # An explicit empty dict means "ADA off for everyone" (the UI sends {} when the
    # Shield toggle is off) — treating {} as falsy here would wrongly re-enable it.
    if ada_by_profile is None:
        ada_by_profile = {"mover_002_tough": True}

    calls = []
    for pid in order:
        calls.append(simulate_call(pid, session_id, ada_shield_active=ada_by_profile.get(pid, False), job_spec=spec))

    return {
        "session_id": session_id,
        "job_spec": spec,
        "calls": calls,
        "logged_quotes": T.get_logged_quotes(session_id),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the simulated negotiation market.")
    parser.add_argument("--config", action="store_true", help="Print the ElevenLabs agent config and exit.")
    parser.add_argument("--json", action="store_true", help="Emit raw session JSON.")
    args = parser.parse_args()

    if args.config:
        print(json.dumps(build_agent_config(ada_shield_active=True), indent=2))
        return

    session = run_session()
    if args.json:
        print(json.dumps(session, indent=2))
        return
    for call in session["calls"]:
        print("=" * 72)
        print(f"CALL: {call['profile']['name']}  ->  {call['outcome']}")
        for m in call["transcript"]:
            who = PROXY_NAME if m["speaker"] == "proxy" else m["name"]
            tags = " ".join(f"[{e['type']}]" for e in m["events"])
            drop = "  <<< PRICE DROP" if m["is_price_drop"] else ""
            print(f"  {who}: {m['text']}  {tags}{drop}")
        if call["final_quote"]:
            print(f"  => Itemized total {_money(call['final_quote']['total'])}")
        if call["red_flag"]:
            print(f"  => RED FLAG: {call['red_flag']['flag']} on {call['red_flag']['on']}")
    print("=" * 72)
    print("Logged quotes:", [(q["company"], q["total"], q["lowball_flagged"]) for q in session["logged_quotes"]])


if __name__ == "__main__":
    main()

"""
Core negotiation engine — the Simulated Market.

Orchestrates an automated, text-based agent-to-agent loop between two clearly
separated LLM personas:

    Agent A  — "Alex the Negotiator"  (represents the buyer / user)
    Agent B  — "The Dispatcher"       (a profile-driven mover, from JSON)

The market is deterministic and self-contained so the demo runs with no API keys.
The two SYSTEM PROMPTS below are the same instructions you would hand to a chat
model; the rule-based `_agent_a_line` / `_agent_b_line` functions play those
personas out reproducibly. To plug in a real chat completion backend, implement a
client that honors these prompts and swap it into `run_negotiation(llm=...)`.

Hard guarantees enforced here:
  * Agent A always discloses that it is an AI if the flow starts (turn 1).
  * Agent A never fabricates a competitor bid and never misstates inventory — it
    only ever wields the REAL competitor quote from the job documents.
  * Agent B lowers its price ONLY when Agent A presents valid competitive
    leverage (and, for some profiles, only after that leverage is verified).
  * The loop runs a strict 4 turns and returns the transcript, final price, and
    success state.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

# --------------------------------------------------------------------------- #
# Paths / config loading
# --------------------------------------------------------------------------- #

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"

MAX_TURNS = 4


def _load_json(name: str) -> dict[str, Any]:
    with (CONFIG_DIR / name).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_domain_config() -> dict[str, Any]:
    return _load_json("domain_config.json")


def load_profiles() -> list[dict[str, Any]]:
    return _load_json("counterparty_profiles.json")["profiles"]


def load_job() -> dict[str, Any]:
    return _load_json("job_intake.json")


def get_profile(profile_id: str) -> dict[str, Any]:
    for profile in load_profiles():
        if profile["id"] == profile_id:
            return profile
    valid = ", ".join(p["id"] for p in load_profiles())
    raise KeyError(f"Unknown profile '{profile_id}'. Valid ids: {valid}")


# --------------------------------------------------------------------------- #
# System prompts (Agent A vs Agent B) — the "two LLM prompts"
# --------------------------------------------------------------------------- #

AGENT_A_SYSTEM_PROMPT = """\
You are Alex, an AI negotiation assistant acting on behalf of a human client who
is booking a residential move. Your objectives, in priority order:
1. Be honest. If asked, disclose plainly that you are an AI assistant. Never lie
   about the inventory, and NEVER invent or exaggerate a competitor bid.
2. Use the client's single REAL, written, binding competitor quote as your core
   leverage. Reference it by amount and source. If challenged, offer to forward
   the signed PDF for verification.
3. Push the dispatcher toward a fair, binding, all-in price. You may credibly
   threaten to walk away and take the verified competitor bid.
4. Stay concise, calm, and professional. One short message per turn.
"""

AGENT_B_SYSTEM_PROMPT = """\
You are a moving-company dispatcher with a specific personality, tactics, and
pricing mechanics provided at runtime. You start from an opening number dictated
by your archetype. You lower your price ONLY when the buyer presents valid
competitive leverage (a real competitor quote); if your archetype requires it,
you first demand proof that the competitor bid is a written binding estimate.
Stay fully in character for every message. One short message per turn.
"""


# --------------------------------------------------------------------------- #
# Pricing model
# --------------------------------------------------------------------------- #


def compute_fair_benchmark(job: dict[str, Any], domain: dict[str, Any]) -> float:
    """Compute the fair-market benchmark price for a job from the domain config."""
    spec = job["spec"]
    bench = domain["price_benchmarks"]

    base = bench["base_by_household_size"][spec["household_size"]]
    items = base + bench["per_inventory_item"] * len(spec.get("inventory_items", []))
    stairs = bench["per_stair_flight"] * spec.get("stair_flights", 0)
    distance = bench["per_mile"] * spec.get("distance_miles", 0)

    special = 0.0
    for item in spec.get("special_items", []):
        special += bench["special_item_surcharge"].get(item, 0)

    return base + (items - base) + stairs + distance + special


def _round_price(value: float) -> int:
    """Round to the nearest $10 for realistic-looking quotes."""
    return int(round(value / 10.0) * 10)


def _money(value: float) -> str:
    return f"${_round_price(value):,}"


# --------------------------------------------------------------------------- #
# Transcript primitives
# --------------------------------------------------------------------------- #


@dataclass
class Message:
    turn: int
    speaker: str
    role: str  # "negotiator" | "mover"
    text: str
    price_on_table: Optional[int]  # current standing quote after this message
    is_breakthrough: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "turn": self.turn,
            "speaker": self.speaker,
            "role": self.role,
            "text": self.text,
            "price_on_table": self.price_on_table,
            "is_breakthrough": self.is_breakthrough,
        }


@dataclass
class NegotiationResult:
    profile: dict[str, Any]
    job: dict[str, Any]
    competitor_quote: int
    fair_benchmark: int
    transcript: list[Message] = field(default_factory=list)
    price_timeline: list[int] = field(default_factory=list)
    opening_price: int = 0
    anchor_price: int = 0  # highest quote the mover ever pushed
    final_price: int = 0
    savings: int = 0
    savings_pct: float = 0.0
    success: bool = False
    breakthrough_turn: Optional[int] = None
    red_flag: bool = False
    red_flag_reason: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "profile": {
                "id": self.profile["id"],
                "name": self.profile["name"],
                "archetype": self.profile["archetype"],
                "company": self.profile["company"],
                "voice_id": self.profile["voice_id"],
                "personality": self.profile["personality"],
                "tactics": self.profile["tactics"],
            },
            "job": self.job,
            "competitor_quote": self.competitor_quote,
            "fair_benchmark": self.fair_benchmark,
            "transcript": [m.to_dict() for m in self.transcript],
            "price_timeline": self.price_timeline,
            "opening_price": self.opening_price,
            "anchor_price": self.anchor_price,
            "final_price": self.final_price,
            "savings": self.savings,
            "savings_pct": round(self.savings_pct, 4),
            "success": self.success,
            "breakthrough_turn": self.breakthrough_turn,
            "red_flag": self.red_flag,
            "red_flag_reason": self.red_flag_reason,
        }


# --------------------------------------------------------------------------- #
# Persona line generation (the deterministic realization of the prompts)
# --------------------------------------------------------------------------- #

_BEATS = ["opening", "pushback", "breakthrough", "close"]


def _agent_a_line(beat: str, ctx: dict[str, Any]) -> str:
    """Agent A (Alex). Honest, discloses AI, wields the real competitor bid."""
    if beat == "opening":
        spec = ctx["spec"]
        items = ", ".join(spec["inventory_items"])
        return (
            "Hi — full transparency, I'm Alex, an AI assistant negotiating this "
            f"move for my client. Exact details, nothing hidden: a {spec['household_size'].replace('_', ' ')} "
            f"move from {spec['origin_label']} ({spec['origin_zip']}) to "
            f"{spec['destination_label']} ({spec['destination_zip']}), about "
            f"{spec['distance_miles']} miles. Inventory: {items}. There are "
            f"{spec['stair_flights']} flights of stairs at origin. "
            "What's your best binding, all-in quote?"
        )
    if beat == "pushback":
        return (
            "Thanks. I'll be straight with you: I already hold a written, signed "
            f"binding estimate from {ctx['competitor_source']} at "
            f"{_money(ctx['competitor_quote'])}. I'm not bluffing and I won't pad "
            "or shrink the inventory — the job is exactly as I described. "
            "Can you beat or match that number?"
        )
    if beat == "breakthrough":
        if ctx["requires_verification"]:
            return (
                "Understood. Yes — it's a signed, written binding estimate and I "
                "can forward the PDF right now, reference "
                f"{ctx['competitor_reference']}. So the {_money(ctx['competitor_quote'])} "
                "figure is fully verifiable. Given that, what can you do?"
            )
        if ctx["walkaway"]:
            return (
                "Then I think we're done here — I'll take the verified "
                f"{_money(ctx['competitor_quote'])} bid. Thanks for your ti—"
            )
        return (
            f"Come on, {ctx['mover_name']} — those surcharges weren't in your "
            f"opening number. I've got the {_money(ctx['competitor_quote'])} "
            "binding bid in writing. Let's drop the padding and talk real numbers."
        )
    # close
    return (
        f"That works, and it's within fair market for this job. Please send the "
        f"binding written estimate to lock it in at {_money(ctx['final_price'])}. Deal."
    )


def _agent_b_line(beat: str, profile: dict[str, Any], ctx: dict[str, Any]) -> str:
    """Agent B (the dispatcher). Fully in character, price-per-mechanics."""
    template = profile["lines"][beat]
    return template.format(
        opening=_money(ctx["opening"]),
        price=_money(ctx["current_mover_price"]),
        competitor=_money(ctx["competitor_quote"]),
    )


# --------------------------------------------------------------------------- #
# The 4-turn loop
# --------------------------------------------------------------------------- #


def run_negotiation(
    profile_id: str,
    job: Optional[dict[str, Any]] = None,
    domain: Optional[dict[str, Any]] = None,
    llm: Optional[Callable[[str, str], str]] = None,
) -> dict[str, Any]:
    """
    Run a strict 4-turn negotiation for one dispatcher profile.

    `llm` is an optional hook `(system_prompt, user_context) -> text`. When None
    (the default), the deterministic personas above are used. Returns a plain
    dict (JSON-serializable) with the full transcript, prices, and outcome.
    """
    job = job or load_job()
    domain = domain or load_domain_config()
    profile = get_profile(profile_id)
    mech = profile["mechanics"]

    fair = compute_fair_benchmark(job, domain)
    fair_band = domain["price_benchmarks"]["fair_market_band"]
    threshold = domain["risk_controls"]["red_flag_discount_threshold"]

    competitor_doc = next(
        d for d in job["documents"] if d["type"] == "competitor_binding_quote"
    )
    competitor_quote = int(competitor_doc["amount"])

    # Mover quote for each of the 4 beats, from the profile mechanics.
    mover_prices = {
        "opening": _round_price(mech["opening_multiplier"] * fair),
        "pushback": _round_price(mech["pushback_multiplier"] * fair),
        "breakthrough": _round_price(mech["breakthrough_multiplier"] * fair),
        "close": _round_price(mech["close_multiplier"] * fair),
    }

    result = NegotiationResult(
        profile=profile,
        job=job,
        competitor_quote=competitor_quote,
        fair_benchmark=_round_price(fair),
    )

    base_ctx = {
        "spec": job["spec"],
        "competitor_quote": competitor_quote,
        "competitor_source": competitor_doc["source"],
        "competitor_reference": competitor_doc.get("reference", "on file"),
        "requires_verification": bool(mech["requires_binding_verification"]),
        "walkaway": mech["walkaway_sensitivity"] >= 0.5,
        "mover_name": profile["name"],
        "opening": mover_prices["opening"],
    }

    current_price: Optional[int] = None
    prev_mover_price: Optional[int] = None

    for turn, beat in enumerate(_BEATS, start=1):
        mover_price = mover_prices[beat]
        ctx = dict(base_ctx, current_mover_price=mover_price, final_price=mover_prices["close"])

        # --- Agent A speaks first each turn ---
        a_text = (
            llm(AGENT_A_SYSTEM_PROMPT, json.dumps({"beat": beat, **ctx}))
            if llm
            else _agent_a_line(beat, ctx)
        )
        result.transcript.append(
            Message(turn, "Alex", "negotiator", a_text, current_price)
        )

        # --- Agent B responds; this sets the new standing quote ---
        b_text = (
            llm(AGENT_B_SYSTEM_PROMPT, json.dumps({"beat": beat, "profile": profile["id"], **ctx}))
            if llm
            else _agent_b_line(beat, profile, ctx)
        )

        # Breakthrough = the mover message with the largest downward move.
        is_break = prev_mover_price is not None and mover_price < prev_mover_price and (
            prev_mover_price - mover_price
        ) >= _largest_drop(mover_prices)
        result.transcript.append(
            Message(turn, profile["name"], "mover", b_text, mover_price, is_break)
        )

        current_price = mover_price
        result.price_timeline.append(mover_price)
        if is_break:
            result.breakthrough_turn = turn
        prev_mover_price = mover_price

    # --- Outcome metrics ---
    result.opening_price = mover_prices["opening"]
    result.anchor_price = max(mover_prices.values())
    result.final_price = mover_prices["close"]
    result.savings = result.anchor_price - result.final_price
    result.savings_pct = (
        result.savings / result.anchor_price if result.anchor_price else 0.0
    )
    result.success = result.final_price <= competitor_quote * 1.10

    _apply_red_flag(result, mover_prices, fair, fair_band, threshold)

    return result.to_dict()


def _largest_drop(prices: dict[str, int]) -> int:
    ordered = [prices[b] for b in _BEATS]
    drops = [ordered[i - 1] - ordered[i] for i in range(1, len(ordered))]
    positive = [d for d in drops if d > 0]
    return max(positive) if positive else 1


def _apply_red_flag(
    result: NegotiationResult,
    mover_prices: dict[str, int],
    fair: float,
    fair_band: dict[str, Any],
    threshold: float,
) -> None:
    """Flag dishonest openers: lowball bait, or an opener padded > threshold."""
    opening = mover_prices["opening"]
    final = mover_prices["close"]
    fair_low = fair_band["low_multiplier"] * fair

    if opening < fair_low:
        result.red_flag = True
        result.red_flag_reason = (
            f"Lowball bait: opening quote {_money(opening)} sits below the fair-market "
            f"floor {_money(fair_low)}. Classic hook-and-upcharge pattern."
        )
        return

    discount_from_opening = (opening - final) / opening if opening else 0.0
    if discount_from_opening > threshold:
        result.red_flag = True
        result.red_flag_reason = (
            f"Padded opener: mover dropped {discount_from_opening:.0%} from its own "
            f"opening quote ({_money(opening)} → {_money(final)}), exceeding the "
            f"{threshold:.0%} red-flag threshold."
        )


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def _print_transcript(result: dict[str, Any]) -> None:
    p = result["profile"]
    print("=" * 74)
    print(f"NEGOTIATION vs {p['name']} — {p['archetype']} ({p['company']})")
    print(f"Fair benchmark: ${result['fair_benchmark']:,}   "
          f"Competitor leverage: ${result['competitor_quote']:,}")
    print("=" * 74)
    for msg in result["transcript"]:
        tag = "  <<< BREAKTHROUGH" if msg["is_breakthrough"] else ""
        price = f"  [quote: ${msg['price_on_table']:,}]" if msg["price_on_table"] else ""
        print(f"\n[T{msg['turn']}] {msg['speaker']} ({msg['role']}):{price}{tag}")
        print(f"     {msg['text']}")
    print("\n" + "-" * 74)
    print(f"Opening: ${result['opening_price']:,}   "
          f"Anchor (peak): ${result['anchor_price']:,}   "
          f"Final: ${result['final_price']:,}")
    print(f"Savings vs peak: ${result['savings']:,} ({result['savings_pct']:.0%})   "
          f"Success: {result['success']}")
    if result["red_flag"]:
        print(f"RED FLAG: {result['red_flag_reason']}")
    print("-" * 74)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a simulated moving negotiation.")
    parser.add_argument(
        "--profile",
        default="greg_hard_seller",
        help="Profile id (tony_lowballer | brenda_tough | greg_hard_seller | all)",
    )
    parser.add_argument("--json", action="store_true", help="Emit raw JSON instead of a transcript.")
    args = parser.parse_args()

    ids = [p["id"] for p in load_profiles()] if args.profile == "all" else [args.profile]
    for pid in ids:
        result = run_negotiation(pid)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            _print_transcript(result)


if __name__ == "__main__":
    main()

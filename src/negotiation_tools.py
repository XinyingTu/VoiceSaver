"""
Negotiation tools — the function-calling surface exposed to the live agent.

These four tools are what the ElevenLabs Conversational Agent invokes DURING a
real call (via Agent Tools / server webhooks), and what the local simulated
market calls too. They are pure, deterministic, and fully testable:

    get_price_benchmark(vertical, job_spec)   -> market baseline for the job
    log_competitor_quote(session_id, quote)   -> structured, fee-itemized log
    check_lowball_flag(quote, benchmark)      -> LOWBALL_FRAUD_RISK vs benchmark
    classify_outcome(transcript_so_far)       -> one of three deterministic states

Logged quotes persist against a shared `session_id` so a quote gathered in an
earlier call can be cited as leverage in a later call (the cross-call leverage
requirement). Persistence is a simple in-memory store here; swap `SessionStore`
for Redis/DB to scale.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from .config_loader import load_domain_config

# Deterministic outcome states.
ITEMIZED_QUOTE = "ITEMIZED_QUOTE"
CALLBACK_COMMITMENT = "CALLBACK_COMMITMENT"
DOCUMENTED_DECLINE = "DOCUMENTED_DECLINE"
OUTCOME_STATES = (ITEMIZED_QUOTE, CALLBACK_COMMITMENT, DOCUMENTED_DECLINE)

LOWBALL_FRAUD_RISK = "LOWBALL_FRAUD_RISK"


# --------------------------------------------------------------------------- #
# Cross-call session state
# --------------------------------------------------------------------------- #


@dataclass
class Session:
    session_id: str
    logged_quotes: list[dict[str, Any]] = field(default_factory=list)

    def best_logged_total(self) -> Optional[float]:
        totals = [q["total"] for q in self.logged_quotes if not q.get("lowball_flagged")]
        return min(totals) if totals else None


class SessionStore:
    """In-memory store of logged quotes keyed by session_id."""

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def get(self, session_id: str) -> Session:
        return self._sessions.setdefault(session_id, Session(session_id))

    def reset(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)


# Module-level singleton (shared by the server webhooks and the sim market).
SESSIONS = SessionStore()


# --------------------------------------------------------------------------- #
# Pricing helpers
# --------------------------------------------------------------------------- #


def _round2(value: float) -> float:
    return round(float(value) + 1e-9, 2)


def compute_job_benchmark(job_spec: dict[str, Any], domain: Optional[dict[str, Any]] = None) -> float:
    """
    Job-specific market baseline. Anchored on the vertical's average 2-bedroom
    total, scaled by household size, with a mild adjustment for long distance.
    """
    domain = domain or load_domain_config()
    bench = domain["benchmarks"]
    ext = domain.get("_extended", {})

    base = bench["average_2_bedroom_move_total"]
    mult = ext.get("household_size_multiplier", {}).get(job_spec.get("household_size"), 1.0)
    miles = job_spec.get("distance_miles", 0)
    included_miles = 50
    distance_adj = max(0, miles - included_miles) * bench["base_rate_per_mile"] * 0.5

    return _round2(base * mult + distance_adj)


def decompose_quote(total: float, job_spec: dict[str, Any], domain: Optional[dict[str, Any]] = None) -> dict[str, float]:
    """
    Break a single total into the named fee_line_items so quotes are comparable.
    The line items always sum exactly to `total`; base_labor_fee absorbs the
    remainder (labor is the dominant, variable component of a move).
    """
    domain = domain or load_domain_config()
    bench = domain["benchmarks"]
    rates = domain.get("_extended", {}).get("line_item_rates", {})

    miles = job_spec.get("distance_miles", 0)
    flights = job_spec.get("stair_flights", 0)

    mileage_fee = _round2(bench["base_rate_per_mile"] * miles)
    stair_carry_fee = _round2(rates.get("stair_carry_fee_per_flight", 0.0) * flights)
    long_carry_fee = _round2(rates.get("long_carry_fee_flat", 0.0))
    packing_materials_fee = _round2(rates.get("packing_materials_fee_flat", 0.0))
    fuel_surcharge = _round2(rates.get("fuel_surcharge_pct_of_transport", 0.0) * mileage_fee)

    fixed = mileage_fee + stair_carry_fee + long_carry_fee + packing_materials_fee + fuel_surcharge
    base_labor_fee = _round2(max(total - fixed, 0.0))

    return {
        "base_labor_fee": base_labor_fee,
        "mileage_fee": mileage_fee,
        "stair_carry_fee": stair_carry_fee,
        "long_carry_fee": long_carry_fee,
        "packing_materials_fee": packing_materials_fee,
        "fuel_surcharge": fuel_surcharge,
    }


# --------------------------------------------------------------------------- #
# Tool 1: get_price_benchmark
# --------------------------------------------------------------------------- #


def get_price_benchmark(vertical: str, job_spec: dict[str, Any]) -> dict[str, Any]:
    domain = load_domain_config()
    if vertical and vertical != domain.get("vertical"):
        # Vertical-agnostic: we only have one config loaded at a time.
        pass
    benchmark_total = compute_job_benchmark(job_spec, domain)
    return {
        "vertical": domain.get("vertical"),
        "benchmark_total": benchmark_total,
        "average_2_bedroom_move_total": domain["benchmarks"]["average_2_bedroom_move_total"],
        "base_rate_per_mile": domain["benchmarks"]["base_rate_per_mile"],
        "red_flag_discount_threshold": domain["benchmarks"]["red_flag_discount_threshold"],
        "source": "config/domain_config.json",
    }


# --------------------------------------------------------------------------- #
# Tool 2: log_competitor_quote
# --------------------------------------------------------------------------- #


QUOTE_STATUS_VALUES = ("complete", "incomplete", "uncertain", "estimated")
FEE_STATUS_VALUES = (
    "included",
    "additional_amount_known",
    "additional_amount_unknown",
    "excluded",
    "not_applicable",
    "unknown",
    "unknown_due_to_refusal",
)


def valid_fee_keys(domain: Optional[dict[str, Any]] = None) -> tuple[str, ...]:
    """The configured vertical's fee taxonomy (config/domain_config.json)."""
    domain = domain or load_domain_config()
    return tuple(domain.get("fee_line_items", []))


def _validate_fee_items(items: Optional[dict[str, Any]], domain: dict[str, Any]) -> dict[str, float]:
    """Keep only fee keys that exist in the configured vertical taxonomy.

    Off-taxonomy keys are dropped rather than stored, so a live quote can never
    smuggle in an unrecognized fee line. Values are rounded to cents.
    """
    allowed = set(valid_fee_keys(domain))
    return {k: _round2(v) for k, v in (items or {}).items() if k in allowed and v is not None}


def quote_is_itemized(logged_quote: dict[str, Any]) -> bool:
    """A quote counts as itemized ONLY when meaningful vendor-stated line-item
    amounts were captured. A system estimate (line_items_source == 'estimated')
    never qualifies, no matter how many estimated lines it carries."""
    return (
        logged_quote.get("line_items_source") == "vendor_stated"
        and bool(logged_quote.get("fee_line_items"))
    )


def log_competitor_quote(session_id: str, quote: dict[str, Any]) -> dict[str, Any]:
    """
    Record a competing quote as a structured object, keeping system estimates
    strictly separate from dispatcher-stated numbers. `quote` requires at least
    {company, total}. Only quotes logged here may later be cited as leverage.

    Fee data integrity:
      - `fee_line_items` holds ONLY amounts the dispatcher actually stated (what
        the agent passed in). It is NEVER auto-filled by decompose_quote, so a
        generated estimate can never masquerade as a vendor-stated line.
      - When no vendor line items are supplied, a system estimate is stored in the
        separate optional field `estimated_fee_line_items` (clearly labeled), and
        `fee_line_items` stays empty — unknown fees are never coerced to 0.
      - `line_items_source` is "vendor_stated" only when the dispatcher's own
        numbers were captured; otherwise "estimated".
      - `is_itemized` (see quote_is_itemized) is True only for a real vendor-stated
        breakdown, so an estimated quote never qualifies as ITEMIZED_QUOTE.
      - `quote_status`, `fee_status`, and `unresolved_fees` preserve what was and
        wasn't confirmed, so an incomplete quote is recorded honestly.
      - Fee keys are validated against the configured vertical fee taxonomy.
    """
    if "total" not in quote:
        raise ValueError("quote must include a numeric 'total'.")

    domain = load_domain_config()
    job_spec = quote.get("job_spec") or {}
    total = float(quote["total"])

    # Vendor-stated line items ONLY — never a fallback decomposition.
    vendor_items = _validate_fee_items(quote.get("fee_line_items"), domain)
    if vendor_items:
        line_items_source = "vendor_stated"
        # Preserve a caller-supplied estimate if present, but keep it separate.
        estimated_items = _validate_fee_items(quote.get("estimated_fee_line_items"), domain)
    else:
        line_items_source = "estimated"
        # Optional, clearly-separated estimate for internal evaluation only.
        supplied_est = quote.get("estimated_fee_line_items")
        estimated_items = (
            _validate_fee_items(supplied_est, domain) if supplied_est
            else _validate_fee_items(decompose_quote(total, job_spec, domain), domain)
        )

    benchmark_total = compute_job_benchmark(job_spec, domain) if job_spec else None
    flag = (
        check_lowball_flag(total, benchmark_total)["flag"] == LOWBALL_FRAUD_RISK
        if benchmark_total
        else False
    )

    # Preserve an explicit status if the agent set one; otherwise infer a safe
    # default (a vendor-stated breakdown is "complete"; an estimate-only quote is
    # "estimated", never silently claimed complete).
    quote_status = quote.get("quote_status") or ("complete" if vendor_items else "estimated")
    fee_status = quote.get("fee_status") or {}
    unresolved_fees = quote.get("unresolved_fees") or []

    session = SESSIONS.get(session_id)
    logged = {
        "quote_id": f"q{len(session.logged_quotes) + 1:03d}",
        "company": quote.get("company", "unknown"),
        "source": quote.get("source", "call"),
        "total": _round2(total),
        "fee_line_items": vendor_items,
        "estimated_fee_line_items": estimated_items,
        "line_items_source": line_items_source,
        "quote_status": quote_status,
        "fee_status": fee_status,
        "unresolved_fees": list(unresolved_fees),
        "lowball_flagged": bool(flag),
        "citable_as_leverage": not bool(flag),
    }
    logged["is_itemized"] = quote_is_itemized(logged)
    session.logged_quotes.append(logged)
    return {
        "logged": logged,
        "session_id": session_id,
        "logged_count": len(session.logged_quotes),
        "best_citable_leverage": session.best_logged_total(),
    }


def get_logged_quotes(session_id: str) -> list[dict[str, Any]]:
    return list(SESSIONS.get(session_id).logged_quotes)


# --------------------------------------------------------------------------- #
# Tool 3: check_lowball_flag
# --------------------------------------------------------------------------- #


def check_lowball_flag(
    quote_total: float,
    benchmark_total: Optional[float] = None,
    job_spec: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Flag a quote as LOWBALL_FRAUD_RISK if it is >= threshold below benchmark.
    Provide either an explicit benchmark_total or a job_spec to derive one.
    """
    domain = load_domain_config()
    threshold = domain["benchmarks"]["red_flag_discount_threshold"]
    if benchmark_total is None:
        if job_spec is None:
            raise ValueError("Provide benchmark_total or job_spec.")
        benchmark_total = compute_job_benchmark(job_spec, domain)

    quote_total = float(quote_total)
    discount = (benchmark_total - quote_total) / benchmark_total if benchmark_total else 0.0
    is_lowball = discount >= threshold

    return {
        "flag": LOWBALL_FRAUD_RISK if is_lowball else "OK",
        "quote_total": _round2(quote_total),
        "benchmark_total": _round2(benchmark_total),
        "discount_vs_benchmark": round(discount, 4),
        "threshold": threshold,
        "message": (
            f"Quote {quote_total:.0f} is {discount:.0%} below the {benchmark_total:.0f} "
            f"benchmark — at or beyond the {threshold:.0%} threshold. Treat as a possible "
            "lowball / bait-and-switch fraud risk (FMCSA), not a competitive win."
            if is_lowball
            else f"Quote {quote_total:.0f} is within a normal band of the {benchmark_total:.0f} benchmark."
        ),
    }


# --------------------------------------------------------------------------- #
# Tool 4: classify_outcome
# --------------------------------------------------------------------------- #

_DECLINE_MARKERS = (
    "not going to give",
    "won't quote",
    "not giving you a quote",
    "no quote",
    "hang up",
    "hanging up",
    "lose my number",
    "don't call back",
    "we're done",
    "refuse",
)
_CALLBACK_MARKERS = (
    "call you back",
    "have someone call",
    "supervisor will call",
    "manager will call",
    "owner will call",
    "get back to you",
    "call you tomorrow",
)
_ITEMIZED_MARKERS = (
    "base labor",
    "mileage",
    "stair",
    "fuel surcharge",
    "packing",
    "itemized",
    "all-in",
    "total comes to",
    "your total",
)


def classify_outcome(
    transcript_so_far: str = "",
    signals: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Classify a call into exactly one deterministic state from actual content —
    NOT a fixed number of turns. Accepts free transcript text (keyword evidence)
    and/or an explicit `signals` dict {has_itemized_quote, callback_promised,
    declined}. Explicit signals win when provided.
    """
    signals = signals or {}
    if signals.get("declined"):
        return {"outcome": DOCUMENTED_DECLINE, "reason": signals.get("reason", "Counterparty refused to quote or hung up.")}
    if signals.get("has_itemized_quote"):
        return {"outcome": ITEMIZED_QUOTE, "reason": signals.get("reason", "A complete itemized quote was captured.")}
    if signals.get("callback_promised"):
        return {"outcome": CALLBACK_COMMITMENT, "reason": signals.get("reason", "A supervisor callback was booked.")}

    text = (transcript_so_far or "").lower()
    has_decline = any(m in text for m in _DECLINE_MARKERS)
    has_callback = any(m in text for m in _CALLBACK_MARKERS)
    itemized_hits = sum(1 for m in _ITEMIZED_MARKERS if m in text)

    # A clear itemized quote (several fee terms present) wins over friction noise.
    if itemized_hits >= 2 and not has_decline:
        return {"outcome": ITEMIZED_QUOTE, "reason": f"Detected {itemized_hits} itemized fee references."}
    if has_decline:
        return {"outcome": DOCUMENTED_DECLINE, "reason": "Detected a refusal / hang-up in the transcript."}
    if has_callback:
        return {"outcome": CALLBACK_COMMITMENT, "reason": "Detected a callback commitment in the transcript."}
    return {"outcome": DOCUMENTED_DECLINE, "reason": "No comparable quote or callback was obtained."}

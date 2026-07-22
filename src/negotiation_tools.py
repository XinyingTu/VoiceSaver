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
    # Structured live offer events (record_offer_event). Kept SEPARATE from
    # logged_quotes: these represent the vendor's price MOVING during a call
    # (initial -> revised -> final), which the once-at-close log cannot express.
    offer_events: list[dict[str, Any]] = field(default_factory=list)

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
# Tool 5: record_offer_event  (live, structured vendor-offer movement)
# --------------------------------------------------------------------------- #
#
# WHY a separate tool: log_competitor_quote is called ONCE at the close and
# records the final dossier. It cannot represent the vendor's price MOVING during
# the call (initial -> revised -> final), nor distinguish a deposit / unit rate /
# optional fee / competitor quote / benchmark from the vendor's payable total.
# record_offer_event captures each structured movement so the live UI can show a
# trustworthy price basis instead of "the last number anyone said". It does NOT
# replace log_competitor_quote.

# Roles an event's amount can play. These are NEVER interchangeable: a benchmark,
# a competitor quote, a deposit, an optional fee, and a per-unit rate can never be
# substituted for the vendor's payable total.
OFFER_EVENT_ROLES = (
    "initial_vendor_offer",
    "revised_vendor_offer",
    "final_confirmed_offer",
    "known_base_or_subtotal",
    "known_mandatory_addition",
    "unresolved_mandatory_fee",
    "deposit",
    "optional_fee",
    "unit_rate",
    "verified_competitor_quote",
    "market_benchmark",
)
# Roles whose amount moves the vendor's payable-total basis.
_VENDOR_TOTAL_ROLES = ("initial_vendor_offer", "revised_vendor_offer", "known_base_or_subtotal", "final_confirmed_offer")
# The only role that legitimately carries no amount (it is an unpriced fee).
_NO_AMOUNT_ROLE = "unresolved_mandatory_fee"


def record_offer_event(session_id: str, event: dict[str, Any]) -> dict[str, Any]:
    """
    Record ONE structured vendor-offer movement for a live call, isolated by
    session, validated deterministically, and idempotent by ``event_id``.

    ``event`` fields:
      - role (required): one of OFFER_EVENT_ROLES.
      - amount: required (and must be a positive number) for every role EXCEPT
        ``unresolved_mandatory_fee``. Non-positive / non-numeric amounts are
        rejected — an unknown fee is preserved as unresolved, never coerced to 0.
      - fee_key / label: identifies the fee for addition/unresolved roles.
      - vendor / call_id: identify the vendor/call this movement belongs to.
      - evidence: the transcript line that supports the amount (preserved).
      - event_id: optional client id for idempotent de-duplication.
      - is_estimate: marks a working offer as a non-binding estimate.

    Returns the stored event plus the deterministically-derived offer state.
    """
    if not session_id:
        raise ValueError("record_offer_event requires a session_id.")
    role = event.get("role")
    if role not in OFFER_EVENT_ROLES:
        raise ValueError(f"role must be one of {OFFER_EVENT_ROLES}; got {role!r}.")

    amount = event.get("amount")
    if role == _NO_AMOUNT_ROLE:
        if not (event.get("fee_key") or event.get("label")):
            raise ValueError("unresolved_mandatory_fee requires a fee_key or label.")
        amount = None
    else:
        try:
            amount = float(amount)
        except (TypeError, ValueError):
            raise ValueError(f"role {role} requires a numeric amount.")
        if not (amount > 0):
            raise ValueError(f"role {role} requires a positive amount; got {amount}.")

    session = SESSIONS.get(session_id)

    # Idempotency: a repeated event_id returns the already-stored event.
    event_id = event.get("event_id")
    if event_id:
        existing = next((e for e in session.offer_events if e.get("event_id") == event_id), None)
        if existing is not None:
            return {
                "recorded": existing,
                "session_id": session_id,
                "event_count": len(session.offer_events),
                "offer_state": derive_offer_state(session.offer_events),
                "deduped": True,
            }

    stored = {
        "event_id": event_id or f"e{len(session.offer_events) + 1:03d}",
        "role": role,
        "amount": _round2(amount) if amount is not None else None,
        "fee_key": event.get("fee_key"),
        "label": event.get("label"),
        "vendor": event.get("vendor") or event.get("company") or "unknown",
        "call_id": event.get("call_id") or "call",
        "is_estimate": bool(event.get("is_estimate", False)),
        "evidence": event.get("evidence"),
    }
    session.offer_events.append(stored)
    return {
        "recorded": stored,
        "session_id": session_id,
        "event_count": len(session.offer_events),
        "offer_state": derive_offer_state(session.offer_events),
        "deduped": False,
    }


def get_offer_events(session_id: str) -> list[dict[str, Any]]:
    return list(SESSIONS.get(session_id).offer_events)


def derive_offer_state(events: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Deterministically fold structured offer events into the authoritative live
    offer state. This mirrors the frontend reducer (offerState.js) so the two
    never disagree, and gives the backend guard a testable surface. Roles that
    are not a vendor payable total (benchmark, competitor, deposit, optional,
    unit rate) never move the total.
    """
    initial_total: Optional[float] = None
    known_base: Optional[float] = None
    all_in = False
    latest_is_estimate = False
    additions: list[dict[str, Any]] = []
    unresolved: list[str] = []
    deposit: Optional[float] = None
    optional_fees: list[dict[str, Any]] = []
    unit_rates: list[dict[str, Any]] = []

    for ev in events:
        role = ev.get("role")
        amt = ev.get("amount")
        if role in _VENDOR_TOTAL_ROLES:
            if amt is None:
                continue
            if initial_total is None:
                initial_total = amt
            known_base = amt
            if role == "final_confirmed_offer":
                all_in = True
                # An all-in restatement subsumes the earlier itemized lines — do
                # not add them again on top of it (mirrors offerState.js).
                additions = []
            latest_is_estimate = bool(ev.get("is_estimate")) and role != "final_confirmed_offer"
        elif role == "known_mandatory_addition":
            key = ev.get("fee_key") or ev.get("label")
            if amt is not None:
                additions.append({"key": key, "label": ev.get("label") or key, "amount": amt})
                unresolved = [u for u in unresolved if u != key]
            elif key and key not in unresolved:
                unresolved.append(key)
        elif role == "unresolved_mandatory_fee":
            key = ev.get("fee_key") or ev.get("label")
            if key and key not in unresolved and not any(a["key"] == key for a in additions):
                unresolved.append(key)
        elif role == "deposit":
            deposit = amt
        elif role == "optional_fee":
            optional_fees.append({"label": ev.get("label") or "optional", "amount": amt})
        elif role == "unit_rate":
            unit_rates.append({"label": ev.get("label") or "rate", "amount": amt})
        # verified_competitor_quote / market_benchmark: never touch the total.

    current_known_total = (
        _round2(known_base + sum(a["amount"] for a in additions)) if known_base is not None else None
    )
    has_unresolved = len(unresolved) > 0
    final_confirmed_total = current_known_total if (all_in and not has_unresolved and current_known_total is not None) else None
    negotiated_savings = (
        _round2(initial_total - known_base)
        if (initial_total is not None and known_base is not None and known_base < initial_total)
        else None
    )

    if known_base is None:
        price_basis = "awaiting"
    elif has_unresolved:
        price_basis = "known_base_plus_unresolved_fees"
    elif all_in:
        price_basis = "all_in_confirmed"
    elif latest_is_estimate:
        price_basis = "estimate"
    else:
        price_basis = "working_offer"

    return {
        "initial_total": initial_total,
        "known_base": known_base,
        "current_known_total": current_known_total,
        "final_confirmed_total": final_confirmed_total,
        "price_basis": price_basis,
        "mandatory_additions": additions,
        "unresolved_fees": unresolved,
        "deposit": deposit,
        "optional_fees": optional_fees,
        "unit_rates": unit_rates,
        "negotiated_savings": negotiated_savings,
        # A total-only structured stream is never itemized; only real vendor line
        # items (via log_competitor_quote) make a quote itemized.
        "is_itemized": False,
    }


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

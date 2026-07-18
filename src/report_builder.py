"""
Report aggregation — Beat 3 Closing Dossier / Closing Ledger.

Turns a completed session (a list of calls) into a ranked, plain-language ledger
backed by verifiable transcript excerpts, itemized fee breakdowns, red-flag
badges, outcome classifications, and (simulated) recording references. This is
the payload the right-column Closing Ledger renders.
"""

from __future__ import annotations

from typing import Any, Optional

from . import negotiation_tools as T
from .config_loader import load_domain_config

_OUTCOME_RANK = {T.ITEMIZED_QUOTE: 0, T.CALLBACK_COMMITMENT: 1, T.DOCUMENTED_DECLINE: 2}


def _price_drop_excerpt(call: dict[str, Any]) -> Optional[dict[str, Any]]:
    drop = next((m for m in call["transcript"] if m.get("is_price_drop")), None)
    if not drop:
        return None
    timeline = call["price_timeline"]
    before = timeline[-2] if len(timeline) >= 2 else timeline[0]
    after = drop["price_on_table"]
    lev = call.get("leverage_cited")
    cited = f"${lev['total']:,.0f} ({lev['company']})" if lev else "a verified competitor quote"
    return {
        "text": f"Cited {cited} → price dropped ${before:,.0f} to ${after:,.0f}.",
        "quote": drop["text"],
        "price_before": before,
        "price_after": after,
    }


def _card_for_call(call: dict[str, Any], rank: int) -> dict[str, Any]:
    outcome = call["outcome"]
    quote = call.get("final_quote")
    card: dict[str, Any] = {
        "rank": rank,
        "profile_id": call["profile"]["id"],
        "company": call["profile"]["name"],
        "style": call["profile"]["style"],
        "outcome": outcome,
        "outcome_reason": call["outcome_reason"],
        "ada_shield_triggered": call.get("ada_shield_triggered", False),
        "leverage_cited": call.get("leverage_cited"),
        "price_drop": _price_drop_excerpt(call),
        "recording": {
            "filename": f"sim_playback_{call['profile']['id']}.wav",
            "url": f"/api/audio/{call['profile']['id']}",
            "is_real_recording": False,
            "label": "Simulated market playback — not a real call recording.",
        },
        "transcript_ref": f"/api/session/transcript/{call['profile']['id']}",
        "red_flag": None,
        "itemized_total": None,
        "fee_line_items": None,
    }

    if call.get("red_flag"):
        rf = call["red_flag"]
        card["red_flag"] = {
            "label": "LOWBALL FRAUD RISK",
            "code": rf["flag"],
            "on": rf.get("on"),
            "headline_price": rf.get("headline_price"),
            "message": rf.get("message"),
        }

    if outcome == T.ITEMIZED_QUOTE and quote:
        card["itemized_total"] = quote["total"]
        card["fee_line_items"] = quote["fee_line_items"]
    elif outcome == T.CALLBACK_COMMITMENT:
        card["callback_window"] = "Tomorrow, morning (per dispatcher)."
    elif outcome == T.DOCUMENTED_DECLINE:
        card["decline_reason"] = call["outcome_reason"]

    return card


def build_report(session: dict[str, Any]) -> dict[str, Any]:
    domain = load_domain_config()
    calls = session["calls"]

    # Rank: itemized (cheapest first) above callbacks above declines.
    def sort_key(call: dict[str, Any]):
        total = call["final_quote"]["total"] if call.get("final_quote") else float("inf")
        return (_OUTCOME_RANK.get(call["outcome"], 9), total)

    ordered = sorted(calls, key=sort_key)
    ledger = [_card_for_call(call, rank=i + 1) for i, call in enumerate(ordered)]

    itemized = [c for c in ledger if c["outcome"] == T.ITEMIZED_QUOTE and not c["red_flag"]]
    winner = itemized[0] if itemized else None

    all_totals = [c["itemized_total"] for c in ledger if c["itemized_total"]]
    highest = max(all_totals) if all_totals else None
    benchmark = domain["benchmarks"]["average_2_bedroom_move_total"]

    savings_summary = None
    if winner and highest:
        savings_summary = {
            "recommended_total": winner["itemized_total"],
            "highest_itemized_total": highest,
            "savings_vs_highest": round(highest - winner["itemized_total"], 2),
            "benchmark_total": benchmark,
            "savings_vs_benchmark": round(benchmark - winner["itemized_total"], 2),
        }

    recommendation = (
        f"Recommended: {winner['company']} at ${winner['itemized_total']:,.0f} (itemized, no fraud flag)."
        if winner else
        "No clean itemized quote was obtained; see callback/decline outcomes below."
    )

    return {
        "session_id": session["session_id"],
        "job_spec": session["job_spec"],
        "benchmark_total": benchmark,
        "ledger": ledger,
        "recommendation": recommendation,
        "savings_summary": savings_summary,
        "outcome_counts": {
            state: sum(1 for c in ledger if c["outcome"] == state)
            for state in T.OUTCOME_STATES
        },
        "logged_quotes": session.get("logged_quotes", []),
    }

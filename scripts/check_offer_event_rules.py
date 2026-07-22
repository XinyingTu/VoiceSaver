"""
Regression guard for the structured live-offer model (record_offer_event) and
its deterministic state derivation.

Standalone check (the repo has no pytest harness — same convention as
scripts/check_realism_rules.py and scripts/check_quote_sufficiency_rules.py).
Exit code is non-zero on any violation so it can gate CI / pre-flight.

What it proves (the backend half of "the transcript is evidence, not the price
state"):
  A. VALIDATION — invalid roles, non-positive/missing amounts, an unresolved fee
     with no identifier, and a missing session_id are all rejected. An unknown
     fee is preserved as unresolved, never coerced to $0.
  B. ISOLATION — events are isolated per session_id.
  C. IDEMPOTENCY — a repeated event_id is de-duplicated.
  D. DERIVATION — a deposit / optional fee / unit rate / competitor quote /
     benchmark NEVER becomes the vendor payable total; a revised offer yields a
     negotiated reduction; an unresolved mandatory fee keeps the final total
     unknown; a confirmed mandatory addition raises the known total.
  E. WIRING — the tool is registered in the hosted-agent config and does NOT
     replace log_competitor_quote (both remain).

Usage:
    python scripts/check_offer_event_rules.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import negotiation_tools as T  # noqa: E402
from src.negotiator_agent import build_agent_config  # noqa: E402

FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  ok  - {name}")
    else:
        FAILURES.append(f"{name}: {detail}")
        print(f"  FAIL- {name}: {detail}")


def expect_reject(name: str, fn) -> None:
    try:
        fn()
    except ValueError:
        print(f"  ok  - {name} (rejected)")
    except Exception as exc:  # pragma: no cover - defensive
        FAILURES.append(f"{name}: wrong error type {type(exc).__name__}")
        print(f"  FAIL- {name}: wrong error type {type(exc).__name__}")
    else:
        FAILURES.append(f"{name}: was NOT rejected")
        print(f"  FAIL- {name}: was NOT rejected")


def main() -> int:
    # ── A. Validation ──────────────────────────────────────────────────────
    print("A. Validation")
    T.SESSIONS.reset("s-val")
    expect_reject("unknown role", lambda: T.record_offer_event("s-val", {"role": "bogus", "amount": 100}))
    expect_reject("non-positive amount", lambda: T.record_offer_event("s-val", {"role": "initial_vendor_offer", "amount": 0}))
    expect_reject("negative amount", lambda: T.record_offer_event("s-val", {"role": "revised_vendor_offer", "amount": -50}))
    expect_reject("missing amount", lambda: T.record_offer_event("s-val", {"role": "deposit"}))
    expect_reject("non-numeric amount", lambda: T.record_offer_event("s-val", {"role": "deposit", "amount": "lots"}))
    expect_reject("unresolved fee w/o id", lambda: T.record_offer_event("s-val", {"role": "unresolved_mandatory_fee"}))
    expect_reject("missing session_id", lambda: T.record_offer_event("", {"role": "initial_vendor_offer", "amount": 100}))
    # An unresolved fee is accepted WITH an identifier and stays unresolved (never $0).
    T.SESSIONS.reset("s-unres")
    T.record_offer_event("s-unres", {"role": "initial_vendor_offer", "amount": 1800, "evidence": "base is $1,800"})
    st = T.record_offer_event("s-unres", {"role": "unresolved_mandatory_fee", "fee_key": "stair_carry_fee"})["offer_state"]
    check("unknown fee preserved as unresolved", st["unresolved_fees"] == ["stair_carry_fee"], str(st))
    check("unknown fee never coerced to 0", all(a.get("amount") != 0 for a in st["mandatory_additions"]), str(st))
    check("final total unknown while unresolved", st["final_confirmed_total"] is None, str(st))
    check("current known total is base only", st["current_known_total"] == 1800, str(st))
    check("price basis reflects unresolved fees", st["price_basis"] == "known_base_plus_unresolved_fees", str(st))

    # ── B. Isolation ───────────────────────────────────────────────────────
    print("B. Isolation")
    T.SESSIONS.reset("s-a")
    T.SESSIONS.reset("s-b")
    T.record_offer_event("s-a", {"role": "final_confirmed_offer", "amount": 2600})
    T.record_offer_event("s-b", {"role": "final_confirmed_offer", "amount": 1900})
    check("session A isolated", T.derive_offer_state(T.get_offer_events("s-a"))["current_known_total"] == 2600)
    check("session B isolated", T.derive_offer_state(T.get_offer_events("s-b"))["current_known_total"] == 1900)

    # ── C. Idempotency ─────────────────────────────────────────────────────
    print("C. Idempotency")
    T.SESSIONS.reset("s-idem")
    T.record_offer_event("s-idem", {"role": "initial_vendor_offer", "amount": 5000, "event_id": "x1"})
    dup = T.record_offer_event("s-idem", {"role": "initial_vendor_offer", "amount": 5000, "event_id": "x1"})
    check("repeated event_id de-duplicated", dup["deduped"] is True and dup["event_count"] == 1, str(dup))

    # ── D. Derivation (roles never cross) ──────────────────────────────────
    print("D. Derivation")
    # Scenario 1: total vs deposit.
    T.SESSIONS.reset("s1")
    T.record_offer_event("s1", {"role": "initial_vendor_offer", "amount": 1800})
    d1 = T.record_offer_event("s1", {"role": "deposit", "amount": 200})["offer_state"]
    check("deposit does not change total", d1["current_known_total"] == 1800 and d1["deposit"] == 200, str(d1))

    # Scenario 3: revised offer + unresolved fee.
    T.SESSIONS.reset("s3")
    T.record_offer_event("s3", {"role": "initial_vendor_offer", "amount": 5000})
    T.record_offer_event("s3", {"role": "revised_vendor_offer", "amount": 4900})
    d3 = T.record_offer_event("s3", {"role": "unresolved_mandatory_fee", "fee_key": "stair_carry_fee"})["offer_state"]
    check("negotiated reduction 100", d3["negotiated_savings"] == 100, str(d3))
    check("final total unknown w/ unresolved fee", d3["final_confirmed_total"] is None, str(d3))

    # Scenario 5: unit rate not a total.
    T.SESSIONS.reset("s5")
    d5 = T.record_offer_event("s5", {"role": "unit_rate", "amount": 200, "label": "per hour"})["offer_state"]
    check("unit rate is not a total", d5["current_known_total"] is None and d5["unit_rates"], str(d5))

    # Scenario 6: optional fee not added.
    T.SESSIONS.reset("s6")
    T.record_offer_event("s6", {"role": "final_confirmed_offer", "amount": 1800})
    d6 = T.record_offer_event("s6", {"role": "optional_fee", "amount": 150, "label": "insurance"})["offer_state"]
    check("optional fee not added", d6["current_known_total"] == 1800 and d6["final_confirmed_total"] == 1800, str(d6))

    # Scenario 7: confirmed mandatory addition raises the known total.
    T.SESSIONS.reset("s7")
    T.record_offer_event("s7", {"role": "known_base_or_subtotal", "amount": 1800})
    d7 = T.record_offer_event("s7", {"role": "known_mandatory_addition", "amount": 150, "label": "coverage"})["offer_state"]
    check("mandatory addition raises total to 1950", d7["current_known_total"] == 1950, str(d7))

    # Regression: an all-in restatement subsumes prior itemized additions (no double-count).
    T.SESSIONS.reset("s-allin")
    T.record_offer_event("s-allin", {"role": "known_base_or_subtotal", "amount": 1500})
    T.record_offer_event("s-allin", {"role": "known_mandatory_addition", "amount": 300, "fee_key": "mileage_fee"})
    dai = T.record_offer_event("s-allin", {"role": "final_confirmed_offer", "amount": 1800})["offer_state"]
    check("all-in restatement not double-counted", dai["current_known_total"] == 1800 and dai["final_confirmed_total"] == 1800, str(dai))

    # Scenario 4/benchmark: competitor + benchmark never become the vendor total.
    T.SESSIONS.reset("s4")
    T.record_offer_event("s4", {"role": "final_confirmed_offer", "amount": 1900})
    T.record_offer_event("s4", {"role": "verified_competitor_quote", "amount": 1700})
    d4 = T.record_offer_event("s4", {"role": "market_benchmark", "amount": 3415})["offer_state"]
    check("competitor/benchmark never become vendor total", d4["current_known_total"] == 1900 and d4["final_confirmed_total"] == 1900, str(d4))

    # ── E. Wiring ──────────────────────────────────────────────────────────
    print("E. Wiring")
    cfg = build_agent_config()
    names = [t["name"] for t in cfg["tools"]]
    check("record_offer_event registered in agent config", "record_offer_event" in names, str(names))
    check("log_competitor_quote NOT replaced (still present)", "log_competitor_quote" in names, str(names))

    # ── F. Single coherent live path (SERVER webhook, not a client tool) ─────
    # record_offer_event executes on ElevenLabs' servers and POSTs to FastAPI;
    # the browser reads the stored state by polling. There must be exactly ONE
    # record_offer_event tool, it must be a server webhook at the FastAPI path,
    # and no tool may be a duplicate / client-tool variant.
    print("F. Single server-webhook live path")
    roe = next((t for t in cfg["tools"] if t["name"] == "record_offer_event"), None)
    check("exactly one record_offer_event tool", names.count("record_offer_event") == 1, str(names))
    check(
        "registered as server webhook POST /api/tools/record_offer_event",
        bool(roe) and roe.get("webhook", {}).get("path") == "/api/tools/record_offer_event"
        and roe["webhook"].get("method", "POST") == "POST",
        str(roe and roe.get("webhook")),
    )
    check("every tool is a server webhook (no client tool mixed in)", all("webhook" in t for t in cfg["tools"]))
    # The configure script must render it as a webhook tool pointed at FastAPI.
    try:
        from scripts.configure_elevenlabs_agent import _tool_payload
        tc = _tool_payload("https://example.test", roe)["tool_config"]
        check("configure_elevenlabs_agent renders type=webhook", tc.get("type") == "webhook", str(tc.get("type")))
        check(
            "webhook url points at the FastAPI endpoint",
            tc["api_schema"]["url"].endswith("/api/tools/record_offer_event"),
            tc["api_schema"]["url"],
        )
    except Exception as exc:  # pragma: no cover - defensive
        check("configure_elevenlabs_agent render verified", False, f"{type(exc).__name__}: {exc}")

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s)")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("record_offer_event data-integrity guard: all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

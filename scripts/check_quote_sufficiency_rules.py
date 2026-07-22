"""
Regression guard for the information-sufficiency / QUOTE_READY conversation model.

Standalone check (same convention as scripts/check_realism_rules.py and
scripts/check_job_spec_runtime.py — the repo has no pytest harness). Exit code is
non-zero on any violation so it can gate CI / pre-flight.

Live-LLM conversational behavior cannot be unit-tested without an LLM, so this
guard verifies the two things that ARE deterministic:
  A. The hosted-agent system prompt ENCODES each required rule (prompt-content
     anchors) — this is what actually steers the live agent.
  B. The log_competitor_quote DATA LAYER honors the fee-integrity guarantees:
     unknown / refused fees are never coerced to $0, and a system-estimated
     breakdown is never mislabeled as dispatcher-stated.

Verification items covered (from the task spec):
  1. partial answers do not trigger immediate negotiation
  2. confirmed all-in quotes do not trigger unnecessary itemized interrogation
  3. relevant unknown fees trigger adaptive clarification
  4. disclosed fee without amount triggers an amount/calculation question
  5. explicit refusal stops repetition of that field
  6. unknown and refused fees are never converted to $0  (prompt + tool layer)
  7. negotiation starts only after QUOTE_READY
  8. negotiation uses the realistic payable total, not a misleading base price
  9. irrelevant fees are not requested
 10. existing runtime job-spec and realism guards still pass

Usage:
    python scripts/check_quote_sufficiency_rules.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SCRIPTS))

from src.negotiator_agent import build_agent_config  # noqa: E402
from src import negotiation_tools as T  # noqa: E402
import check_realism_rules  # noqa: E402
import check_job_spec_runtime  # noqa: E402


def _fail(errors: list[str], msg: str) -> None:
    errors.append(msg)


# Prompt-content anchors: (verification-item label, required substring).
# Substrings are chosen to be distinctive and to appear verbatim in the prompt.
PROMPT_ANCHORS = [
    ("1: partial answer does not trigger negotiation",
     "do NOT enter negotiation just because you got an initial price or a partial answer"),
    ("2: all-in confirmed => no needless line-item interrogation",
     "separate labor/mileage amounts when a credible all-in price is already confirmed"),
    ("2: full internal breakdown not required",
     "A complete internal cost breakdown is NOT required"),
    ("3: adaptive clarification",
     "follow up adaptively"),
    ("3: stop on sufficiency (not a fixed count)",
     "STOP clarifying based on: information sufficiency"),
    ("4: fee without an amount => ask amount / calculation",
     "ask its amount or how it's calculated"),
    ("5: explicit refusal => mark unknown_due_to_refusal, no re-asking",
     "mark it unknown_due_to_refusal and do NOT keep rephrasing that"),
    ("6: unmentioned fee is never $0",
     "NEVER turn a fee the dispatcher didn't mention into $0"),
    ("7: negotiate only after QUOTE_READY",
     "only after QUOTE_READY"),
    ("8: negotiate on realistic payable total, not base price",
     "using the realistic payable total (never a misleading base price)"),
    ("9: do not ask about irrelevant charges",
     "do NOT ask about clearly irrelevant charges"),
    ("QUOTE_READY gate present", "QUOTE_READY GATE"),
    ("comparison-ready branch", "COMPARISON-READY"),
    ("incomplete-but-exhausted branch", "INCOMPLETE BUT EXHAUSTED"),
    ("materiality rule present", "MATERIALITY RULE"),
    ("no fixed clarification limit", 'no "ask only once,"'),
    # Correction #1: estimates strictly separate; itemized only if vendor-stated.
    ("estimate/vendor separation", "Keep dispatcher-stated numbers and any internal estimate STRICTLY separate"),
    ("itemized only if vendor-stated", "counts as itemized (ITEMIZED_QUOTE) ONLY when meaningful vendor-stated"),
    # Correction #2: budget-question handling (consolidated to the retained rules).
    ("budget: future target only if supplied at runtime", "Unless the user actually supplied an authorized target price at runtime"),
    ("budget: never invent a budget/target/quote", "Never invent a budget, target, cap, deadline, or competing quote"),
    ("budget: benchmark not a budget/competitor quote", "never disclose the market benchmark as your budget or as another company's quote"),
    ("budget: default no-anchor response", "I don't have a fixed number yet"),
    ("budget: refusal-to-quote does not loop", "don't loop: say you're not authorized to invent one"),
]

# The 7-status fee taxonomy must all be present so the agent tracks fee state.
FEE_STATUS_TAXONOMY = [
    "included", "additional_amount_known", "additional_amount_unknown",
    "excluded", "not_applicable", "unknown", "unknown_due_to_refusal",
]

# The 5 internal flow states must be named (as internal, never-spoken states).
FLOW_STATES = [
    "GET_INITIAL_PRICE", "CLARIFY_PAYABLE_TOTAL", "NEGOTIATE",
    "CONFIRM_FINAL_RESULT", "LOG_AND_CLOSE",
]


def _check_prompt(errors: list[str]) -> None:
    prompt = build_agent_config()["system_prompt"]
    # The prompt is hard-wrapped, so an anchor phrase can straddle a newline.
    # Collapse all whitespace runs to a single space before matching so anchors
    # are written naturally with single spaces.
    flat = " ".join(prompt.split())

    for label, needle in PROMPT_ANCHORS:
        if " ".join(needle.split()) not in flat:
            _fail(errors, f"Prompt missing anchor [{label}]: expected {needle!r}.")

    for status in FEE_STATUS_TAXONOMY:
        if status not in prompt:
            _fail(errors, f"Prompt missing fee-status taxonomy value: {status!r}.")

    for state in FLOW_STATES:
        if state not in prompt:
            _fail(errors, f"Prompt missing internal flow state: {state!r}.")


def _check_tool_layer(errors: list[str]) -> None:
    """Data-layer guarantees (deterministic): items 6 + the correction-#1 rules —
    unknown fees never $0, estimates never vendor-stated, estimates never itemized."""
    sid = "sufficiency-guard-session"
    T.SESSIONS.reset(sid)

    # (A) A partial, dispatcher-stated quote with an unresolved fee. The tool must
    # preserve only the stated fees, record the unresolved fee WITHOUT coercing it
    # to 0, and mark the breakdown vendor_stated + incomplete + itemized.
    res_a = T.log_competitor_quote(sid, {
        "company": "Acme Movers",
        "total": 1700.0,
        "fee_line_items": {"base_labor_fee": 1400.0, "mileage_fee": 300.0},
        "quote_status": "incomplete",
        "unresolved_fees": ["long_carry_fee"],
        "fee_status": {"long_carry_fee": "unknown_due_to_refusal", "mileage_fee": "included"},
    })
    logged_a = res_a["logged"]
    if "long_carry_fee" in logged_a["fee_line_items"]:
        _fail(errors, "TOOL: an unresolved fee (long_carry_fee) was fabricated into the "
                      f"vendor breakdown: {logged_a['fee_line_items']}.")
    if logged_a["fee_line_items"].get("long_carry_fee") == 0:
        _fail(errors, "TOOL: unresolved fee coerced to $0 (must stay unknown, never 0).")
    if logged_a.get("line_items_source") != "vendor_stated":
        _fail(errors, f"TOOL: dispatcher-stated items mislabeled: line_items_source="
                      f"{logged_a.get('line_items_source')!r} (expected 'vendor_stated').")
    if logged_a.get("quote_status") != "incomplete":
        _fail(errors, f"TOOL: incomplete quote not preserved: quote_status="
                      f"{logged_a.get('quote_status')!r}.")
    if logged_a.get("unresolved_fees") != ["long_carry_fee"]:
        _fail(errors, f"TOOL: unresolved_fees not preserved: {logged_a.get('unresolved_fees')!r}.")
    if logged_a.get("fee_status", {}).get("long_carry_fee") != "unknown_due_to_refusal":
        _fail(errors, "TOOL: fee_status for a refused fee not preserved.")

    # (B) A total-only quote must NOT auto-fill the vendor fee_line_items; any
    # estimate lives in the separate estimated_fee_line_items field, is labeled
    # 'estimated', is never 'complete', and never counts as itemized.
    res_b = T.log_competitor_quote(sid, {"company": "Estimate Co", "total": 2000.0,
                                         "job_spec": {"household_size": "2_bedroom", "distance_miles": 40}})
    logged_b = res_b["logged"]
    if logged_b.get("fee_line_items"):
        _fail(errors, "TOOL: a total-only quote populated the VENDOR fee_line_items with an "
                      f"estimate: {logged_b['fee_line_items']} (must stay empty).")
    if not logged_b.get("estimated_fee_line_items"):
        _fail(errors, "TOOL: the system estimate was not stored in the separate "
                      "estimated_fee_line_items field.")
    if logged_b.get("line_items_source") != "estimated":
        _fail(errors, f"TOOL: fallback breakdown mislabeled as {logged_b.get('line_items_source')!r} "
                      "(a system estimate must never be presented as dispatcher-stated).")
    if logged_b.get("quote_status") == "complete":
        _fail(errors, "TOOL: a system-estimated quote must not be labeled 'complete'.")
    if logged_b.get("is_itemized"):
        _fail(errors, "TOOL: an estimated-only quote wrongly qualified as itemized.")
    if T.quote_is_itemized(logged_b):
        _fail(errors, "TOOL: quote_is_itemized() returned True for an estimated-only quote.")
    if not T.quote_is_itemized(logged_a):
        _fail(errors, "TOOL: quote_is_itemized() returned False for a real vendor-stated quote.")

    # (C) Off-taxonomy fee keys are dropped, not stored, so a live quote can't
    # smuggle in an unrecognized fee line.
    res_c = T.log_competitor_quote(sid, {
        "company": "Weird Fees LLC", "total": 1500.0,
        "fee_line_items": {"base_labor_fee": 1500.0, "made_up_surcharge": 999.0},
    })
    if "made_up_surcharge" in res_c["logged"]["fee_line_items"]:
        _fail(errors, "TOOL: an off-taxonomy fee key was stored instead of being dropped.")

    T.SESSIONS.reset(sid)


def check() -> int:
    errors: list[str] = []

    _check_prompt(errors)
    _check_tool_layer(errors)

    if errors:
        print(f"QUOTE-SUFFICIENCY CHECK FAILED ({len(errors)} violation(s)):")
        for e in errors:
            print(f"  - {e}")
        return 1

    # Item 10: the existing guards must still pass on the refactored prompt/config.
    print("Running existing guards (item 10)...")
    realism_rc = check_realism_rules.check()
    jobspec_rc = check_job_spec_runtime.check()
    if realism_rc != 0 or jobspec_rc != 0:
        print("QUOTE-SUFFICIENCY CHECK FAILED: an existing guard regressed "
              f"(realism_rc={realism_rc}, jobspec_rc={jobspec_rc}).")
        return 1

    print("QUOTE-SUFFICIENCY CHECK PASSED: prompt encodes the information-sufficiency / "
          "QUOTE_READY model (adaptive clarification, materiality, refusal handling, "
          "negotiate-after-gate); the log_competitor_quote data layer never coerces unknown "
          "fees to $0 and never mislabels an estimate as dispatcher-stated; existing realism "
          "and job-spec guards still pass.")
    return 0


if __name__ == "__main__":
    sys.exit(check())

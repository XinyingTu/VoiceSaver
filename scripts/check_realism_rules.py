"""
Regression guard for the negotiator's spoken-word realism + ADA disclosure rules.

This is a standalone check (the repo has no pytest harness — see
scripts/smoke_test_tools.py for the same convention). It exercises the local
simulated market and the system-prompt template, then asserts the behavior the
hackathon brief requires. Exit code is non-zero on any violation so it can gate
CI / pre-flight.

Rules enforced:
  1. No spoken proxy line leaks internal machinery (benchmarks, percentages,
     tool/DB vocabulary like "log"/"comparable quote"/"lowball flag").
  2. ADA Shield OFF -> the proxy NEVER references any accessibility/disability
     status out loud.
  3. ADA Shield ON  -> when challenged as a bot, the proxy discloses the
     accessibility-proxy fact DIRECTLY (no hedging preamble like
     "I'll be transparent").
  4. The live-agent system prompt uses the ElevenLabs runtime variable
     {{ada_shield_active}} (so the UI toggle controls it at call time), not a
     value baked in at configure time.
  5. The system prompt carries the STRICT STOP-LOOPING & FRAUD PROTOCOL: fee
     clarification is bounded by information sufficiency / the QUOTE_READY gate
     (NOT a fixed turn count), a benchmark-driven (LOWBALL_FRAUD_RISK) fraud
     rapid-exit, and a two-sentence brevity ceiling. These stop the agent looping
     / haggling a scam quote on a live call.

Usage:
    python scripts/check_realism_rules.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.negotiator_agent import build_agent_config, run_session  # noqa: E402

# Internal machinery that must never be spoken to the counterparty.
LEAK_PATTERN = re.compile(
    r"benchmark|lowball|comparable quote|classify|outcome|% below|\d+%\s|"
    r"on the record|i.ll log|i.ll note|market (?:rate|average|baseline)",
    re.I,
)

# Any hint of accessibility/disability status.
ACCESS_PATTERN = re.compile(
    r"accessib|disabilit|disabled|vocal|hearing|cognitive|impair", re.I,
)

# Hedging preambles that must NOT precede a direct ADA disclosure.
PREAMBLE_PATTERN = re.compile(r"i.ll be transparent|to be honest|full disclosure|i have to admit", re.I)


def _proxy_lines(session: dict) -> list[dict]:
    """All proxy-spoken transcript messages across every call in a session."""
    out = []
    for call in session["calls"]:
        for m in call["transcript"]:
            if m["speaker"] == "proxy":
                out.append(m)
    return out


def _fail(errors: list[str], msg: str) -> None:
    errors.append(msg)


def check() -> int:
    errors: list[str] = []

    # --- Rule 1: no internal-vocabulary leaks in any spoken proxy line. -------
    # Run with ADA on for the tough profile so the ADA branch is also exercised.
    session_ada = run_session(ada_by_profile={"mover_002_tough": True})
    for m in _proxy_lines(session_ada):
        leak = LEAK_PATTERN.search(m["text"])
        if leak:
            _fail(errors, f"LEAK ({leak.group(0)!r}) in proxy line: {m['text']!r}")

    # --- Rule 3: ADA ON -> direct disclosure on the tough (blocking) call. ----
    tough = next(c for c in session_ada["calls"] if c["profile"]["id"] == "mover_002_tough")
    ada_lines = [m for m in tough["transcript"]
                 if m["speaker"] == "proxy" and any(e.get("type") == "ada_shield" for e in m["events"])]
    if not ada_lines:
        _fail(errors, "ADA ON: expected an ada_shield disclosure line on the tough call, found none.")
    for m in ada_lines:
        if not ACCESS_PATTERN.search(m["text"]):
            _fail(errors, f"ADA ON: disclosure line does not state the accessibility context: {m['text']!r}")
        if PREAMBLE_PATTERN.search(m["text"]):
            _fail(errors, f"ADA ON: disclosure line hedges instead of answering directly: {m['text']!r}")

    # --- Rule 2: ADA OFF everywhere -> zero accessibility language spoken. ----
    session_off = run_session(ada_by_profile={})
    for m in _proxy_lines(session_off):
        hit = ACCESS_PATTERN.search(m["text"])
        if hit:
            _fail(errors, f"ADA OFF: proxy leaked accessibility language ({hit.group(0)!r}): {m['text']!r}")

    # --- Rule 4: live-agent prompt uses the runtime variables (not baked). -----
    prompt = build_agent_config(ada_shield_active=False)["system_prompt"]
    if "{{ada_shield_active}}" not in prompt:
        _fail(errors, "Prompt must reference the ElevenLabs runtime variable {{ada_shield_active}}.")
    # The flag must NOT be baked to a literal True/False in the rendered prompt.
    if re.search(r"ACTIVE\s*=\s*(True|False)\b", prompt):
        _fail(errors, "Prompt bakes a literal ADA value; it must stay a runtime variable so the toggle controls it.")
    # The job spec must ALSO stay a runtime variable so the edited/locked spec
    # drives every live call (P0 fix). It must not be str-replaced into the prompt.
    if "{{job_spec_json}}" not in prompt:
        _fail(errors, "Prompt must reference the ElevenLabs runtime variable {{job_spec_json}} (not a baked spec).")

    # --- Rule 5: STRICT STOP-LOOPING & FRAUD PROTOCOL is present in the prompt. -
    protocol_anchors = {
        "protocol header": "STOP-LOOPING & FRAUD PROTOCOL",
        # Fee clarification is now bounded by information sufficiency + the
        # QUOTE_READY gate, NOT a fixed "ask at most twice" turn count.
        "sufficiency-bounded clarification": "QUOTE_READY",
        "information-sufficiency framing": "sufficiency",
        # Rapid-exit is benchmark-driven, not a fixed dollar cutoff tied to the
        # original Daniel job: the scam test is a LOWBALL_FRAUD_RISK on this job's benchmark.
        "benchmark-driven fraud floor": "LOWBALL_FRAUD_RISK",
        "brevity ceiling": "two sentences",
        "anti-repetition rule": "ANTI-REPETITION",  # no repeating a sentence within one turn
    }
    for label, needle in protocol_anchors.items():
        if needle not in prompt:
            _fail(errors, f"Prompt missing STRICT protocol anchor ({label}): expected {needle!r}.")

    if errors:
        print(f"REALISM CHECK FAILED ({len(errors)} violation(s)):")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("REALISM CHECK PASSED: no leaks; ADA OFF is silent on accessibility; "
          "ADA ON discloses directly; prompt uses the {{ada_shield_active}} runtime variable; "
          "STRICT stop-looping & fraud protocol present.")
    return 0


if __name__ == "__main__":
    sys.exit(check())

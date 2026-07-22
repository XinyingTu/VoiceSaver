"""
Regression guard for the P0 fix: the LIVE ElevenLabs agent must negotiate the
CURRENT locked job spec, never the seeded Daniel fixture.

Standalone check (the repo has no pytest harness — same convention as
scripts/check_realism_rules.py and scripts/smoke_test_tools.py). Exit code is
non-zero on any violation so it can gate CI / pre-flight.

Rules enforced:
  1. The hosted-agent system prompt RETAINS the ElevenLabs runtime placeholder
     {{job_spec_json}} — i.e. the spec is NOT str-replaced/baked in at config
     time, and it is NOT accidentally reduced to a single-brace {job_spec_json}.
  2. A valid default for job_spec_json is registered in the agent's
     dynamic-variable placeholders (so dashboard testing works), and it is a
     single, once-serialized JSON string (never double-encoded).
  3. The negotiation prompt contains NO scenario-specific facts from the demo
     job (45 miles, Rock Hill, Charlotte, Daniel, two bedrooms, two stair
     flights, sub-$500 threshold) OUTSIDE the runtime placeholder / fixture data.

Usage:
    python scripts/check_job_spec_runtime.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.negotiator_agent import build_agent_config  # noqa: E402

# Scenario facts that were hard-coded for the original Daniel example and must
# never remain as instructions/examples in the negotiation prompt template.
SCENARIO_PATTERNS = {
    "Rock Hill": re.compile(r"rock hill", re.I),
    "Charlotte": re.compile(r"charlotte", re.I),
    "Daniel": re.compile(r"\bdaniel\b", re.I),
    "45 miles": re.compile(r"45[\s-]?mile|45 miles", re.I),
    "two-bedroom": re.compile(r"2-bedroom|two-bedroom|two bedroom", re.I),
    "two flights": re.compile(r"two flight|2-flight|two-flight", re.I),
    "sub-$500 threshold": re.compile(r"\$500|\$700"),
}


def _fail(errors: list[str], msg: str) -> None:
    errors.append(msg)


def check() -> int:
    errors: list[str] = []

    config = build_agent_config()
    prompt = config["system_prompt"]

    # --- Rule 1: runtime placeholder retained, not baked / not single-braced. --
    if "{{job_spec_json}}" not in prompt:
        _fail(errors, "System prompt is missing the runtime placeholder {{job_spec_json}} "
                      "(the locked spec must stay a runtime variable, not be baked in).")
    # A stray single-brace {job_spec_json} would mean a broken replace happened.
    if re.search(r"(?<!\{)\{job_spec_json\}(?!\})", prompt):
        _fail(errors, "System prompt has a single-brace {job_spec_json}; it must be the "
                      "double-brace ElevenLabs runtime placeholder {{job_spec_json}}.")

    # --- Rule 2: valid, once-serialized job_spec_json default registered. ------
    dyn = config.get("dynamic_variables", {})
    raw = dyn.get("job_spec_json")
    if not isinstance(raw, str):
        _fail(errors, "dynamic_variables.job_spec_json default must be a JSON string.")
    else:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
            _fail(errors, "dynamic_variables.job_spec_json default is not valid JSON.")
        # Double-serialized strings parse to a str, not a dict — guard against that.
        if not isinstance(parsed, dict):
            _fail(errors, "dynamic_variables.job_spec_json default must decode to a JSON object "
                          "(a dict); it looks double-serialized or malformed.")
        elif "household_size" not in parsed:
            _fail(errors, "dynamic_variables.job_spec_json default is missing expected job fields "
                          "(e.g. household_size).")

    # --- Rule 3: no scenario-specific facts left in the prompt template. -------
    # The rendered prompt keeps {{job_spec_json}} unresolved, so any Daniel-scenario
    # token found here is a hard-coded instruction/example, not runtime data.
    for label, pat in SCENARIO_PATTERNS.items():
        hit = pat.search(prompt)
        if hit:
            _fail(errors, f"Prompt still contains scenario-specific fact ({label}): {hit.group(0)!r}.")

    if errors:
        print(f"JOB-SPEC RUNTIME CHECK FAILED ({len(errors)} violation(s)):")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("JOB-SPEC RUNTIME CHECK PASSED: prompt keeps the {{job_spec_json}} runtime placeholder; "
          "a valid once-serialized job_spec_json default is registered; no scenario-specific "
          "45-mile / Rock Hill / Charlotte / Daniel / two-bedroom / two-flight / $500 facts remain "
          "in the prompt template.")
    return 0


if __name__ == "__main__":
    sys.exit(check())

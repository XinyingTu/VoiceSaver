"""
Real POST bubble tests for the four negotiation-tool webhooks.

Fires a real HTTP POST at each /api/tools/* endpoint on a target base URL
(defaults to the public ngrok URL passed via --base) with a valid payload, then
asserts the response is 200 and contains the tool's expected key. Exit code is
non-zero if any tool fails, so it doubles as a CI/pre-flight check before wiring
the URLs into ElevenLabs.

Usage:
    python scripts/smoke_test_tools.py --base https://<subdomain>.ngrok-free.dev
    python scripts/smoke_test_tools.py --base http://127.0.0.1:8080
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"

# ngrok's free tier injects a browser interstitial on GET requests; this header
# opts out. Server-to-server POSTs are unaffected, but we send it anyway so the
# smoke test behaves identically whatever the tunnel tier.
HEADERS = {"Content-Type": "application/json", "ngrok-skip-browser-warning": "1"}


def _job_spec() -> dict:
    return json.loads((CONFIG_DIR / "job_spec.json").read_text(encoding="utf-8"))["job_spec"]


def _cases(job_spec: dict) -> list[dict]:
    """Each case: the tool path, a valid body, and a key the response must expose."""
    return [
        {
            "tool": "get_price_benchmark",
            "path": "/api/tools/get_price_benchmark",
            "body": {"vertical": "moving_services", "job_spec": job_spec},
            "expect_key": "benchmark_total",
        },
        {
            "tool": "log_competitor_quote",
            "path": "/api/tools/log_competitor_quote",
            "body": {
                "session_id": "webhook-smoke-test",
                "quote": {"company": "Smoke Test Movers", "total": 2400, "job_spec": job_spec},
            },
            "expect_key": "logged",
        },
        {
            "tool": "check_lowball_flag",
            "path": "/api/tools/check_lowball_flag",
            "body": {"quote_total": 1200, "job_spec": job_spec},
            "expect_key": "flag",
        },
        {
            "tool": "classify_outcome",
            "path": "/api/tools/classify_outcome",
            "body": {
                "transcript_so_far": "Your total comes to base labor plus mileage and a fuel surcharge, all itemized.",
                "signals": {"has_itemized_quote": True, "reason": "smoke test"},
            },
            "expect_key": "outcome",
        },
    ]


def run(base: str, timeout: float = 20.0) -> int:
    base = base.rstrip("/")
    job_spec = _job_spec()
    failures = 0

    print(f"Bubble-testing 4 tool webhooks at {base}\n")
    for case in _cases(job_spec):
        url = base + case["path"]
        try:
            resp = requests.post(url, json=case["body"], headers=HEADERS, timeout=timeout)
        except requests.RequestException as exc:
            print(f"  FAIL  {case['tool']:<22} network error: {exc}")
            failures += 1
            continue

        ok = resp.status_code == 200
        payload = None
        try:
            payload = resp.json()
        except ValueError:
            ok = False

        has_key = isinstance(payload, dict) and case["expect_key"] in payload
        if ok and has_key:
            preview = json.dumps({case["expect_key"]: payload[case["expect_key"]]})
            print(f"  PASS  {case['tool']:<22} HTTP 200  {preview}")
        else:
            failures += 1
            detail = payload if payload is not None else resp.text[:200]
            print(f"  FAIL  {case['tool']:<22} HTTP {resp.status_code}  {detail}")

    print()
    if failures:
        print(f"RESULT: {failures}/4 tool(s) FAILED.")
        return 1
    print("RESULT: all 4 tool webhooks are fully operational.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Real POST bubble tests for the tool webhooks.")
    parser.add_argument("--base", required=True, help="Base URL, e.g. https://<subdomain>.ngrok-free.dev")
    args = parser.parse_args()
    sys.exit(run(args.base))


if __name__ == "__main__":
    main()

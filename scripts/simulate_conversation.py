"""
Trigger a REAL ElevenLabs agent run and stream the turn-by-turn execution plus
every tool invocation to the console.

This calls the ElevenLabs simulate-conversation endpoint, which runs the actual
agent (the one created by configure_elevenlabs_agent.py) against a simulated
moving-company dispatcher. When the agent decides to call a tool, ElevenLabs
invokes the real webhook URL — i.e. it hits our live ngrok tunnel mid-flight.
The returned transcript therefore contains real tool_calls and their results.

Usage:
    export ELEVENLABS_API_KEY=sk_...
    python scripts/simulate_conversation.py --agent-id agent_xxx --turns 14
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import requests

API_ROOT = "https://api.elevenlabs.io/v1/convai"

# The simulated counterparty: a moving-company dispatcher who opens with a
# suspiciously low headline (to provoke the lowball check), resists itemizing at
# first, then breaks the number down when pushed. This exercises multiple tools.
DISPATCHER_PERSONA = (
    "You are Rick, a gruff dispatcher at a moving company taking a phone call from a "
    "prospective customer. Open by quoting a suspiciously low flat headline price of "
    "about $1,150 for the whole move and claim it's the best they'll find. Be a little "
    "evasive and resist breaking it into line items at first. If the caller pushes for "
    "an itemized breakdown or questions the low number, eventually relent and give real "
    "line items (labor, mileage, stairs, packing, fuel) that add up to about $2,300. "
    "Do NOT ask for a deposit up front. Stay in character, keep replies short and "
    "conversational like a real phone call, and let the caller drive."
)


def _headers(api_key: str) -> dict:
    return {"xi-api-key": api_key, "Content-Type": "application/json"}


def _extract_transcript(data: dict) -> list:
    for key in ("simulated_conversation", "transcript", "conversation"):
        val = data.get(key)
        if isinstance(val, list):
            return val
    # Some responses nest it under an analysis/result envelope.
    for parent in ("result", "analysis"):
        inner = data.get(parent)
        if isinstance(inner, dict):
            for key in ("simulated_conversation", "transcript"):
                if isinstance(inner.get(key), list):
                    return inner[key]
    return []


def _print_turn(turn: dict) -> int:
    """Print one transcript entry; return the number of tool calls it contained."""
    role = (turn.get("role") or turn.get("source") or "?").upper()
    message = turn.get("message") or turn.get("text") or ""
    if message:
        print(f"\n[{role}] {message}")

    tool_calls = turn.get("tool_calls") or []
    tool_results = turn.get("tool_results") or []
    n = 0
    for call in tool_calls:
        n += 1
        name = call.get("tool_name") or call.get("name") or "?"
        params = call.get("params_as_json") or call.get("parameters") or ""
        if isinstance(params, (dict, list)):
            params = json.dumps(params)
        print(f"    -> TOOL CALL  {name}  params={str(params)[:200]}")
    for res in tool_results:
        name = res.get("tool_name") or res.get("name") or "?"
        value = res.get("result_value")
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        latency = res.get("tool_latency_secs")
        err = res.get("is_error")
        lat = f"  ({latency:.2f}s)" if isinstance(latency, (int, float)) else ""
        flag = "  [ERROR]" if err else ""
        print(f"    <- TOOL RESULT {name}{lat}{flag}  {str(value)[:200]}")
    return n


def run(agent_id: str, api_key: str, turns: int) -> int:
    url = f"{API_ROOT}/agents/{agent_id}/simulate-conversation"
    payload = {
        "simulation_specification": {
            "simulated_user_config": {
                "first_message": "Movers, this is Rick — what do you need?",
                "language": "en",
                "prompt": {"prompt": DISPATCHER_PERSONA},
            }
        },
        "new_turns_limit": turns,
    }

    print(f"Running real ElevenLabs simulation against agent {agent_id} ...")
    print("(agent tool calls hit the live ngrok webhooks)\n" + "=" * 72)
    resp = requests.post(url, headers=_headers(api_key), json=payload, timeout=180)
    if resp.status_code >= 300:
        print(f"simulate-conversation failed HTTP {resp.status_code}:\n{resp.text}")
        return 2

    data = resp.json()
    transcript = _extract_transcript(data)
    if not transcript:
        print("No transcript returned. Raw response keys:", list(data.keys()))
        print(json.dumps(data)[:800])
        return 2

    total_tool_calls = 0
    for turn in transcript:
        total_tool_calls += _print_turn(turn)

    print("\n" + "=" * 72)
    print(f"Turns: {len(transcript)}  |  Tool calls invoked: {total_tool_calls}")
    if total_tool_calls == 0:
        print("VALIDATION FAILED: agent completed the call without invoking any tool.")
        return 1
    print("VALIDATION PASSED: the agent invoked live tool webhooks during the call.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a real ElevenLabs agent simulation and stream tool calls.")
    parser.add_argument("--agent-id", default=os.environ.get("ELEVENLABS_AGENT_ID", ""))
    parser.add_argument("--api-key", default=os.environ.get("ELEVENLABS_API_KEY", ""))
    parser.add_argument("--turns", type=int, default=14, help="Max new turns for the simulation.")
    args = parser.parse_args()
    if not args.agent_id:
        parser.error("No agent id. Set ELEVENLABS_AGENT_ID or pass --agent-id.")
    if not args.api_key:
        parser.error("No API key. Set ELEVENLABS_API_KEY or pass --api-key.")
    sys.exit(run(args.agent_id, args.api_key, args.turns))


if __name__ == "__main__":
    main()

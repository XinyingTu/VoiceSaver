"""
Configure an ElevenLabs Conversational AI agent for the VoiceSaver negotiator.

What it does:
  1. Renders the real agent config (system prompt + the 4 tool schemas) via
     src.negotiator_agent.build_agent_config().
  2. Creates each of the 4 negotiation tools as a server/webhook tool on the
     ElevenLabs platform, pointed at the public --base URL (your ngrok tunnel),
     collecting the returned tool_id for each.
  3. Creates the agent, referencing those tool_ids, with the rendered system
     prompt and first message.

The 4 webhook URLs become:
    <base>/api/tools/get_price_benchmark
    <base>/api/tools/log_competitor_quote
    <base>/api/tools/check_lowball_flag
    <base>/api/tools/classify_outcome

Auth: set ELEVENLABS_API_KEY in the environment (or pass --api-key).

Usage:
    export ELEVENLABS_API_KEY=sk_...
    python scripts/configure_elevenlabs_agent.py --base https://<sub>.ngrok-free.dev
    python scripts/configure_elevenlabs_agent.py --base https://<sub>.ngrok-free.dev --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import requests

# Import the real config surface so the prompt + tool schemas stay identical to
# what the rest of the app produces (single source of truth).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.negotiator_agent import build_agent_config  # noqa: E402

API_ROOT = "https://api.elevenlabs.io/v1/convai"
AGENT_NAME = "VoiceSaver Negotiator"
LANGUAGE = "en"


def _tool_payload(base_url: str, tool: dict) -> dict:
    """Map one build_agent_config() tool onto an ElevenLabs webhook tool_config."""
    url = base_url.rstrip("/") + tool["webhook"]["path"]
    params = tool["parameters"]
    # ElevenLabs expects a description on each property; supply one where the
    # source schema omits it so the LLM knows what to send.
    properties = {}
    for name, prop in params.get("properties", {}).items():
        properties[name] = {**prop, "description": prop.get("description", f"The {name} argument for {tool['name']}.")}
    return {
        "tool_config": {
            "type": "webhook",
            "name": tool["name"],
            "description": tool["description"],
            "response_timeout_secs": 20,
            "api_schema": {
                "url": url,
                "method": tool["webhook"].get("method", "POST"),
                "request_headers": {"ngrok-skip-browser-warning": "1"},
                "request_body_schema": {
                    "type": "object",
                    "properties": properties,
                    "required": params.get("required", []),
                },
            },
        }
    }


def _headers(api_key: str) -> dict:
    return {"xi-api-key": api_key, "Content-Type": "application/json"}


def create_tool(api_key: str, payload: dict) -> str:
    resp = requests.post(f"{API_ROOT}/tools", headers=_headers(api_key), json=payload, timeout=30)
    if resp.status_code >= 300:
        raise RuntimeError(f"tool create failed HTTP {resp.status_code}: {resp.text}")
    data = resp.json()
    tool_id = data.get("id") or data.get("tool_id") or (data.get("tool") or {}).get("id")
    if not tool_id:
        raise RuntimeError(f"tool create returned no id: {json.dumps(data)[:300]}")
    return tool_id


def create_agent(api_key: str, system_prompt: str, first_message: str, tool_ids: list[str]) -> dict:
    payload = {
        "name": AGENT_NAME,
        "conversation_config": {
            "agent": {
                "first_message": first_message,
                "language": LANGUAGE,
                "prompt": {
                    "prompt": system_prompt,
                    "tool_ids": tool_ids,
                },
            }
        },
    }
    resp = requests.post(f"{API_ROOT}/agents/create", headers=_headers(api_key), json=payload, timeout=30)
    if resp.status_code >= 300:
        raise RuntimeError(f"agent create failed HTTP {resp.status_code}: {resp.text}")
    return resp.json()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the ElevenLabs negotiator agent with the 4 webhook tools.")
    parser.add_argument("--base", required=True, help="Public base URL for the tool webhooks (your ngrok URL).")
    parser.add_argument("--api-key", default=os.environ.get("ELEVENLABS_API_KEY", ""), help="ElevenLabs API key.")
    parser.add_argument("--ada-shield", action="store_true", help="Render the prompt with the ADA Shield active.")
    parser.add_argument("--dry-run", action="store_true", help="Print the payloads without calling the API.")
    args = parser.parse_args()

    config = build_agent_config(ada_shield_active=args.ada_shield)
    tool_payloads = [_tool_payload(args.base, t) for t in config["tools"]]

    if args.dry_run:
        print("=== DRY RUN — no API calls ===\n")
        print(f"Agent name : {AGENT_NAME}")
        print(f"Base URL   : {args.base.rstrip('/')}")
        print(f"System prompt: {len(config['system_prompt'])} chars")
        print(f"First message: {config['first_message']}\n")
        for tp in tool_payloads:
            tc = tp["tool_config"]
            print(f"- {tc['name']:<22} POST {tc['api_schema']['url']}")
        print("\nExample tool_config payload (get_price_benchmark):")
        print(json.dumps(tool_payloads[0], indent=2))
        return

    if not args.api_key:
        parser.error("No API key. Set ELEVENLABS_API_KEY or pass --api-key.")

    print(f"Creating {len(tool_payloads)} webhook tools on ElevenLabs...")
    tool_ids: list[str] = []
    for tp in tool_payloads:
        tool_id = create_tool(args.api_key, tp)
        tool_ids.append(tool_id)
        print(f"  created tool {tp['tool_config']['name']:<22} -> {tool_id}")

    print("\nCreating agent...")
    agent = create_agent(args.api_key, config["system_prompt"], config["first_message"], tool_ids)
    agent_id = agent.get("agent_id") or agent.get("id")
    print(f"\nDONE. agent_id = {agent_id}")
    print(f"Tools wired: {', '.join(tool_ids)}")
    print("Set ELEVENLABS_AGENT_ID in your .env to this agent_id to use it.")


if __name__ == "__main__":
    main()

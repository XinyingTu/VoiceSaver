"""
Drive a REAL ElevenLabs Conversational AI session (text mode) end-to-end so the
agent actually executes its server/webhook tools mid-call.

Unlike simulate-conversation (which mocks tools), a live ConvAI session makes
ElevenLabs' backend invoke each server tool for real — i.e. it POSTs to our live
ngrok webhook URLs during the conversation. This script plays a moving-company
dispatcher, feeds the agent scripted lines that provoke tool use, and prints the
agent's turns and any tool events. Cross-check the actual hits in ngrok's request
log afterward for proof.

Usage:
    export ELEVENLABS_API_KEY=sk_...
    python scripts/live_session.py --agent-id agent_xxx
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading

import certifi
import requests
import websocket

API_ROOT = "https://api.elevenlabs.io/v1/convai"

# Dispatcher lines, sent one per agent turn. Crafted to provoke the full tool
# chain: a lowball headline (get_price_benchmark + check_lowball_flag), then a
# real itemized breakdown (log_competitor_quote), then a close (classify_outcome).
DISPATCHER_LINES = [
    "Yeah, I got a minute. For your whole two-bedroom move I can do it all-in for about eleven fifty. Best price you'll find, trust me.",
    "Okay, okay. Labor's about thirteen hundred, mileage three hundred, stairs two fifty, packing three fifty, fuel a hundred. Comes to around twenty-three hundred all in.",
    "It's an estimate, could change on moving day. And no, booking today won't change the price.",
    "Fine. If you do your own packing and supply the materials, I'll knock the three fifty off. That's my best.",
    "That's all I got for you. Have a good one.",
]


def get_signed_url(api_key: str, agent_id: str) -> str:
    resp = requests.get(
        f"{API_ROOT}/conversation/get-signed-url",
        headers={"xi-api-key": api_key},
        params={"agent_id": agent_id},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["signed_url"]


class Driver:
    def __init__(self, url: str, max_wall_secs: float = 120.0) -> None:
        self.url = url
        self.max_wall_secs = max_wall_secs
        self.idx = 0
        self.tool_events = 0
        self.lock = threading.Lock()
        self.ws: websocket.WebSocketApp | None = None

    @staticmethod
    def _later(delay: float, fn) -> None:
        t = threading.Timer(delay, fn)
        t.daemon = True
        t.start()

    def _send(self, obj: dict) -> None:
        if self.ws:
            self.ws.send(json.dumps(obj))

    def _send_next_line(self) -> None:
        with self.lock:
            if self.idx >= len(DISPATCHER_LINES):
                # Drain then close.
                self._later(6.0, lambda: self.ws and self.ws.close())
                return
            line = DISPATCHER_LINES[self.idx]
            self.idx += 1
        print(f"\n[DISPATCHER] {line}")
        self._send({"type": "user_message", "text": line})

    def on_open(self, ws):
        print("WS connected. Waiting for agent to open...\n" + "=" * 72)
        # Optional init; the agent's first_message will follow.
        self._send({"type": "conversation_initiation_client_data"})

    def on_message(self, ws, raw):
        try:
            msg = json.loads(raw)
        except ValueError:
            return
        mtype = msg.get("type")

        if mtype == "ping":
            self._send({"type": "pong", "event_id": msg.get("ping_event", {}).get("event_id")})
            return

        if mtype == "conversation_initiation_metadata":
            meta = msg.get("conversation_initiation_metadata_event", {})
            print(f"conversation_id: {meta.get('conversation_id')}")
            return

        if mtype == "agent_response":
            text = msg.get("agent_response_event", {}).get("agent_response", "")
            print(f"\n[AGENT] {text}")
            # The agent finished a turn -> dispatcher replies (slight delay so any
            # server tool calls for this turn land first).
            self._later(2.5, self._send_next_line)
            return

        # Surface any tool-related events the platform emits over the socket.
        if "tool" in (mtype or ""):
            with self.lock:
                self.tool_events += 1
            print(f"    >> TOOL EVENT [{mtype}] {json.dumps(msg)[:220]}")
            return

    def on_error(self, ws, err):
        print(f"WS error: {err}")

    def on_close(self, ws, code, reason):
        print("\n" + "=" * 72)
        print(f"WS closed (code={code}). Tool events seen on socket: {self.tool_events}")

    def run(self) -> None:
        self.ws = websocket.WebSocketApp(
            self.url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close,
        )
        # Hard stop so a stalled turn can't hang the session.
        stop = threading.Timer(self.max_wall_secs, lambda: self.ws and self.ws.close())
        stop.daemon = True
        stop.start()
        # websocket-client does not use certifi's CA bundle by default, which fails
        # TLS verification against ElevenLabs on macOS; point it at certifi.
        self.ws.run_forever(sslopt={"ca_certs": certifi.where()})


def main() -> None:
    parser = argparse.ArgumentParser(description="Drive a real ElevenLabs ConvAI session (text mode).")
    parser.add_argument("--agent-id", default=os.environ.get("ELEVENLABS_AGENT_ID", ""))
    parser.add_argument("--api-key", default=os.environ.get("ELEVENLABS_API_KEY", ""))
    args = parser.parse_args()
    if not args.agent_id or not args.api_key:
        parser.error("Need --agent-id/ELEVENLABS_AGENT_ID and --api-key/ELEVENLABS_API_KEY.")
    url = get_signed_url(args.api_key, args.agent_id)
    Driver(url).run()


if __name__ == "__main__":
    main()

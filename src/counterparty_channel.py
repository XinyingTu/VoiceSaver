"""
Counterparty connection layer — the three brief-approved call setups.

They can coexist. Only the local simulated agent-to-agent market runs without
credentials; the real outbound (Twilio/SIP) and the market-discovery list
(Yelp/Google Places) are intentionally left as documented stubs that report
clearly what credentials they need instead of fabricating data. The
human-in-the-loop path is an ElevenLabs test/embed widget answered by a person,
so it has no server-side call to make here.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from .negotiator_agent import run_session, simulate_call

REAL = "real_outbound"
HUMAN = "human_in_the_loop"
AGENT = "agent_to_agent"
SIMULATED = "simulated"


def list_modes() -> list[dict[str, Any]]:
    return [
        {"id": SIMULATED, "label": "Simulated agent-to-agent market", "available": True,
         "note": "Runs locally with no credentials. Labeled as simulated."},
        {"id": AGENT, "label": "Live agent-to-agent (ElevenLabs)", "available": bool(os.environ.get("ELEVENLABS_API_KEY")),
         "note": "Spins up a second live ElevenLabs counterparty agent. Requires ELEVENLABS_API_KEY."},
        {"id": HUMAN, "label": "Human-in-the-loop (ElevenLabs widget)", "available": True,
         "note": "A person answers the ElevenLabs test/embed widget and role-plays a persona live."},
        {"id": REAL, "label": "Real outbound call (Twilio/SIP)", "available": bool(os.environ.get("TWILIO_AUTH_TOKEN")),
         "note": "Dials a real business line. Requires Twilio/SIP credentials."},
    ]


# --------------------------------------------------------------------------- #
# Implemented: local simulated market
# --------------------------------------------------------------------------- #


def run_simulated_call(profile_id: str, session_id: str, ada_shield_active: bool = False) -> dict[str, Any]:
    return simulate_call(profile_id, session_id, ada_shield_active=ada_shield_active)


def run_simulated_session(session_id: Optional[str] = None, ada_by_profile: Optional[dict[str, bool]] = None) -> dict[str, Any]:
    return run_session(session_id=session_id, ada_by_profile=ada_by_profile)


# --------------------------------------------------------------------------- #
# Human-in-the-loop (ElevenLabs widget) — documented, no credentials needed here
# --------------------------------------------------------------------------- #


def human_in_the_loop_entrypoint(profile_id: str) -> dict[str, Any]:
    agent_id = os.environ.get("ELEVENLABS_AGENT_ID")
    return {
        "mode": HUMAN,
        "available": True,
        "instructions": (
            "Embed the ElevenLabs conversation widget for the negotiator agent, then have a "
            "teammate answer and role-play the selected persona live via microphone."
        ),
        "widget_embed": (
            f'<elevenlabs-convai agent-id="{agent_id or "YOUR_AGENT_ID"}"></elevenlabs-convai>'
            '<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async></script>'
        ),
        "persona_ref": profile_id,
        "requires": [] if agent_id else ["ELEVENLABS_AGENT_ID (to fill the widget)"] ,
    }


# --------------------------------------------------------------------------- #
# Stubs: real outbound (Twilio/SIP) and market discovery (Yelp/Google Places)
# --------------------------------------------------------------------------- #


def place_real_outbound_call(phone_number: str, session_id: str, ada_shield_active: bool = False) -> dict[str, Any]:
    """Route the ElevenLabs agent through Twilio/SIP to a real business line."""
    if not (os.environ.get("TWILIO_AUTH_TOKEN") and os.environ.get("TWILIO_ACCOUNT_SID")):
        return {
            "mode": REAL,
            "available": False,
            "reason": "Twilio/SIP credentials not configured.",
            "requires": ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "ELEVENLABS_API_KEY"],
            "would_dial": phone_number,
        }
    raise NotImplementedError(
        "Real outbound dialing is a documented integration stub. Wire the ElevenLabs "
        "Agents Platform to Twilio/SIP here to place live calls."
    )


def build_target_call_list(location: str, vertical: str = "moving_services", limit: int = 5) -> dict[str, Any]:
    """Pull a target merchant list via Yelp Fusion / Google Places."""
    if not (os.environ.get("YELP_API_KEY") or os.environ.get("GOOGLE_PLACES_API_KEY")):
        return {
            "available": False,
            "reason": "No market-discovery API key configured; not fabricating merchant data.",
            "requires": ["YELP_API_KEY or GOOGLE_PLACES_API_KEY"],
            "query": {"location": location, "vertical": vertical, "limit": limit},
        }
    raise NotImplementedError(
        "Yelp Fusion / Google Places lookup is a documented integration stub. Implement the "
        "real API call here to generate the outbound target list."
    )

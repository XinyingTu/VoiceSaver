"""
FastAPI backend for The Negotiator control center.

Feeds the frontend everything it needs over clean REST endpoints:
  * the structured job intake + document overview (left column),
  * the simulated negotiation result with the full line-by-line transcript and
    step-by-step price drops (middle + right columns),
  * a live Server-Sent-Events stream of the transcript for the typewriter,
  * the mocked ElevenLabs highlight audio asset (right-column Play button).

Run:  uvicorn src.server:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from .audio_generator import AUDIO_DIR, extract_highlight, generate_highlight_audio
from .negotiation_engine import (
    load_domain_config,
    load_job,
    load_profiles,
    run_negotiation,
)

app = FastAPI(
    title="The Negotiator — Control Center API",
    description="Simulated agent-to-agent moving-services negotiation market.",
    version="1.0.0",
)

# Vite dev server + common local origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _public_profile(profile: dict[str, Any]) -> dict[str, Any]:
    """Return the frontend-safe subset of a profile (hide raw line templates)."""
    return {
        "id": profile["id"],
        "name": profile["name"],
        "archetype": profile["archetype"],
        "company": profile["company"],
        "voice_id": profile["voice_id"],
        "personality": profile["personality"],
        "tactics": profile["tactics"],
        "walkaway_sensitivity": profile["mechanics"]["walkaway_sensitivity"],
        "requires_binding_verification": profile["mechanics"]["requires_binding_verification"],
    }


def _require_profile(profile_id: str) -> dict[str, Any]:
    profile = next((p for p in load_profiles() if p["id"] == profile_id), None)
    if profile is None:
        raise HTTPException(status_code=404, detail=f"Unknown profile '{profile_id}'.")
    return profile


# --------------------------------------------------------------------------- #
# Read endpoints
# --------------------------------------------------------------------------- #


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "the-negotiator", "profiles": [p["id"] for p in load_profiles()]}


@app.get("/api/job")
def job() -> dict[str, Any]:
    """Structured job criteria + document intake overview (left column)."""
    return load_job()


@app.get("/api/domain")
def domain() -> dict[str, Any]:
    return load_domain_config()


@app.get("/api/profiles")
def profiles() -> dict[str, Any]:
    return {"profiles": [_public_profile(p) for p in load_profiles()]}


@app.get("/api/negotiation/{profile_id}")
def negotiation(profile_id: str) -> dict[str, Any]:
    """Full simulated negotiation: transcript, price timeline, outcome, audio ref."""
    _require_profile(profile_id)
    result = run_negotiation(profile_id)
    result["highlight"] = extract_highlight(result)
    result["audio_url"] = f"/api/audio/{profile_id}"
    return result


@app.get("/api/negotiation/{profile_id}/stream")
async def negotiation_stream(profile_id: str) -> StreamingResponse:
    """
    Server-Sent-Events stream of the transcript, one message at a time, so a
    client can render it live. Each `data:` frame is a transcript message; a
    final `event: done` frame carries the outcome summary.
    """
    _require_profile(profile_id)
    result = run_negotiation(profile_id)

    async def event_source():
        for message in result["transcript"]:
            yield f"data: {json.dumps(message)}\n\n"
            # Movers pause a beat longer for dramatic effect.
            await asyncio.sleep(0.9 if message["role"] == "mover" else 0.6)
        summary = {
            "final_price": result["final_price"],
            "opening_price": result["opening_price"],
            "anchor_price": result["anchor_price"],
            "savings": result["savings"],
            "savings_pct": result["savings_pct"],
            "success": result["success"],
            "red_flag": result["red_flag"],
            "red_flag_reason": result["red_flag_reason"],
            "breakthrough_turn": result["breakthrough_turn"],
            "audio_url": f"/api/audio/{profile_id}",
        }
        yield f"event: done\ndata: {json.dumps(summary)}\n\n"

    return StreamingResponse(event_source(), media_type="text/event-stream")


@app.get("/api/audio/{profile_id}")
def audio(profile_id: str) -> FileResponse:
    """Serve the mocked ElevenLabs highlight WAV, generating it on demand."""
    _require_profile(profile_id)
    path: Path = AUDIO_DIR / f"highlight_{profile_id}.wav"
    if not path.exists():
        generate_highlight_audio(profile_id, mirror_to_frontend=False)
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "The Negotiator — Control Center API",
        "docs": "/docs",
        "endpoints": [
            "/api/health",
            "/api/job",
            "/api/domain",
            "/api/profiles",
            "/api/negotiation/{profile_id}",
            "/api/negotiation/{profile_id}/stream",
            "/api/audio/{profile_id}",
        ],
    }

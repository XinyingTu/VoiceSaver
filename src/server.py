"""
FastAPI backend for VoiceSaver — the Universal Automated Negotiation Cockpit.

Serves the frontend AND exposes the four negotiation tools as REAL, live
function-calling webhooks that an ElevenLabs Conversational Agent can invoke
during a call (/api/tools/*). Also provides: the lockable job spec, the ordered
simulated session, the Closing Ledger report, the document-intake vision call,
the ElevenLabs agent config, and the (labeled, simulated) playback audio.

Run:  uvicorn src.server:app --reload --port 8000
"""

from __future__ import annotations

import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Load .env so ELEVENLABS_AGENT_ID (and other keys) are visible to the endpoints
# that surface them — e.g. the human-in-the-loop widget needs the agent id.
load_dotenv()

from . import counterparty_channel as channel
from . import document_parser
from . import negotiation_tools as T
from .audio_generator import AUDIO_DIR, generate_all
from .config_loader import ROOT, get_profile, load_domain_config, load_job_spec, load_profiles
from .negotiator_agent import build_agent_config, run_session
from .report_builder import build_report

app = FastAPI(
    title="VoiceSaver — Automated Negotiation Cockpit API",
    description="Live tool webhooks + simulated market + Closing Ledger for the moving-services vertical.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    # Allow any local dev origin — Vite may auto-pick a port other than 5173
    # (strictPort=false), and hardcoding ports would silently break the app.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Minimal server state (the spec-lock guardrail is enforced in the UI; we mirror
# it here so /api/session/run can refuse to run against an unlocked spec).
# --------------------------------------------------------------------------- #


class _State:
    def __init__(self) -> None:
        base = load_job_spec()
        self.job_spec: dict[str, Any] = base["job_spec"]
        self.session_id: str = base["session_id"]
        self.spec_locked: bool = False
        self.ada_self_attested: bool = False


STATE = _State()

# Audit trail for explicit ADA self-attestation confirmations. This records that
# a human actively confirmed the attestation (not merely flipped a toggle). It is
# an audit trail, NOT identity verification — no documents or medical proof.
AUDIT_LOG: list[dict[str, Any]] = []
_audit_logger = logging.getLogger("voicesaver.audit")


def _public_profile(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": p["id"], "name": p["name"], "style": p["style"],
        "initial_price": p["initial_price"], "flexibility_score": p["flexibility_score"],
        "blocks_automated_callers": p["_sim"].get("blocks_automated_callers", False),
        "expected_outcome": p["_sim"].get("expected_outcome"),
    }


def _require_profile(profile_id: str) -> dict[str, Any]:
    try:
        return get_profile(profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# --------------------------------------------------------------------------- #
# Request models
# --------------------------------------------------------------------------- #


class LockSpecBody(BaseModel):
    job_spec: Optional[dict[str, Any]] = None
    ada_self_attested: bool = False


class AdaAttestBody(BaseModel):
    session_id: Optional[str] = None
    confirmed: bool = True


class RunSessionBody(BaseModel):
    session_id: Optional[str] = None
    ada_by_profile: Optional[dict[str, bool]] = None
    counterparty_mode: str = "simulated"
    require_lock: bool = True


class BenchmarkBody(BaseModel):
    vertical: str = "moving_services"
    job_spec: dict[str, Any]


class LogQuoteBody(BaseModel):
    session_id: str
    quote: dict[str, Any]


class RecordOfferEventBody(BaseModel):
    session_id: str
    event: dict[str, Any]


class LowballBody(BaseModel):
    quote_total: float
    benchmark_total: Optional[float] = None
    job_spec: Optional[dict[str, Any]] = None


class ClassifyBody(BaseModel):
    transcript_so_far: str = ""
    signals: Optional[dict[str, Any]] = None


# --------------------------------------------------------------------------- #
# Intake / spec-lock
# --------------------------------------------------------------------------- #


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "voicesaver", "spec_locked": STATE.spec_locked,
            "profiles": [p["id"] for p in load_profiles()]}


@app.get("/api/job_spec")
def job_spec() -> dict[str, Any]:
    base = load_job_spec()
    base["spec_locked"] = STATE.spec_locked
    base["job_spec"] = STATE.job_spec
    base["ada_shield"]["self_attested"] = STATE.ada_self_attested
    base["ada_shield"]["active"] = STATE.ada_self_attested
    return base


@app.post("/api/job_spec/lock")
def lock_spec(body: LockSpecBody) -> dict[str, Any]:
    if body.job_spec:
        STATE.job_spec = body.job_spec
    STATE.ada_self_attested = bool(body.ada_self_attested)
    STATE.spec_locked = True
    return {"spec_locked": True, "job_spec": STATE.job_spec,
            "ada_shield": {"self_attested": STATE.ada_self_attested, "active": STATE.ada_self_attested}}


@app.post("/api/job_spec/unlock")
def unlock_spec() -> dict[str, Any]:
    STATE.spec_locked = False
    return {"spec_locked": False}


@app.post("/api/ada/attest")
def ada_attest(body: AdaAttestBody) -> dict[str, Any]:
    """
    Record an EXPLICIT ADA-Shield self-attestation confirmation (the user clicked
    'Confirm & Enable' in the modal, not just flipped a toggle). Audit trail only.
    """
    session_id = body.session_id or STATE.session_id
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "session_id": session_id,
        "event": "ada_shield_self_attestation_confirmed",
        "confirmed": bool(body.confirmed),
        "note": "User explicitly confirmed the self-attestation via the confirmation dialog.",
    }
    AUDIT_LOG.append(event)
    STATE.ada_self_attested = bool(body.confirmed)
    _audit_logger.info("ADA self-attestation confirmed: %s", event)
    return {"ok": True, "event": event, "ada_self_attested": STATE.ada_self_attested}


@app.get("/api/ada/audit")
def ada_audit() -> dict[str, Any]:
    return {"audit": AUDIT_LOG}


@app.get("/api/profiles")
def profiles() -> dict[str, Any]:
    return {"profiles": [_public_profile(p) for p in load_profiles()]}


@app.get("/api/counterparty/modes")
def counterparty_modes() -> dict[str, Any]:
    return {"modes": channel.list_modes()}


@app.get("/api/counterparty/human_in_the_loop")
def counterparty_human(profile_id: str = Query("mover_002_tough")) -> dict[str, Any]:
    """Return the ElevenLabs widget embed info so a teammate can role-play live."""
    _require_profile(profile_id)
    return channel.human_in_the_loop_entrypoint(profile_id)


@app.get("/api/domain")
def domain() -> dict[str, Any]:
    return load_domain_config()


# --------------------------------------------------------------------------- #
# Document intake (REAL one-shot vision call)
# --------------------------------------------------------------------------- #


@app.post("/api/intake/vision")
async def intake_vision(
    file: UploadFile = File(...),
    allow_demo_fallback: bool = Query(False),
) -> dict[str, Any]:
    """Run the real vision extraction on an uploaded document image."""
    suffix = Path(file.filename or "upload.jpg").suffix or ".jpg"
    with tempfile.NamedTemporaryFile(delete=True, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp.flush()
        try:
            return document_parser.parse_document(tmp.name)
        except RuntimeError as exc:
            if allow_demo_fallback:
                fixture = document_parser.demo_fixture()
                fixture["_note"] = f"Vision call unavailable ({exc}); returned labeled demo fixture."
                return fixture
            raise HTTPException(status_code=400, detail=str(exc))
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/intake/demo")
def intake_demo() -> dict[str, Any]:
    return document_parser.demo_fixture()


# --------------------------------------------------------------------------- #
# Agent config + live tool webhooks (the real function-calling surface)
# --------------------------------------------------------------------------- #


@app.get("/api/agent/config")
def agent_config(ada_shield_active: bool = Query(False)) -> dict[str, Any]:
    return build_agent_config(session_id=STATE.session_id, ada_shield_active=ada_shield_active, job_spec=STATE.job_spec)


@app.post("/api/tools/get_price_benchmark")
def tool_get_price_benchmark(body: BenchmarkBody) -> dict[str, Any]:
    return T.get_price_benchmark(body.vertical, body.job_spec)


@app.post("/api/tools/log_competitor_quote")
def tool_log_competitor_quote(body: LogQuoteBody) -> dict[str, Any]:
    try:
        return T.log_competitor_quote(body.session_id, body.quote)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.post("/api/tools/check_lowball_flag")
def tool_check_lowball_flag(body: LowballBody) -> dict[str, Any]:
    try:
        return T.check_lowball_flag(body.quote_total, benchmark_total=body.benchmark_total, job_spec=body.job_spec)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.post("/api/tools/classify_outcome")
def tool_classify_outcome(body: ClassifyBody) -> dict[str, Any]:
    return T.classify_outcome(body.transcript_so_far, signals=body.signals)


@app.post("/api/tools/record_offer_event")
def tool_record_offer_event(body: RecordOfferEventBody) -> dict[str, Any]:
    """Record one structured vendor-offer movement for the live call.

    Distinct from log_competitor_quote (final dossier): this captures the price
    MOVING during the call so the live UI shows a trustworthy price basis. The
    hosted ElevenLabs agent must be configured with this tool for it to fire on a
    real call; until then the frontend uses its labeled transcript fallback.
    """
    try:
        return T.record_offer_event(body.session_id, body.event)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.get("/api/tools/offer_events/{session_id}")
def tool_offer_events(session_id: str) -> dict[str, Any]:
    events = T.get_offer_events(session_id)
    return {"session_id": session_id, "offer_events": events, "offer_state": T.derive_offer_state(events)}


@app.get("/api/tools/logged_quotes/{session_id}")
def tool_logged_quotes(session_id: str) -> dict[str, Any]:
    return {"session_id": session_id, "logged_quotes": T.get_logged_quotes(session_id)}


# --------------------------------------------------------------------------- #
# Session run + report
# --------------------------------------------------------------------------- #


@app.post("/api/session/run")
def session_run(body: RunSessionBody) -> dict[str, Any]:
    if body.require_lock and not STATE.spec_locked:
        raise HTTPException(status_code=409, detail="Spec is not locked. Lock the job spec before launching calls.")
    if body.counterparty_mode != "simulated":
        raise HTTPException(status_code=400,
                            detail=f"counterparty_mode '{body.counterparty_mode}' needs external credentials; only 'simulated' runs locally.")
    ada = body.ada_by_profile
    if ada is None and STATE.ada_self_attested:
        ada = {"mover_002_tough": True}
    session = run_session(session_id=body.session_id or STATE.session_id, ada_by_profile=ada, job_spec=STATE.job_spec)
    report = build_report(session)
    return {"session": session, "report": report}


@app.get("/api/session/demo")
def session_demo() -> dict[str, Any]:
    """Convenience: run the default ordered demo session (no lock required)."""
    session = run_session(session_id=STATE.session_id, ada_by_profile={"mover_002_tough": True})
    return {"session": session, "report": build_report(session)}


@app.get("/api/session/transcript/{profile_id}")
def session_transcript(profile_id: str) -> dict[str, Any]:
    _require_profile(profile_id)
    session = run_session(session_id=STATE.session_id, ada_by_profile={"mover_002_tough": True})
    call = next((c for c in session["calls"] if c["profile"]["id"] == profile_id), None)
    if not call:
        raise HTTPException(status_code=404, detail="No call for that profile in the session.")
    return {"profile_id": profile_id, "outcome": call["outcome"], "transcript": call["transcript"]}


@app.get("/api/audio/{profile_id}")
def audio(profile_id: str) -> FileResponse:
    """Serve the LABELED simulated playback WAV (not a real recording)."""
    _require_profile(profile_id)
    path: Path = AUDIO_DIR / f"sim_playback_{profile_id}.wav"
    if not path.exists():
        generate_all()
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not available.")
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@app.get("/api")
def api_root() -> dict[str, Any]:
    return {
        "service": "VoiceSaver — Automated Negotiation Cockpit API",
        "docs": "/docs",
        "tools": [t["webhook"]["path"] for t in build_agent_config()["tools"]],
        "endpoints": [
            "/api/health", "/api/job_spec", "/api/job_spec/lock", "/api/profiles",
            "/api/counterparty/modes", "/api/intake/vision", "/api/intake/demo",
            "/api/agent/config", "/api/session/run", "/api/session/demo",
            "/api/audio/{profile_id}",
        ],
    }


# --------------------------------------------------------------------------- #
# Serve the built frontend from the same origin (production single-service
# deploy). Mounted LAST so every /api/* route above still takes precedence;
# StaticFiles(html=True) serves index.html at "/" and the hashed Vite assets.
# In local dev the frontend runs on Vite (:5173) and this dir may be absent.
# --------------------------------------------------------------------------- #
_FRONTEND_DIST = ROOT / "frontend" / "dist"
if _FRONTEND_DIST.is_dir():
    # IMPORTANT: never mount StaticFiles at "/" — a root mount matches EVERY path
    # (including /api/health), which shadows the API and makes the healthcheck
    # 404, causing the host to tear the instance down. Instead mount only the
    # hashed Vite assets and serve index.html from explicit routes. Nothing here
    # can ever collide with /api/*.
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="assets")

    @app.get("/", include_in_schema=False)
    def _spa_index() -> FileResponse:
        return FileResponse(_FRONTEND_DIST / "index.html")

    @app.get("/favicon.ico", include_in_schema=False)
    def _favicon() -> FileResponse:
        icon = _FRONTEND_DIST / "favicon.ico"
        if icon.is_file():
            return FileResponse(icon)
        raise HTTPException(status_code=404, detail="No favicon.")

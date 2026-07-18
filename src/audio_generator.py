"""
Simulated-market audio playback (labeled).

IMPORTANT HONESTY NOTE: the product requirement is that the Closing Ledger plays
back the ACTUAL recording of a real live call — never synthesized-after-the-fact
audio. That real recording comes from the ElevenLabs/Twilio call artifact.

This module only produces a clearly-labeled placeholder for the LOCAL SIMULATED
market (which has no real recording), so the demo's media control has something
to play. Every artifact and caption is tagged "simulated" and must be surfaced
in the UI as "Simulated market playback — not a real call recording."
"""

from __future__ import annotations

import argparse
import math
import struct
import wave
from pathlib import Path
from typing import Any, Optional

from .config_loader import ASSETS_DIR, ROOT
from .negotiator_agent import run_session

AUDIO_DIR = ASSETS_DIR / "audio"
FRONTEND_AUDIO_DIR = ROOT / "frontend" / "public" / "audio"

SAMPLE_RATE = 22_050
BIT_DEPTH = 16


def extract_highlight(call: dict[str, Any]) -> dict[str, Any]:
    """Pick the most dramatic moment: the mid-call price drop, else the close."""
    drop = next((m for m in call["transcript"] if m.get("is_price_drop")), None)
    if drop is None:
        # Fall back to the last dispatcher line (decline) or itemized close.
        dispatcher_msgs = [m for m in call["transcript"] if m["speaker"] == "dispatcher"]
        drop = dispatcher_msgs[-1] if dispatcher_msgs else call["transcript"][-1]

    timeline = call["price_timeline"]
    price_after = drop.get("price_on_table")
    price_before = timeline[0] if timeline else price_after
    return {
        "profile_id": call["profile"]["id"],
        "dispatcher": call["profile"]["name"],
        "outcome": call["outcome"],
        "price_before": price_before,
        "price_after": price_after,
        "drop": (price_before - price_after) if (price_before and price_after) else 0,
        "line": drop["text"],
    }


def _synthesize_placeholder_wav(highlight: dict[str, Any], out_path: Path) -> None:
    """Sonify the moment (tense tone -> swell -> descending glide). Placeholder only."""
    frames = bytearray()
    max_amplitude = 2 ** (BIT_DEPTH - 1) - 1

    def tone(f0: float, f1: float, duration: float, volume: float) -> None:
        n = int(SAMPLE_RATE * duration)
        for i in range(n):
            t = i / SAMPLE_RATE
            progress = i / max(n - 1, 1)
            freq = f0 + (f1 - f0) * progress
            envelope = math.sin(math.pi * progress) ** 0.5
            frames.extend(struct.pack("<h", int(max_amplitude * volume * envelope * math.sin(2 * math.pi * freq * t))))

    def silence(duration: float) -> None:
        frames.extend(b"\x00\x00" * int(SAMPLE_RATE * duration))

    tone(220.0, 235.0, 0.55, 0.35)
    silence(0.06)
    tone(300.0, 520.0, 0.30, 0.5)
    silence(0.05)
    drop_ratio = min(max((highlight.get("drop") or 0) / max(highlight.get("price_before") or 1, 1), 0.05), 0.6)
    tone(520.0, 120.0, 0.8 + drop_ratio * 1.6, 0.45)
    silence(0.05)
    tone(160.0, 160.0, 0.4, 0.3)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(BIT_DEPTH // 8)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(bytes(frames))


def generate_for_call(call: dict[str, Any], mirror_to_frontend: bool = True) -> dict[str, Any]:
    highlight = extract_highlight(call)
    filename = f"sim_playback_{highlight['profile_id']}.wav"
    primary = AUDIO_DIR / filename
    _synthesize_placeholder_wav(highlight, primary)
    paths = [str(primary.relative_to(ROOT))]
    if mirror_to_frontend:
        mirror = FRONTEND_AUDIO_DIR / filename
        _synthesize_placeholder_wav(highlight, mirror)
        paths.append(str(mirror.relative_to(ROOT)))
    return {
        **highlight,
        "provider": "simulated_placeholder",
        "is_real_recording": False,
        "label": "Simulated market playback — not a real call recording.",
        "format": "wav",
        "filename": filename,
        "audio_path": str(primary.relative_to(ROOT)),
        "written_paths": paths,
    }


def generate_all(session: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    session = session or run_session()
    out = []
    for call in session["calls"]:
        meta = generate_for_call(call)
        out.append(meta)
        print(f"[sim-audio] {meta['profile_id']:<20} -> {meta['audio_path']}  ({meta['label']})")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate labeled simulated-market playback audio.")
    parser.parse_args()
    generate_all()


if __name__ == "__main__":
    main()

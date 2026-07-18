"""
Mock ElevenLabs audio pipeline.

In production this module would call the ElevenLabs text-to-speech / audio-native
API to voice the single most dramatic highlight of a negotiation — the moment
Alex throws down the verified competitor bid and the mover audibly caves.

Here we keep it fully self-contained: we (1) pick that highlight turn straight
from the engine's transcript, and (2) synthesize a short, real 16-bit WAV
placeholder with the Python standard library so the frontend Play button always
has a working asset — no API key required. Swap `_synthesize_placeholder_wav`
for a real ElevenLabs call to go live.
"""

from __future__ import annotations

import argparse
import math
import struct
import wave
from pathlib import Path
from typing import Any, Optional

from .negotiation_engine import ROOT, load_profiles, run_negotiation

AUDIO_DIR = ROOT / "assets" / "audio"
FRONTEND_AUDIO_DIR = ROOT / "frontend" / "public" / "audio"

SAMPLE_RATE = 22_050
BIT_DEPTH = 16


# --------------------------------------------------------------------------- #
# Highlight extraction
# --------------------------------------------------------------------------- #


def extract_highlight(result: dict[str, Any]) -> dict[str, Any]:
    """
    Return the single most dramatic exchange: the mover's breakthrough line
    (the price collapse) paired with Alex's leverage line that triggered it.
    """
    transcript = result["transcript"]
    mover_break = next(
        (m for m in transcript if m["role"] == "mover" and m["is_breakthrough"]),
        None,
    )
    if mover_break is None:
        # Fallback: the largest downward move even if not explicitly flagged.
        mover_msgs = [m for m in transcript if m["role"] == "mover"]
        mover_break = min(mover_msgs, key=lambda m: m["price_on_table"])

    turn = mover_break["turn"]
    negotiator_line = next(
        (m for m in transcript if m["turn"] == turn and m["role"] == "negotiator"),
        None,
    )

    price_before = result["price_timeline"][turn - 2] if turn >= 2 else result["opening_price"]
    price_after = mover_break["price_on_table"]

    return {
        "profile_id": result["profile"]["id"],
        "mover_name": result["profile"]["name"],
        "voice_id": result["profile"]["voice_id"],
        "turn": turn,
        "negotiator_line": negotiator_line["text"] if negotiator_line else "",
        "mover_line": mover_break["text"],
        "price_before": price_before,
        "price_after": price_after,
        "drop": price_before - price_after,
    }


# --------------------------------------------------------------------------- #
# Placeholder synthesis (stand-in for the ElevenLabs render)
# --------------------------------------------------------------------------- #


def _synthesize_placeholder_wav(highlight: dict[str, Any], out_path: Path) -> None:
    """
    Sonify the price collapse: a tense held tone, a short 'gasp' swell, then a
    descending glide whose length scales with how far the price dropped. This is
    a deterministic stand-in for a real ElevenLabs voice render.
    """
    frames = bytearray()
    max_amplitude = 2 ** (BIT_DEPTH - 1) - 1

    def tone(freq_start: float, freq_end: float, duration: float, volume: float) -> None:
        n = int(SAMPLE_RATE * duration)
        for i in range(n):
            t = i / SAMPLE_RATE
            progress = i / max(n - 1, 1)
            freq = freq_start + (freq_end - freq_start) * progress
            # Soft attack/release envelope to avoid clicks.
            envelope = math.sin(math.pi * progress) ** 0.5
            sample = volume * envelope * math.sin(2 * math.pi * freq * t)
            frames.extend(struct.pack("<h", int(max_amplitude * sample)))

    def silence(duration: float) -> None:
        frames.extend(b"\x00\x00" * int(SAMPLE_RATE * duration))

    # 1) Tense held tone (the standoff).
    tone(220.0, 235.0, 0.55, 0.35)
    silence(0.06)
    # 2) The gasp — a quick upward swell as leverage lands.
    tone(300.0, 520.0, 0.30, 0.5)
    silence(0.05)
    # 3) The collapse — descending glide, longer for a bigger drop.
    drop_ratio = min(max(highlight["drop"] / max(highlight["price_before"], 1), 0.05), 0.6)
    collapse_duration = 0.8 + drop_ratio * 1.6
    tone(520.0, 120.0, collapse_duration, 0.45)
    # 4) Resolve — a low, steady 'deal closed' tone.
    silence(0.05)
    tone(160.0, 160.0, 0.4, 0.3)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(BIT_DEPTH // 8)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(bytes(frames))


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


def generate_highlight_audio(
    profile_id: str,
    result: Optional[dict[str, Any]] = None,
    mirror_to_frontend: bool = True,
) -> dict[str, Any]:
    """
    Run (or reuse) a negotiation, extract its highlight, synthesize the audio,
    and return metadata including the saved file path(s).
    """
    result = result or run_negotiation(profile_id)
    highlight = extract_highlight(result)

    filename = f"highlight_{profile_id}.wav"
    primary_path = AUDIO_DIR / filename
    _synthesize_placeholder_wav(highlight, primary_path)

    paths = [str(primary_path.relative_to(ROOT))]
    if mirror_to_frontend:
        mirror_path = FRONTEND_AUDIO_DIR / filename
        _synthesize_placeholder_wav(highlight, mirror_path)
        paths.append(str(mirror_path.relative_to(ROOT)))

    return {
        **highlight,
        "provider": "mock_elevenlabs",
        "format": "wav",
        "sample_rate": SAMPLE_RATE,
        "filename": filename,
        "audio_path": str(primary_path.relative_to(ROOT)),
        "written_paths": paths,
        "caption": (
            f"Turn {highlight['turn']} breakthrough — {highlight['mover_name']} drops "
            f"${highlight['price_before']:,} to ${highlight['price_after']:,} "
            f"(-${highlight['drop']:,})."
        ),
    }


def generate_all() -> list[dict[str, Any]]:
    results = []
    for profile in load_profiles():
        meta = generate_highlight_audio(profile["id"])
        results.append(meta)
        print(f"[audio] {profile['id']:<18} -> {meta['audio_path']}  ({meta['caption']})")
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate mock ElevenLabs highlight audio.")
    parser.add_argument("--profile", default="all", help="Profile id or 'all'.")
    args = parser.parse_args()

    if args.profile == "all":
        generate_all()
    else:
        meta = generate_highlight_audio(args.profile)
        print(f"[audio] {meta['audio_path']}  ({meta['caption']})")


if __name__ == "__main__":
    main()

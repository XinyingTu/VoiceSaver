"""Shared configuration loading for the VoiceSaver backend."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
ASSETS_DIR = ROOT / "assets"


def load_json(name: str) -> dict[str, Any]:
    with (CONFIG_DIR / name).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_domain_config() -> dict[str, Any]:
    return load_json("domain_config.json")


def load_profiles() -> list[dict[str, Any]]:
    return load_json("counterparty_profiles.json")["profiles"]


def load_job_spec() -> dict[str, Any]:
    return load_json("job_spec.json")


def load_negotiator_prompt() -> str:
    return (CONFIG_DIR / "negotiator_prompt.txt").read_text(encoding="utf-8")


def get_profile(profile_id: str) -> dict[str, Any]:
    for profile in load_profiles():
        if profile["id"] == profile_id:
            return profile
    valid = ", ".join(p["id"] for p in load_profiles())
    raise KeyError(f"Unknown profile '{profile_id}'. Valid ids: {valid}")

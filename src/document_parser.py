"""
Document intake path — Beat 1 (vision/OCR).

Turns a user-supplied photo (a handwritten quote, a bill, an inventory sheet)
into the SAME structured JSON schema the voice-interview path produces, so the
frontend's spec-lock step can display/edit/confirm either source identically.

This performs a REAL one-shot vision API call (OpenAI chat completions, a
vision-capable model). It is env-gated on OPENAI_API_KEY: with a key + an image
it makes a genuine network call and returns the model's structured extraction —
it does not fabricate data. Without a key you can pass --demo to get a clearly
labeled synthetic fixture for offline UI wiring only.

Usage:
    OPENAI_API_KEY=sk-... python -m src.document_parser --image daniel_quote.jpg
    python -m src.document_parser --demo         # labeled offline fixture
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

from .config_loader import load_domain_config, load_job_spec

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_VISION_MODEL = os.environ.get("VISION_MODEL", "gpt-4o")

HOUSEHOLD_ENUMS = ["studio", "1_bedroom", "2_bedroom", "3_bedroom", "4_bedroom_plus"]


def _extraction_instruction() -> str:
    domain = load_domain_config()
    taxonomy = domain["job_spec_taxonomy"]
    fee_items = domain["fee_line_items"]
    return (
        "You are a vision extraction engine for a moving-services quote/intake document. "
        "Read the attached image and return STRICT JSON only, no prose. Use this schema:\n"
        "{\n"
        '  "job_spec": {\n'
        f'    "household_size": one of {HOUSEHOLD_ENUMS} or null,\n'
        '    "origin_zip": string or null,\n'
        '    "destination_zip": string or null,\n'
        '    "inventory_items": array of strings (may be empty),\n'
        '    "stair_flights": integer or null\n'
        "  },\n"
        '  "parsed_quote": {\n'
        '    "company": string or null,\n'
        '    "total": number or null,\n'
        '    "fee_line_items": object mapping any of '
        f"{fee_items} to numbers (omit unknown ones)\n"
        "  },\n"
        '  "confidence": number between 0 and 1\n'
        "}\n"
        f"job_spec_taxonomy to populate: {taxonomy}. "
        "If a field is not present in the image, use null (or an empty array for lists). "
        "Never invent values that are not visible in the document."
    )


def _encode_image(image_path: Path) -> tuple[str, str]:
    mime, _ = mimetypes.guess_type(str(image_path))
    mime = mime or "image/jpeg"
    b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return b64, mime


def build_request_payload(image_b64: str, mime: str, model: str = DEFAULT_VISION_MODEL) -> dict[str, Any]:
    """Build the exact chat-completions payload for the one-shot vision call."""
    return {
        "model": model,
        "response_format": {"type": "json_object"},
        "temperature": 0,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _extraction_instruction()},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{image_b64}"},
                    },
                ],
            }
        ],
    }


def _post_openai(payload: dict[str, Any], api_key: str, timeout: int = 60) -> dict[str, Any]:
    request = urllib.request.Request(
        OPENAI_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def parse_vision_response(raw: dict[str, Any]) -> dict[str, Any]:
    """Extract and normalize the structured JSON from an OpenAI response object."""
    content = raw["choices"][0]["message"]["content"]
    data = json.loads(content) if isinstance(content, str) else content
    return normalize_extraction(data)


def normalize_extraction(data: dict[str, Any]) -> dict[str, Any]:
    """Coerce a raw extraction into the canonical intake schema."""
    job = data.get("job_spec") or {}
    household = job.get("household_size")
    if household not in HOUSEHOLD_ENUMS:
        household = None

    def _int_or_none(v: Any) -> Optional[int]:
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    def _num_or_none(v: Any) -> Optional[float]:
        try:
            return round(float(v), 2)
        except (TypeError, ValueError):
            return None

    quote = data.get("parsed_quote") or {}
    fee_items = quote.get("fee_line_items") or {}
    fee_items = {k: _num_or_none(v) for k, v in fee_items.items() if _num_or_none(v) is not None}

    return {
        "job_spec": {
            "household_size": household,
            "origin_zip": job.get("origin_zip"),
            "destination_zip": job.get("destination_zip"),
            "inventory_items": list(job.get("inventory_items") or []),
            "stair_flights": _int_or_none(job.get("stair_flights")),
        },
        "parsed_quote": {
            "company": quote.get("company"),
            "total": _num_or_none(quote.get("total")),
            "fee_line_items": fee_items,
        },
        "confidence": _num_or_none(data.get("confidence")),
        "_mode": "vision_api",
    }


def parse_document(
    image_path: str | Path,
    api_key: Optional[str] = None,
    model: str = DEFAULT_VISION_MODEL,
) -> dict[str, Any]:
    """
    Run the REAL one-shot vision extraction on an image and return the intake
    schema. Raises if no API key is available (we do not fabricate OCR output).
    """
    api_key = api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. The document intake path performs a real "
            "vision API call and will not fabricate data. Set the key, or use "
            "demo_fixture() explicitly for offline UI wiring."
        )
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {path}")

    image_b64, mime = _encode_image(path)
    payload = build_request_payload(image_b64, mime, model=model)
    raw = _post_openai(payload, api_key)
    result = parse_vision_response(raw)
    result["_source_image"] = path.name
    result["_model"] = model
    return result


def demo_fixture() -> dict[str, Any]:
    """
    Clearly-labeled offline fixture for wiring the UI without a key. This is NOT
    a vision result; it mirrors Daniel's prior written quote ($1,850, itemized)
    so the spec-lock + seed-leverage flow can be exercised locally.
    """
    spec = load_job_spec()["job_spec"]
    return {
        "job_spec": {
            "household_size": spec["household_size"],
            "origin_zip": spec["origin_zip"],
            "destination_zip": spec["destination_zip"],
            "inventory_items": spec["inventory_items"],
            "stair_flights": spec["stair_flights"],
        },
        "parsed_quote": {
            "company": "BlueLine Movers (prior written quote)",
            "total": 1850.0,
            "fee_line_items": {
                "base_labor_fee": 941.0,
                "mileage_fee": 675.0,
                "stair_carry_fee": 80.0,
                "long_carry_fee": 0.0,
                "packing_materials_fee": 100.0,
                "fuel_surcharge": 54.0,
            },
        },
        "confidence": None,
        "_mode": "demo_fixture",
        "_warning": "Offline fixture — not produced by a vision model. Do not present as OCR output.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="One-shot vision document intake.")
    parser.add_argument("--image", help="Path to a photo/scan of a quote or intake document.")
    parser.add_argument("--demo", action="store_true", help="Return the labeled offline fixture instead of calling the API.")
    parser.add_argument("--model", default=DEFAULT_VISION_MODEL)
    args = parser.parse_args()

    if args.demo:
        print(json.dumps(demo_fixture(), indent=2))
        return
    if not args.image:
        parser.error("Provide --image PATH (real vision call) or --demo.")
    try:
        result = parse_document(args.image, model=args.model)
        print(json.dumps(result, indent=2))
    except (RuntimeError, FileNotFoundError, urllib.error.URLError) as exc:
        print(json.dumps({"error": str(exc)}, indent=2))


if __name__ == "__main__":
    main()

"""Unit tests for Permit2 detection in serialized permission blobs."""

import base64
import json

from app.services.optimizer.rebalancer import _permission_blob_contains_address


PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"


def test_detects_permit2_in_base64_json_blob() -> None:
    payload = {
        "rules": [
            {"target": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"},
            {"target": PERMIT2},
        ]
    }
    blob = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")

    assert _permission_blob_contains_address(blob, PERMIT2) is True


def test_detects_permit2_in_plaintext_blob() -> None:
    plain_blob = f"{{\"target\":\"{PERMIT2}\"}}"

    assert _permission_blob_contains_address(plain_blob, PERMIT2) is True


def test_returns_false_when_permit2_not_present() -> None:
    payload = {"rules": [{"target": "0x1111111111111111111111111111111111111111"}]}
    blob = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")

    assert _permission_blob_contains_address(blob, PERMIT2) is False


def test_handles_invalid_base64_without_crashing() -> None:
    invalid_blob = "%%%%not-base64%%%%"

    assert _permission_blob_contains_address(invalid_blob, PERMIT2) is False

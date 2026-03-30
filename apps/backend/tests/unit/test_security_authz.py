"""Unit tests for authentication and account ownership checks."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
import httpx
from fastapi import HTTPException

from app.core import security
from app.core.security import require_privy_auth, verify_account_ownership


OWNER_ADDRESS = "0x1111111111111111111111111111111111111111"
OTHER_ADDRESS = "0x2222222222222222222222222222222222222222"


def _claims(owner_address: str, did: str = "did:privy:user-1") -> dict:
    return {
        "sub": did,
        "linked_accounts": [
            {
                "type": "wallet",
                "address": owner_address,
            }
        ],
    }


def _claims_without_wallet(did: str = "did:privy:user-1") -> dict:
    return {
        "sub": did,
    }


def _db_mock() -> tuple[MagicMock, MagicMock]:
    db = MagicMock()
    table = MagicMock()
    db.table.return_value = table
    table.update.return_value = table
    table.eq.return_value = table
    table.execute.return_value = MagicMock(data=[])
    return db, table


@pytest.mark.asyncio
async def test_require_privy_auth_rejects_missing_header() -> None:
    with pytest.raises(HTTPException) as exc:
        await require_privy_auth(None)

    assert exc.value.status_code == 401


def test_verify_account_ownership_allows_matching_did_and_wallet() -> None:
    claims = _claims(OWNER_ADDRESS)
    account = {
        "id": "acc-1",
        "address": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "owner_address": OWNER_ADDRESS,
        "privy_did": "did:privy:user-1",
    }
    db, table = _db_mock()

    verify_account_ownership(claims, account, db=db)

    table.update.assert_not_called()


def test_verify_account_ownership_rejects_did_mismatch() -> None:
    claims = _claims(OWNER_ADDRESS, did="did:privy:caller")
    account = {
        "id": "acc-1",
        "address": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "owner_address": OWNER_ADDRESS,
        "privy_did": "did:privy:owner",
    }

    with pytest.raises(HTTPException) as exc:
        verify_account_ownership(claims, account)

    assert exc.value.status_code == 403


def test_verify_account_ownership_rejects_wallet_mismatch() -> None:
    claims = _claims(OTHER_ADDRESS)
    account = {
        "id": "acc-1",
        "address": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "owner_address": OWNER_ADDRESS,
        "privy_did": "did:privy:user-1",
    }

    with pytest.raises(HTTPException) as exc:
        verify_account_ownership(claims, account)

    assert exc.value.status_code == 403


def test_verify_account_ownership_allows_did_match_without_wallet_claims() -> None:
    claims = _claims_without_wallet(did="did:privy:user-1")
    account = {
        "id": "acc-1",
        "address": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "owner_address": OWNER_ADDRESS,
        "privy_did": "did:privy:user-1",
    }

    verify_account_ownership(claims, account)


def test_verify_account_ownership_backfills_legacy_did_once() -> None:
    claims = _claims(OWNER_ADDRESS, did="did:privy:new")
    account = {
        "id": "acc-legacy",
        "address": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "owner_address": OWNER_ADDRESS,
        "privy_did": None,
    }
    db, table = _db_mock()

    verify_account_ownership(claims, account, db=db)

    table.update.assert_called_once_with({"privy_did": "did:privy:new"})


def test_extract_linked_accounts_from_privy_user_response_handles_shapes() -> None:
    direct = {"linked_accounts": [{"type": "wallet", "address": OWNER_ADDRESS}]}
    nested_user = {"user": {"linked_accounts": [{"type": "wallet", "address": OWNER_ADDRESS}]}}
    nested_data = {"data": {"linked_accounts": [{"type": "wallet", "address": OWNER_ADDRESS}]}}

    assert security._extract_linked_accounts_from_privy_user_response(direct)
    assert security._extract_linked_accounts_from_privy_user_response(nested_user)
    assert security._extract_linked_accounts_from_privy_user_response(nested_data)


@pytest.mark.asyncio
async def test_maybe_enrich_wallet_claims_hydrates_from_privy_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_fetch(app_id: str, app_secret: str, did: str) -> list[dict]:
        assert app_id == "app_123"
        assert app_secret == "secret_123"
        assert did == "did:privy:user-1"
        return [{"type": "wallet", "address": OWNER_ADDRESS}]

    monkeypatch.setattr(security, "_fetch_privy_user_linked_accounts", _fake_fetch)

    payload = {
        "sub": "did:privy:user-1",
        "aud": "app_123",
        "iss": "privy.io",
    }

    enriched = await security._maybe_enrich_wallet_claims(
        payload,
        app_id="app_123",
        app_secret="secret_123",
    )

    wallets = security._extract_wallet_addresses(enriched)
    assert OWNER_ADDRESS.lower() in wallets


@pytest.mark.asyncio
async def test_maybe_enrich_wallet_claims_skips_when_wallet_claim_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    called = False

    async def _fake_fetch(app_id: str, app_secret: str, did: str) -> list[dict]:
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(security, "_fetch_privy_user_linked_accounts", _fake_fetch)

    payload = _claims(OWNER_ADDRESS)
    enriched = await security._maybe_enrich_wallet_claims(
        payload,
        app_id="app_123",
        app_secret="secret_123",
    )

    assert enriched == payload
    assert called is False


class _FakeResponse:
    def __init__(self, url: str, status_code: int, payload: dict | None = None) -> None:
        self.url = url
        self.status_code = status_code
        self._payload = payload or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("GET", self.url)
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("error", request=request, response=response)

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    def __init__(self, responses: list[_FakeResponse], seen_urls: list[str]) -> None:
        self._responses = responses
        self._seen_urls = seen_urls

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def get(self, url: str, timeout: int = 10) -> _FakeResponse:
        del timeout
        self._seen_urls.append(url)
        if not self._responses:
            request = httpx.Request("GET", url)
            response = httpx.Response(500, request=request)
            raise httpx.HTTPStatusError("missing fake response", request=request, response=response)
        return self._responses.pop(0)


@pytest.mark.asyncio
async def test_fetch_privy_jwks_uses_primary_endpoint_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    security._privy_jwks_cache = None
    security._privy_jwks_last_fetch = 0.0

    seen_urls: list[str] = []
    responses = [
        _FakeResponse(
            "https://auth.privy.io/api/v1/apps/app_123/jwks.json",
            200,
            {"keys": [{"kid": "k1"}]},
        )
    ]

    monkeypatch.setattr(
        security.httpx,
        "AsyncClient",
        lambda: _FakeAsyncClient(responses, seen_urls),
    )

    jwks1 = await security._fetch_privy_jwks("app_123")
    jwks2 = await security._fetch_privy_jwks("app_123")

    assert jwks1 == {"keys": [{"kid": "k1"}]}
    assert jwks2 == jwks1
    assert seen_urls == ["https://auth.privy.io/api/v1/apps/app_123/jwks.json"]


@pytest.mark.asyncio
async def test_fetch_privy_jwks_falls_back_to_legacy_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    security._privy_jwks_cache = None
    security._privy_jwks_last_fetch = 0.0

    seen_urls: list[str] = []
    responses = [
        _FakeResponse("https://auth.privy.io/api/v1/apps/app_123/jwks.json", 404),
        _FakeResponse(
            "https://auth.privy.io/api/v1/apps/app_123/.well-known/jwks.json",
            200,
            {"keys": [{"kid": "legacy"}]},
        ),
    ]

    monkeypatch.setattr(
        security.httpx,
        "AsyncClient",
        lambda: _FakeAsyncClient(responses, seen_urls),
    )

    jwks = await security._fetch_privy_jwks("app_123")

    assert jwks == {"keys": [{"kid": "legacy"}]}
    assert seen_urls == [
        "https://auth.privy.io/api/v1/apps/app_123/jwks.json",
        "https://auth.privy.io/api/v1/apps/app_123/.well-known/jwks.json",
    ]


@pytest.mark.asyncio
async def test_verify_privy_token_rejects_audience_mismatch_without_relaxed_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Settings:
        PRIVY_APP_ID = "app_123"
        PRIVY_APP_SECRET = "secret_123"

    async def _fake_fetch_jwks(app_id: str) -> dict:
        assert app_id == "app_123"
        return {"keys": [{"kid": "k1"}]}

    used_relaxed_path = False

    def _fake_decode(
        token: str,
        jwks: dict,
        algorithms: list[str],
        audience: str | None = None,
        issuer: str | None = None,
        options: dict | None = None,
    ) -> dict:
        del token, jwks, algorithms, audience, issuer
        nonlocal used_relaxed_path
        if options and options.get("verify_aud") is False:
            used_relaxed_path = True
            return {
                "sub": "did:privy:user-1",
                "aud": "wrong_audience",
                "iss": "privy.io",
            }
        raise security.JWTError("audience mismatch")

    monkeypatch.setattr(security, "get_settings", lambda: _Settings())
    monkeypatch.setattr(security, "_fetch_privy_jwks", _fake_fetch_jwks)
    monkeypatch.setattr(security.jwt, "decode", _fake_decode)
    monkeypatch.setattr(security.jwt, "get_unverified_header", lambda _token: {"alg": "ES256", "kid": "k1"})
    monkeypatch.setattr(
        security.jwt,
        "get_unverified_claims",
        lambda _token: {"iss": "privy.io", "aud": "wrong_audience"},
    )

    result = await security.verify_privy_token("dummy_token")

    assert result is None
    assert used_relaxed_path is False

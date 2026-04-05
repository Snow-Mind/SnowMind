"""Authenticated chat assistant routes (Gemini + session context)."""

import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_privy_auth
from app.models.base import CamelModel
from app.services.assistant import (
    AssistantKnowledgeBase,
    AssistantSessionStore,
    AssistantStoredMessage,
    GeminiAssistantClient,
)
from app.services.optimizer.risk_scorer import RiskScorer

logger = logging.getLogger("snowmind")

router = APIRouter()

_assistant_client = GeminiAssistantClient()
_assistant_knowledge_base = AssistantKnowledgeBase()
_assistant_session_store = AssistantSessionStore()
_risk_scorer = RiskScorer()

_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class AssistantChatRequest(BaseModel):
    session_id: str | None = Field(default=None, max_length=64)
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("session_id")
    @classmethod
    def _normalize_optional_session_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("message")
    @classmethod
    def _normalize_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be empty")
        return normalized


class AssistantMessageResponse(CamelModel):
    role: str
    content: str
    created_at: str


class AssistantChatResponse(CamelModel):
    session_id: str
    reply: str
    messages: list[AssistantMessageResponse]
    model: str
    context_sources: list[str]


class AssistantSessionResponse(CamelModel):
    session_id: str
    messages: list[AssistantMessageResponse]


def _extract_user_id(auth_claims: dict) -> str:
    sub = auth_claims.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication claims",
        )
    return sub.strip()


def _normalize_session_id(raw_session_id: str | None, *, allow_generate: bool = True) -> str:
    if raw_session_id is None or not raw_session_id.strip():
        if not allow_generate:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="sessionId is required",
            )
        return uuid.uuid4().hex

    normalized = raw_session_id.strip()
    if not _SESSION_ID_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="sessionId must match [A-Za-z0-9_-] and be 8-64 chars",
        )
    return normalized


def _serialize_messages(messages: list[AssistantStoredMessage]) -> list[AssistantMessageResponse]:
    return [
        AssistantMessageResponse(
            role=message.role,
            content=message.content,
            created_at=message.created_at,
        )
        for message in messages
    ]


def _build_dynamic_risk_snapshot_summary(db: Client) -> str:
    scores = _risk_scorer.get_latest_persisted_scores(db)
    if not scores:
        return (
            "No rows were found in daily_risk_scores. "
            "Risk responses should fall back to live on-demand scoring from current protocol rates."
        )

    max_age_hours = max(1, int(get_settings().RISK_SCORE_MAX_AGE_HOURS))
    now = datetime.now(timezone.utc)

    lines: list[str] = [
        f"Persisted snapshot protocols: {len(scores)}",
        f"Freshness threshold: {max_age_hours} hour(s)",
    ]

    stale_count = 0
    for protocol_id in sorted(scores.keys()):
        score = scores[protocol_id]
        is_stale = _risk_scorer.is_snapshot_stale(
            score,
            max_age_hours=max_age_hours,
            now=now,
        )
        if is_stale:
            stale_count += 1

        snapshot_time = "unknown"
        if score.snapshot_created_at is not None:
            snapshot_time = score.snapshot_created_at.isoformat()
        elif score.snapshot_date is not None:
            snapshot_time = score.snapshot_date.isoformat()

        static_subtotal = (
            score.breakdown.oracle
            + score.breakdown.collateral
            + score.breakdown.architecture
        )
        dynamic_subtotal = score.breakdown.liquidity + score.breakdown.yield_profile

        lines.append(
            (
                f"- {protocol_id}: total={score.score}/{score.score_max}, "
                f"static={static_subtotal}/5, dynamic={dynamic_subtotal}/4, "
                f"sampleDays={score.sample_days}, snapshot={snapshot_time}, "
                f"status={'stale' if is_stale else 'fresh'}"
            )
        )

    lines.append(f"Fresh snapshots: {len(scores) - stale_count}; stale snapshots: {stale_count}")
    return "\n".join(lines)


@router.post("/chat", response_model=AssistantChatResponse)
@limiter.limit("30/minute")
async def chat_with_assistant(
    request: Request,
    payload: AssistantChatRequest,
    db: Client = Depends(get_db),
    auth_claims: dict = Depends(require_privy_auth),
):
    """Submit one user message and return model reply with session context."""
    del request

    user_id = _extract_user_id(auth_claims)
    session_id = _normalize_session_id(payload.session_id, allow_generate=True)

    max_history = max(4, int(get_settings().ASSISTANT_MAX_HISTORY_MESSAGES))

    _assistant_session_store.append_message(
        db,
        privy_user_id=user_id,
        session_id=session_id,
        role="user",
        content=payload.message,
    )

    history = _assistant_session_store.get_recent_messages(
        db,
        privy_user_id=user_id,
        session_id=session_id,
        limit=max_history,
    )

    dynamic_summary = _build_dynamic_risk_snapshot_summary(db)
    grounding_context, context_sources = _assistant_knowledge_base.build_grounding_context(dynamic_summary)

    try:
        reply = await _assistant_client.generate_reply(
            messages=history,
            grounding_context=grounding_context,
        )
    except RuntimeError as exc:
        detail = str(exc)
        if "not configured" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Assistant is not configured",
            ) from exc

        logger.warning("Assistant model request failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Assistant request failed",
        ) from exc

    stored_reply = _assistant_session_store.append_message(
        db,
        privy_user_id=user_id,
        session_id=session_id,
        role="assistant",
        content=reply,
    )

    updated_history = _assistant_session_store.get_recent_messages(
        db,
        privy_user_id=user_id,
        session_id=session_id,
        limit=max_history,
    )

    return AssistantChatResponse(
        session_id=session_id,
        reply=stored_reply.content,
        messages=_serialize_messages(updated_history),
        model=get_settings().GEMINI_MODEL,
        context_sources=context_sources,
    )


@router.get("/sessions/{session_id}", response_model=AssistantSessionResponse)
@limiter.limit("60/minute")
async def get_assistant_session(
    session_id: str,
    request: Request,
    db: Client = Depends(get_db),
    auth_claims: dict = Depends(require_privy_auth),
):
    """Return recent messages for one authenticated user session id."""
    del request

    user_id = _extract_user_id(auth_claims)
    normalized_session_id = _normalize_session_id(session_id, allow_generate=False)
    max_history = max(4, int(get_settings().ASSISTANT_MAX_HISTORY_MESSAGES))

    history = _assistant_session_store.get_recent_messages(
        db,
        privy_user_id=user_id,
        session_id=normalized_session_id,
        limit=max_history,
    )

    return AssistantSessionResponse(
        session_id=normalized_session_id,
        messages=_serialize_messages(history),
    )

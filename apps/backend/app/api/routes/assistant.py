"""Authenticated chat assistant routes (Gemini + session context)."""

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import Field, field_validator
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_privy_auth
from app.models.base import CamelModel
from app.services.assistant.gemini_assistant import (
    AssistantKnowledgeBase,
    GeminiAssistantClient,
)
from app.services.assistant.session_store import (
    AssistantFeedbackEntry,
    AssistantSessionStore,
    AssistantSessionSummary,
    AssistantStoredMessage,
)
from app.services.optimizer.risk_scorer import RiskScorer

logger = logging.getLogger("snowmind")

router = APIRouter()

_assistant_client = GeminiAssistantClient()
_assistant_knowledge_base = AssistantKnowledgeBase()
_assistant_session_store = AssistantSessionStore()
_risk_scorer = RiskScorer()

_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

_OLCYA_MEANINGS: tuple[str, ...] = (
    "O = Oracle quality (price feed trust)",
    "L = Liquidity (how much withdrawable USDC is available)",
    "C = Collateral quality (how strong/safe collateral is)",
    "Y = Yield profile (how stable APY has been)",
    "A = Architecture (direct deposit vs extra wrapper/curator layer).",
)


class AssistantChatRequest(CamelModel):
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


class AssistantSessionSummaryResponse(CamelModel):
    session_id: str
    title: str
    last_message_at: str


class AssistantSessionListResponse(CamelModel):
    sessions: list[AssistantSessionSummaryResponse]


class AssistantSessionRenameRequest(CamelModel):
    title: str = Field(min_length=1, max_length=120)

    @field_validator("title")
    @classmethod
    def _normalize_title(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("title must not be empty")
        return normalized


class AssistantSessionRenameResponse(CamelModel):
    session_id: str
    title: str


class AssistantSessionDeleteResponse(CamelModel):
    session_id: str
    deleted: bool


class AssistantFeedbackRequest(CamelModel):
    session_id: str = Field(min_length=8, max_length=64)
    message_created_at: str = Field(min_length=8, max_length=64)
    message_content: str = Field(min_length=1, max_length=12000)
    feedback: Literal["up", "down"]
    note: str | None = Field(default=None, max_length=600)

    @field_validator("session_id")
    @classmethod
    def _validate_session_id(cls, value: str) -> str:
        normalized = value.strip()
        if not _SESSION_ID_RE.fullmatch(normalized):
            raise ValueError("sessionId must match [A-Za-z0-9_-] and be 8-64 chars")
        return normalized

    @field_validator("message_created_at")
    @classmethod
    def _validate_message_created_at(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("messageCreatedAt is required")

        raw = normalized
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"

        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError as exc:
            raise ValueError("messageCreatedAt must be a valid ISO datetime") from exc

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()

    @field_validator("message_content")
    @classmethod
    def _normalize_message_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("messageContent must not be empty")
        return normalized

    @field_validator("note")
    @classmethod
    def _normalize_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.strip().split())
        return normalized or None


class AssistantFeedbackResponse(CamelModel):
    session_id: str
    message_created_at: str
    feedback: Literal["up", "down"]
    note: str | None
    saved_at: str


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


def _serialize_session_summaries(
    sessions: list[AssistantSessionSummary],
) -> list[AssistantSessionSummaryResponse]:
    return [
        AssistantSessionSummaryResponse(
            session_id=session.session_id,
            title=session.title,
            last_message_at=session.last_message_at,
        )
        for session in sessions
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
        "Risk categories (use these exact meanings):",
        *_OLCYA_MEANINGS,
        "Always present risk as total score plus O/L/C/Y/A components. Do not split into static vs dynamic subtotals.",
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

        lines.append(
            (
                f"- {protocol_id}: total={score.score}/{score.score_max}, "
                f"O={score.breakdown.oracle}, L={score.breakdown.liquidity}, "
                f"C={score.breakdown.collateral}, Y={score.breakdown.yield_profile}, "
                f"A={score.breakdown.architecture}, "
                f"availableLiquidityUsd={score.available_liquidity_usd}, "
                f"sampleDays={score.sample_days}, snapshot={snapshot_time}, "
                f"status={'stale' if is_stale else 'fresh'}"
            )
        )

    lines.append(f"Fresh snapshots: {len(scores) - stale_count}; stale snapshots: {stale_count}")
    return "\n".join(lines)


def _build_feedback_context(feedback_rows: list[AssistantFeedbackEntry]) -> str:
    if not feedback_rows:
        return "No explicit user feedback signals have been recorded yet."

    positive = sum(1 for row in feedback_rows if row.feedback == "up")
    negative = sum(1 for row in feedback_rows if row.feedback == "down")

    lines: list[str] = [
        f"Recent feedback signals: thumbs_up={positive}, thumbs_down={negative}",
        "Use these as style-quality hints while still prioritizing factual correctness.",
    ]

    for row in feedback_rows[:8]:
        lines.append(
            (
                f"- {row.feedback.upper()} @ {row.created_at} "
                f"(session={row.session_id}, response_at={row.assistant_created_at})"
            )
        )
        lines.append(f"  Response excerpt: {row.message_excerpt}")
        if row.note:
            lines.append(f"  User note: {row.note}")

    return "\n".join(lines)


def _build_response_style_hints(user_message: str) -> str:
    normalized = (user_message or "").strip().lower()
    if not normalized:
        return "No additional style directives for this turn."

    hints: list[str] = []

    asks_risk_calculation = any(
        token in normalized
        for token in (
            "how is risk score",
            "how risk score",
            "risk score calculated",
            "risk score calculation",
            "how is risk calculated",
            "how risk is calculated",
            "why is",
            "why spark",
            "risk score breakdown",
            "score breakdown",
            "o/l/c/y/a",
        )
    ) or (
        "score" in normalized
        and any(token in normalized for token in ("why", "breakdown", "explain", "7/9", "8/9", "9/9"))
    )
    if asks_risk_calculation:
        hints.append(
            "Include this markdown link exactly once in the response: "
            "[Protocol Assessment](https://docs.snowmind.xyz/learn/protocol-assessment)."
        )
        hints.append("Use these exact category meanings:")
        hints.extend(_OLCYA_MEANINGS)
        hints.append(
            "Explain risk using total score and O/L/C/Y/A components only; "
            "do not split into static vs dynamic subtotals."
        )
        hints.append(
            "For single-protocol score questions, provide a complete answer with one concise bullet per O/L/C/Y/A. "
            "Do not end mid-sentence."
        )

    asks_optimizer_scope = any(
        token in normalized
        for token in (
            "max exposure",
            "max cap",
            "allocation cap",
            "market scope",
            "allowed market",
            "allowed protocol",
            "choose market",
            "enable market",
            "optimizer can use",
            "dynamic optimizer",
        )
    )

    asks_fixed_split = any(
        token in normalized
        for token in (
            "sum to 100",
            "sums to 100",
            "totaling 100",
            "fixed split",
            "fixed allocation",
            "equal weight",
            "40/40/20",
            "weights",
        )
    )

    asks_portfolio_advice = (
        (
            "portfolio" in normalized
            and any(
                token in normalized
                for token in (
                    "advice",
                    "strategy",
                    "allocate",
                    "allocation",
                    "conservative",
                    "recommend",
                    "propose",
                )
            )
        )
        or "market strategy" in normalized
        or asks_optimizer_scope
        or asks_fixed_split
    )

    if asks_portfolio_advice:
        if asks_optimizer_scope and not asks_fixed_split:
            hints.append(
                "Treat this as optimizer-configuration guidance, not a fixed split portfolio: "
                "recommend 2-5 enabled markets with per-market max caps (often 100% for enabled markets unless "
                "risk or liquidity constraints justify lower caps), and explicitly state that caps are upper bounds "
                "that do not need to sum to 100 because routing is dynamic."
            )
        elif asks_fixed_split:
            hints.append(
                "Provide a fixed split portfolio with explicit allocation percentages that sum to 100%."
            )
        else:
            hints.append(
                "Default to dynamic optimizer guidance: recommend markets plus per-market max caps rather than "
                "forcing fixed weights, unless the user explicitly requests a fixed split that sums to 100%."
            )

        hints.append(
            "Keep rationale concise and practical, and end recommendation responses with: "
            "This is not financial advice."
        )
        hints.append(
            "If risk is referenced, present it as total risk and O/L/C/Y/A only. "
            "Do not use static/dynamic split wording."
        )

    return "\n".join(hints) if hints else "No additional style directives for this turn."


def _build_transient_fallback_reply(user_message: str) -> str:
    """Return a safe user-facing fallback when the model request fails."""
    normalized = (user_message or "").strip().lower()

    if any(token in normalized for token in ("risk", "score", "olcya", "protocol")):
        return (
            "The assistant model is temporarily unavailable, so I cannot provide a fresh, grounded risk explanation in this response.\n\n"
            "Please retry in a few seconds. If this persists, check status at https://docs.snowmind.xyz/.\n\n"
            "This is not financial advice."
        )

    return (
        "I could not complete that request because the assistant model is temporarily unavailable.\n\n"
        "Please retry in a few seconds. If this persists, check status at https://docs.snowmind.xyz/.\n\n"
        "This is not financial advice."
    )


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

    feedback_rows = _assistant_session_store.list_recent_feedback(
        db,
        privy_user_id=user_id,
        limit=8,
    )
    feedback_context = _build_feedback_context(feedback_rows)
    response_style_hints = _build_response_style_hints(payload.message)

    dynamic_summary = _build_dynamic_risk_snapshot_summary(db)
    grounding_context, context_sources = _assistant_knowledge_base.build_grounding_context(dynamic_summary)

    model_used = get_settings().GEMINI_MODEL

    try:
        reply = await _assistant_client.generate_reply(
            messages=history,
            grounding_context=grounding_context,
            feedback_context=feedback_context,
            response_style_hints=response_style_hints,
        )
    except RuntimeError as exc:
        detail = str(exc)
        if "not configured" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Assistant is not configured",
            ) from exc

        logger.warning("Assistant model request failed: %s", exc)
        reply = _build_transient_fallback_reply(payload.message)
        model_used = f"{model_used}:fallback"

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
        model=model_used,
        context_sources=context_sources,
    )


@router.get("/sessions", response_model=AssistantSessionListResponse)
@limiter.limit("60/minute")
async def list_assistant_sessions(
    request: Request,
    limit: int = Query(default=20, ge=1, le=50),
    db: Client = Depends(get_db),
    auth_claims: dict = Depends(require_privy_auth),
):
    """Return recent sessions for the authenticated user."""
    del request

    user_id = _extract_user_id(auth_claims)

    sessions = _assistant_session_store.list_recent_sessions(
        db,
        privy_user_id=user_id,
        limit=limit,
    )

    return AssistantSessionListResponse(
        sessions=_serialize_session_summaries(sessions),
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


@router.patch("/sessions/{session_id}", response_model=AssistantSessionRenameResponse)
@limiter.limit("60/minute")
async def rename_assistant_session(
    session_id: str,
    payload: AssistantSessionRenameRequest,
    request: Request,
    db: Client = Depends(get_db),
    auth_claims: dict = Depends(require_privy_auth),
):
    """Persist a session title override for the authenticated user."""
    del request

    user_id = _extract_user_id(auth_claims)
    normalized_session_id = _normalize_session_id(session_id, allow_generate=False)

    normalized_title = _assistant_session_store.rename_session(
        db,
        privy_user_id=user_id,
        session_id=normalized_session_id,
        title=payload.title,
    )

    return AssistantSessionRenameResponse(
        session_id=normalized_session_id,
        title=normalized_title,
    )


@router.delete("/sessions/{session_id}", response_model=AssistantSessionDeleteResponse)
@limiter.limit("60/minute")
async def delete_assistant_session(
    session_id: str,
    request: Request,
    db: Client = Depends(get_db),
    auth_claims: dict = Depends(require_privy_auth),
):
    """Delete one assistant session and its associated feedback for the authenticated user."""
    del request

    user_id = _extract_user_id(auth_claims)
    normalized_session_id = _normalize_session_id(session_id, allow_generate=False)

    deleted = _assistant_session_store.delete_session(
        db,
        privy_user_id=user_id,
        session_id=normalized_session_id,
    )

    return AssistantSessionDeleteResponse(
        session_id=normalized_session_id,
        deleted=deleted,
    )


@router.post("/feedback", response_model=AssistantFeedbackResponse)
@limiter.limit("120/minute")
async def submit_assistant_feedback(
    request: Request,
    payload: AssistantFeedbackRequest,
    db: Client = Depends(get_db),
    auth_claims: dict = Depends(require_privy_auth),
):
    """Persist user feedback for one assistant response."""
    del request

    user_id = _extract_user_id(auth_claims)
    normalized_session_id = _normalize_session_id(payload.session_id, allow_generate=False)

    stored_feedback = _assistant_session_store.record_feedback(
        db,
        privy_user_id=user_id,
        session_id=normalized_session_id,
        assistant_created_at=payload.message_created_at,
        feedback=payload.feedback,
        message_content=payload.message_content,
        note=payload.note,
    )

    return AssistantFeedbackResponse(
        session_id=stored_feedback.session_id,
        message_created_at=stored_feedback.assistant_created_at,
        feedback=stored_feedback.feedback,
        note=stored_feedback.note,
        saved_at=stored_feedback.created_at,
    )

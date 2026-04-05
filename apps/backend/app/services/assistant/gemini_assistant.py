"""Gemini-backed chat assistant utilities."""

from __future__ import annotations

import logging
from pathlib import Path
from threading import Lock

import httpx

from app.core.config import get_settings
from app.services.assistant.session_store import AssistantStoredMessage

logger = logging.getLogger("snowmind")

_REPORT_FILENAME = "report.md"
_RISK_PLAN_FILENAME = "riskscoreplan.md"
_MAX_REPORT_CHARS = 12000
_MAX_PLAN_CHARS = 8000


class AssistantKnowledgeBase:
    """Loads repository risk docs and prepares assistant grounding context."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._cache: dict[str, tuple[Path, int, str]] = {}

    def build_grounding_context(self, dynamic_risk_snapshot_summary: str) -> tuple[str, list[str]]:
        """Return prompt-grounding context and source file names."""
        sources: list[str] = []
        report = self._read_markdown(_REPORT_FILENAME, max_chars=_MAX_REPORT_CHARS)
        if report:
            sources.append(_REPORT_FILENAME)

        risk_plan = self._read_markdown(_RISK_PLAN_FILENAME, max_chars=_MAX_PLAN_CHARS)
        if risk_plan:
            sources.append(_RISK_PLAN_FILENAME)

        context_parts: list[str] = [
            "SnowMind risk-scoring context (authoritative internal docs).",
            "Use this context before answering; do not invent protocol facts.",
            "If data is missing, state uncertainty explicitly.",
            "",
            "Live risk snapshot summary:",
            dynamic_risk_snapshot_summary,
        ]

        if report:
            context_parts.extend(["", "report.md excerpt:", report])

        if risk_plan:
            context_parts.extend(["", "riskscoreplan.md excerpt:", risk_plan])

        return "\n".join(context_parts).strip(), sources

    def _read_markdown(self, filename: str, *, max_chars: int) -> str:
        path = self._locate_file(filename)
        if path is None:
            return ""

        try:
            stat = path.stat()
        except OSError as exc:
            logger.warning("Unable to stat %s: %s", path, exc)
            return ""

        with self._lock:
            cached = self._cache.get(filename)
            if cached and cached[0] == path and cached[1] == stat.st_mtime_ns:
                return cached[2]

        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Unable to read %s: %s", path, exc)
            return ""

        trimmed = text.strip()
        if len(trimmed) > max_chars:
            trimmed = trimmed[:max_chars]

        with self._lock:
            self._cache[filename] = (path, stat.st_mtime_ns, trimmed)

        return trimmed

    @staticmethod
    def _locate_file(filename: str) -> Path | None:
        this_file = Path(__file__).resolve()
        for parent in this_file.parents:
            candidate = parent / filename
            if candidate.is_file():
                return candidate
        return None


class GeminiAssistantClient:
    """Thin Gemini REST client for assistant replies."""

    async def generate_reply(
        self,
        *,
        messages: list[AssistantStoredMessage],
        grounding_context: str,
        feedback_context: str,
    ) -> str:
        settings = get_settings()
        if not settings.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is not configured")

        model = settings.GEMINI_MODEL.strip() or "gemini-flash-latest"
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

        system_instruction = {
            "parts": [
                {
                    "text": (
                        "You are SnowMind Assistant for a production DeFi yield optimizer. "
                        "Provide accurate, grounded answers about SnowMind risk scoring, protocol allocation behavior, "
                        "onboarding, withdrawals, and rebalancing. Prioritize fund safety and correctness. "
                        "Never request private keys, seed phrases, or secrets.\n\n"
                        "Risk categories (use these exact meanings): "
                        "O=Oracle quality, L=Liquidity (withdrawable USDC), C=Collateral quality, "
                        "Y=Yield profile (APY stability), A=Architecture. "
                        "Treat L and Y as dynamic on-chain inputs refreshed daily; do not describe them as static.\n\n"
                        "Formatting contract (always follow):\n"
                        "1) Respond in clean Markdown only.\n"
                        "2) Use a short lead sentence, then structured sections.\n"
                        "3) Use bullet lists for discrete points and recommendations.\n"
                        "4) Use a Markdown table whenever comparing 2+ options across shared fields (risk, APY, liquidity, tradeoffs).\n"
                        "5) Use numbered steps for procedures.\n"
                        "6) If data is missing, state uncertainty explicitly instead of guessing.\n"
                        "7) Keep answers pragmatic: explain reasoning and concrete next actions.\n"
                        "8) For financial/risk guidance, include a short safety caveat when uncertainty is present."
                    )
                }
            ]
        }

        contents: list[dict] = [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "Grounding context is provided below. Use it as the source of truth for risk scoring "
                            "framework and plan details.\n\n"
                            f"{grounding_context}\n\n"
                            "Recent user quality feedback signals (prefer patterns that received thumbs up, avoid repeated patterns that got thumbs down):\n"
                            f"{feedback_context}"
                        )
                    }
                ],
            }
        ]

        for message in messages:
            role = "model" if message.role == "assistant" else "user"
            contents.append(
                {
                    "role": role,
                    "parts": [{"text": message.content}],
                }
            )

        payload = {
            "systemInstruction": system_instruction,
            "contents": contents,
            "generationConfig": {
                "temperature": 0.2,
                "topK": 40,
                "topP": 0.95,
                "maxOutputTokens": 1024,
            },
        }

        timeout = max(5, int(settings.GEMINI_TIMEOUT_SECONDS))
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    endpoint,
                    headers={
                        "Content-Type": "application/json",
                        "X-goog-api-key": settings.GEMINI_API_KEY,
                    },
                    json=payload,
                )
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code if exc.response is not None else "unknown"
            raise RuntimeError(f"Gemini returned HTTP {status_code}") from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Gemini request failed: {exc}") from exc

        text = self._extract_text(body)
        if not text:
            raise RuntimeError("Gemini returned an empty response")
        return text.strip()

    @staticmethod
    def _extract_text(body: object) -> str:
        if not isinstance(body, dict):
            return ""

        candidates = body.get("candidates")
        if not isinstance(candidates, list):
            return ""

        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content")
            if not isinstance(content, dict):
                continue
            parts = content.get("parts")
            if not isinstance(parts, list):
                continue
            text_parts = [
                part.get("text", "")
                for part in parts
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ]
            merged = "\n".join(t for t in text_parts if t.strip()).strip()
            if merged:
                return merged

        return ""

"""Protocol circuit breaker — excludes flaky adapters from the optimizer.

States:
  CLOSED  → healthy, protocol participates in optimization
  OPEN    → 3+ consecutive failures, excluded from optimizer
  HALF_OPEN → auto-reset after cooldown, next call tests the protocol
"""

import logging
import time
from enum import Enum
from datetime import datetime, timezone

from app.core.database import get_supabase

logger = logging.getLogger("snowmind")

FAILURE_THRESHOLD = 3
COOLDOWN_SECONDS = 1800  # 30 min before auto-reset to half-open
_STATE_TABLE = "protocol_circuit_breaker_state"


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class _ProtocolState:
    __slots__ = ("failures", "state", "last_failure_at")

    def __init__(self) -> None:
        self.failures: int = 0
        self.state: CircuitState = CircuitState.CLOSED
        self.last_failure_at: float = 0.0


class ProtocolCircuitBreaker:
    """Per-protocol circuit breaker with automatic half-open recovery."""

    def __init__(
        self,
        failure_threshold: int = FAILURE_THRESHOLD,
        cooldown_seconds: int = COOLDOWN_SECONDS,
    ) -> None:
        self._threshold = failure_threshold
        self._cooldown = cooldown_seconds
        self._states: dict[str, _ProtocolState] = {}
        self._persistence_checked = False
        self._persistence_enabled = False
        self._load_persisted_states()

    def _ensure_persistence(self) -> bool:
        if self._persistence_checked:
            return self._persistence_enabled

        self._persistence_checked = True
        try:
            db = get_supabase()
            db.table(_STATE_TABLE).select("protocol_id").limit(1).execute()
            self._persistence_enabled = True
        except Exception as exc:
            self._persistence_enabled = False
            logger.warning("Circuit-breaker persistence unavailable: %s", exc)

        return self._persistence_enabled

    def _persist_protocol_state(self, protocol_id: str) -> None:
        if not self._ensure_persistence():
            return

        ps = self._get(protocol_id)
        try:
            db = get_supabase()
            payload = {
                "protocol_id": protocol_id,
                "failures": ps.failures,
                "state": ps.state.value,
                "last_failure_at": (
                    datetime.fromtimestamp(ps.last_failure_at, timezone.utc).isoformat()
                    if ps.last_failure_at > 0
                    else None
                ),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            db.table(_STATE_TABLE).upsert(payload, on_conflict="protocol_id").execute()
        except Exception as exc:
            logger.warning("Failed to persist circuit-breaker state for %s: %s", protocol_id, exc)

    def _load_persisted_states(self) -> None:
        if not self._ensure_persistence():
            return

        try:
            db = get_supabase()
            rows = db.table(_STATE_TABLE).select(
                "protocol_id, failures, state, last_failure_at"
            ).execute().data or []

            for row in rows:
                pid = str(row.get("protocol_id") or "").strip()
                if not pid:
                    continue

                ps = self._get(pid)
                ps.failures = int(row.get("failures") or 0)
                state_raw = str(row.get("state") or CircuitState.CLOSED.value)
                if state_raw in {s.value for s in CircuitState}:
                    ps.state = CircuitState(state_raw)
                else:
                    ps.state = CircuitState.CLOSED

                last_failure = row.get("last_failure_at")
                if last_failure:
                    ps.last_failure_at = datetime.fromisoformat(
                        str(last_failure).replace("Z", "+00:00")
                    ).timestamp()
                else:
                    ps.last_failure_at = 0.0

            if rows:
                logger.info("Loaded %d persisted circuit-breaker states", len(rows))
        except Exception as exc:
            logger.warning("Failed to load persisted circuit-breaker states: %s", exc)

    def _get(self, protocol_id: str) -> _ProtocolState:
        if protocol_id not in self._states:
            self._states[protocol_id] = _ProtocolState()
        return self._states[protocol_id]

    def record_success(self, protocol_id: str) -> None:
        """Reset circuit to CLOSED on success."""
        ps = self._get(protocol_id)
        if ps.state != CircuitState.CLOSED:
            logger.info(
                "Circuit CLOSED for %s (was %s)", protocol_id, ps.state.value
            )
        ps.failures = 0
        ps.state = CircuitState.CLOSED
        self._persist_protocol_state(protocol_id)

    def record_failure(self, protocol_id: str) -> None:
        """Increment failure count; trip to OPEN after threshold."""
        ps = self._get(protocol_id)
        ps.failures += 1
        ps.last_failure_at = time.time()

        if ps.failures >= self._threshold and ps.state != CircuitState.OPEN:
            ps.state = CircuitState.OPEN
            logger.error(
                "Circuit OPEN for %s (%d consecutive failures)",
                protocol_id,
                ps.failures,
            )
        self._persist_protocol_state(protocol_id)

    def is_open(self, protocol_id: str) -> bool:
        """True if the protocol should be excluded from the optimizer."""
        ps = self._get(protocol_id)

        if ps.state == CircuitState.CLOSED:
            return False

        if ps.state == CircuitState.OPEN:
            # Check cooldown for automatic half-open transition
            elapsed = time.time() - ps.last_failure_at
            if elapsed >= self._cooldown:
                ps.state = CircuitState.HALF_OPEN
                logger.info(
                    "Circuit HALF_OPEN for %s (cooldown expired)", protocol_id
                )
                self._persist_protocol_state(protocol_id)
                return False  # Allow one test request
            return True

        # HALF_OPEN — allow through (next success/failure decides)
        return False

    def get_state(self, protocol_id: str) -> CircuitState:
        """Return current state (with cooldown check)."""
        self.is_open(protocol_id)  # triggers half-open transition if needed
        return self._get(protocol_id).state

    def get_available_protocols(self) -> list[str]:
        """Return protocol IDs that are not in OPEN state."""
        return [
            pid
            for pid in self._states
            if not self.is_open(pid)
        ]

    def get_all_states(self) -> dict[str, str]:
        """Return {protocol_id: state_string} for monitoring."""
        return {
            pid: self.get_state(pid).value
            for pid in self._states
        }


# Module-level singleton
protocol_circuit_breaker = ProtocolCircuitBreaker()

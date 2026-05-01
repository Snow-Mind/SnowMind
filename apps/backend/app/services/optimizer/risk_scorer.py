"""Risk scoring model for protocol risk assessment.

Framework (max 9 points):
  - Static/manual: oracle (2) + collateral (2) + architecture (1)
  - Dynamic/daily: liquidity (3) + yield profile stability (1)

This score is informational for UI display and user guidance only.
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Iterable

from supabase import Client

from app.services.protocols.base import ProtocolRate

logger = logging.getLogger("snowmind")

_ZERO = Decimal("0")
_ONE = Decimal("1")
_SCORE_MAX = Decimal("9")

_LIQUIDITY_DEEP = Decimal("10000000")
_LIQUIDITY_SUFFICIENT = Decimal("1000000")
_LIQUIDITY_LIMITED = Decimal("500000")
_SPARK_INSTANT_BUFFER_RATIO = Decimal("0.10")
_USDC_SCALE = Decimal("1e6")

_YIELD_STABILITY_RATIO = Decimal("0.30")
_MIN_YIELD_SAMPLE_DAYS = 7
_APY_LOOKBACK_DAYS = 30

# Static manual scores from report.md (max static subtotal = 5).
STATIC_SCORES: dict[str, dict[str, int]] = {
    "aave_v3": {"oracle": 2, "collateral": 1, "architecture": 1},
    "benqi": {"oracle": 2, "collateral": 1, "architecture": 1},
    "spark": {"oracle": 2, "collateral": 2, "architecture": 0},
    "euler_v2": {"oracle": 1, "collateral": 1, "architecture": 0},
    "silo_savusd_usdc": {"oracle": 2, "collateral": 1, "architecture": 1},
    "silo_susdp_usdc": {"oracle": 0, "collateral": 1, "architecture": 1},
}

DEFAULT_STATIC_SCORES: dict[str, int] = {
    "oracle": 1,
    "collateral": 1,
    "architecture": 0,
}


@dataclass(frozen=True)
class RiskBreakdown:
    """Per-category risk scoring breakdown."""

    oracle: int
    liquidity: int
    collateral: int
    yield_profile: int
    architecture: int

    @property
    def total(self) -> Decimal:
        return Decimal(
            self.oracle
            + self.liquidity
            + self.collateral
            + self.yield_profile
            + self.architecture
        )

    def as_dict(self) -> dict[str, int]:
        return {
            "oracle": self.oracle,
            "liquidity": self.liquidity,
            "collateral": self.collateral,
            "yieldProfile": self.yield_profile,
            "architecture": self.architecture,
        }


@dataclass(frozen=True)
class RiskScoreResult:
    """Computed risk score for a protocol at a point in time."""

    protocol_id: str
    score: Decimal
    score_max: Decimal
    breakdown: RiskBreakdown
    available_liquidity_usd: Decimal
    apy_mean: Decimal | None
    apy_stddev: Decimal | None
    sample_days: int
    snapshot_date: date | None = None
    snapshot_created_at: datetime | None = None


class RiskScorer:
    """Compute static + dynamic 9-point protocol risk scores."""

    def compute_risk_score(
        self,
        protocol_id: str,
        utilization_rate: float | Decimal | None = None,
        protocol_apy: Decimal = _ZERO,
        available_liquidity_usd: Decimal | None = None,
        apy_samples_30d: list[Decimal] | None = None,
    ) -> Decimal:
        """Backward-compatible score API used by existing optimizer routes.

        `utilization_rate` and `protocol_apy` are retained to avoid changing call sites.
        The new model uses `available_liquidity_usd` and 30-day APY samples.
        """
        del utilization_rate
        del protocol_apy

        static = self._get_static_scores(protocol_id)
        liquidity_score = (
            self.compute_liquidity_score(available_liquidity_usd)
            if available_liquidity_usd is not None
            else 0
        )
        yield_score, _, _, _ = self.compute_yield_profile_score(apy_samples_30d or [])

        breakdown = RiskBreakdown(
            oracle=static["oracle"],
            liquidity=liquidity_score,
            collateral=static["collateral"],
            yield_profile=yield_score,
            architecture=static["architecture"],
        )
        return max(_ZERO, min(breakdown.total, _SCORE_MAX))

    def compute_liquidity_score(self, available_liquidity_usd: Decimal) -> int:
        """Liquidity score by available withdrawable USDC."""
        liquidity = max(self._to_decimal(available_liquidity_usd) or _ZERO, _ZERO)
        if liquidity > _LIQUIDITY_DEEP:
            return 3
        if liquidity > _LIQUIDITY_SUFFICIENT:
            return 2
        if liquidity > _LIQUIDITY_LIMITED:
            return 1
        return 0

    def compute_yield_profile_score(
        self,
        apy_samples_30d: list[Decimal],
    ) -> tuple[int, Decimal | None, Decimal | None, int]:
        """Yield profile score from 30-day APY standard deviation.

        Returns: (score, mean, stddev, sample_days)
        """
        cleaned: list[Decimal] = []
        for raw in apy_samples_30d:
            value = self._to_decimal(raw)
            if value is None:
                continue
            cleaned.append(value)

        sample_days = len(cleaned)
        if sample_days < _MIN_YIELD_SAMPLE_DAYS:
            return 0, None, None, sample_days

        mean = sum(cleaned, _ZERO) / Decimal(sample_days)
        if mean <= _ZERO:
            return 0, mean, _ZERO, sample_days

        variance = sum(
            ((value - mean) * (value - mean) for value in cleaned),
            _ZERO,
        ) / Decimal(sample_days)
        stddev = variance.sqrt() if variance > _ZERO else _ZERO
        threshold = mean * _YIELD_STABILITY_RATIO
        score = 1 if stddev < threshold else 0
        return score, mean, stddev, sample_days

    async def compute_scores_from_rates(
        self,
        db: Client,
        rates: dict[str, ProtocolRate],
    ) -> dict[str, RiskScoreResult]:
        """Compute full 9-point scores for all provided protocol rates."""
        if not rates:
            return {}

        apy_samples = self.get_recent_apy_samples(db, rates.keys())

        out: dict[str, RiskScoreResult] = {}
        for protocol_id, rate in rates.items():
            available_liquidity = self.derive_available_liquidity(
                protocol_id=protocol_id,
                rate=rate,
            )

            static = self._get_static_scores(protocol_id)
            liquidity_score = self.compute_liquidity_score(available_liquidity)
            yield_score, mean, stddev, sample_days = self.compute_yield_profile_score(
                apy_samples.get(protocol_id, [])
            )

            breakdown = RiskBreakdown(
                oracle=static["oracle"],
                liquidity=liquidity_score,
                collateral=static["collateral"],
                yield_profile=yield_score,
                architecture=static["architecture"],
            )
            score = max(_ZERO, min(breakdown.total, _SCORE_MAX))

            out[protocol_id] = RiskScoreResult(
                protocol_id=protocol_id,
                score=score,
                score_max=_SCORE_MAX,
                breakdown=breakdown,
                available_liquidity_usd=available_liquidity,
                apy_mean=mean,
                apy_stddev=stddev,
                sample_days=sample_days,
            )

        return out

    def derive_available_liquidity(
        self,
        protocol_id: str,
        rate: ProtocolRate,
        spark_psm_liquidity_usd: Decimal = _ZERO,
    ) -> Decimal:
        """Derive available withdrawable liquidity in USDC terms.

        Lending protocols: available = total_supplied - total_borrowed,
        where total_borrowed is derived from utilization when provided.

        Spark: use TVL directly as liquidity proxy for risk scoring.
        """
        del spark_psm_liquidity_usd

        tvl = max(self._to_decimal(rate.tvl_usd) or _ZERO, _ZERO)
        if protocol_id == "spark":
            return tvl

        util = self._to_decimal(rate.utilization_rate)
        if util is None:
            return tvl

        util_clamped = min(max(util, _ZERO), _ONE)
        borrowed = tvl * util_clamped
        return max(tvl - borrowed, _ZERO)

    def get_recent_apy_samples(
        self,
        db: Client,
        protocol_ids: Iterable[str],
        lookback_days: int = _APY_LOOKBACK_DAYS,
    ) -> dict[str, list[Decimal]]:
        """Return recent daily APY samples keyed by protocol id."""
        ids = set(protocol_ids)
        out: dict[str, list[Decimal]] = {protocol_id: [] for protocol_id in ids}
        if not ids:
            return out

        cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).date().isoformat()

        try:
            rows = (
                db.table("daily_apy_snapshots")
                .select("protocol_id, apy, date")
                .gte("date", cutoff)
                .order("date", desc=False)
                .execute()
                .data
            )
        except Exception as exc:
            logger.warning("Failed to load APY snapshots for risk scoring: %s", exc)
            return out

        for row in rows or []:
            protocol_id = str(row.get("protocol_id") or "")
            if protocol_id not in ids:
                continue
            apy = self._to_decimal(row.get("apy"))
            if apy is None:
                continue
            out[protocol_id].append(apy)

        return out

    def get_latest_persisted_scores(self, db: Client) -> dict[str, RiskScoreResult]:
        """Read the latest score row for each protocol from daily_risk_scores."""
        try:
            rows = (
                db.table("daily_risk_scores")
                .select(
                    "protocol_id,date,total_score,oracle_score,liquidity_score,"
                    "collateral_score,yield_profile_score,architecture_score,"
                    "available_liquidity_usd,apy_mean,apy_stddev,sample_days,created_at"
                )
                .order("date", desc=True)
                .order("created_at", desc=True)
                .limit(512)
                .execute()
                .data
            )
        except Exception as exc:
            logger.info("daily_risk_scores unavailable; falling back to on-demand scoring: %s", exc)
            return {}

        latest: dict[str, RiskScoreResult] = {}
        for row in rows or []:
            protocol_id = str(row.get("protocol_id") or "")
            if not protocol_id or protocol_id in latest:
                continue

            breakdown = RiskBreakdown(
                oracle=int(row.get("oracle_score") or 0),
                liquidity=int(row.get("liquidity_score") or 0),
                collateral=int(row.get("collateral_score") or 0),
                yield_profile=int(row.get("yield_profile_score") or 0),
                architecture=int(row.get("architecture_score") or 0),
            )
            latest[protocol_id] = RiskScoreResult(
                protocol_id=protocol_id,
                score=self._to_decimal(row.get("total_score")) or _ZERO,
                score_max=_SCORE_MAX,
                breakdown=breakdown,
                available_liquidity_usd=self._to_decimal(row.get("available_liquidity_usd")) or _ZERO,
                apy_mean=self._to_decimal(row.get("apy_mean")),
                apy_stddev=self._to_decimal(row.get("apy_stddev")),
                sample_days=int(row.get("sample_days") or 0),
                snapshot_date=self._to_date(row.get("date")),
                snapshot_created_at=self._to_datetime(row.get("created_at")),
            )

        return latest

    def is_snapshot_stale(
        self,
        score: RiskScoreResult,
        *,
        max_age_hours: int = 30,
        now: datetime | None = None,
    ) -> bool:
        """Return True when a persisted score snapshot is too old.

        Uses ``snapshot_created_at`` when available, else falls back to midnight
        UTC of ``snapshot_date``. Missing timestamps are treated as stale.
        """
        if max_age_hours <= 0:
            return False

        ref_now = now or datetime.now(timezone.utc)
        snapshot_time: datetime | None = score.snapshot_created_at
        if snapshot_time is None and score.snapshot_date is not None:
            snapshot_time = datetime.combine(
                score.snapshot_date,
                datetime.min.time(),
                tzinfo=timezone.utc,
            )
        if snapshot_time is None:
            return True

        if snapshot_time.tzinfo is None:
            snapshot_time = snapshot_time.replace(tzinfo=timezone.utc)

        age_seconds = (ref_now - snapshot_time).total_seconds()
        return age_seconds > (max_age_hours * 3600)

    def upsert_daily_scores(
        self,
        db: Client,
        scores: dict[str, RiskScoreResult],
        snapshot_date_iso: str,
    ) -> None:
        """Persist risk scores to daily_risk_scores with protocol/date upsert."""
        for protocol_id, result in scores.items():
            try:
                db.table("daily_risk_scores").upsert(
                    {
                        "protocol_id": protocol_id,
                        "date": snapshot_date_iso,
                        "total_score": str(result.score),
                        "oracle_score": result.breakdown.oracle,
                        "liquidity_score": result.breakdown.liquidity,
                        "collateral_score": result.breakdown.collateral,
                        "yield_profile_score": result.breakdown.yield_profile,
                        "architecture_score": result.breakdown.architecture,
                        "available_liquidity_usd": str(result.available_liquidity_usd),
                        "apy_mean": str(result.apy_mean) if result.apy_mean is not None else None,
                        "apy_stddev": str(result.apy_stddev) if result.apy_stddev is not None else None,
                        "sample_days": result.sample_days,
                    },
                    on_conflict="protocol_id,date",
                ).execute()
            except Exception as exc:
                logger.warning("Failed to upsert daily risk score for %s: %s", protocol_id, exc)

    async def _read_spark_psm_liquidity_usd(self) -> Decimal:
        """Read Spark PSM3 USDC liquidity in human USD units.

        Import is intentionally local to avoid import cycles with protocol registry.
        """
        try:
            from app.services.protocols import ALL_ADAPTERS

            spark_adapter = ALL_ADAPTERS.get("spark")
            if spark_adapter is None or not hasattr(spark_adapter, "_get_psm3_contract"):
                return _ZERO

            psm3 = spark_adapter._get_psm3_contract()
            if psm3 is None:
                return _ZERO

            raw_assets = await psm3.functions.totalAssets().call()
            return max(Decimal(str(raw_assets)) / _USDC_SCALE, _ZERO)
        except Exception as exc:
            logger.warning("Failed to read Spark PSM3 liquidity for risk scoring: %s", exc)
            return _ZERO

    def _get_static_scores(self, protocol_id: str) -> dict[str, int]:
        scores = STATIC_SCORES.get(protocol_id)
        if scores is None:
            logger.warning(
                "Unknown protocol_id for static risk scoring: %s; using default fallback",
                protocol_id,
            )
            return dict(DEFAULT_STATIC_SCORES)
        return scores

    @staticmethod
    def _to_decimal(value: object) -> Decimal | None:
        if value is None:
            return None
        if isinstance(value, Decimal):
            return value
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            return None

    @staticmethod
    def _to_date(value: object) -> date | None:
        if value is None:
            return None
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        if isinstance(value, datetime):
            return value.date()
        try:
            return datetime.fromisoformat(str(value)).date()
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _to_datetime(value: object) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except (ValueError, TypeError):
            return None

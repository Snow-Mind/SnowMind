"""
SnowMind Backend Configuration — Single Source of Truth.

All contract addresses, thresholds, and operational parameters live here.
Import `settings` from this module everywhere. Never hardcode addresses inline.
"""

import json
import logging
from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_ORIGINS = "https://app.snowmind.xyz,https://www.snowmind.xyz,https://snowmind.xyz"
_PROD_ORIGIN_REGEX = (
    r"^https://([a-z0-9-]+\.)?snowmind\.xyz$"
    r"|^https://[a-z0-9-]+-snowmind[a-z0-9-]*\.vercel\.app$"
)
_DEV_ORIGIN_REGEX = (
    _PROD_ORIGIN_REGEX
    + r"|^http://localhost(:\d+)?$"
    + r"|^http://127\.0\.0\.1(:\d+)?$"
)

logger = logging.getLogger("snowmind")


class Settings(BaseSettings):
    # ── App ──────────────────────────────────────────────────
    APP_NAME: str = "SnowMind API"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = False
    ALLOWED_ORIGINS: str = _DEFAULT_ORIGINS
    ALLOWED_ORIGIN_REGEX: str = _DEV_ORIGIN_REGEX

    @property
    def allowed_origins(self) -> list[str]:
        """Parse ALLOWED_ORIGINS env var into a list.

        Accepts JSON array, comma-separated string, or empty string.
        Always includes production origins to prevent lockout.
        """
        raw = self.ALLOWED_ORIGINS.strip()
        if not raw:
            origins = _DEFAULT_ORIGINS.split(",")
        elif raw.startswith("["):
            origins = json.loads(raw)
        else:
            origins = [o.strip() for o in raw.split(",") if o.strip()]

        # Always include production origins
        for prod in ["https://app.snowmind.xyz", "https://www.snowmind.xyz", "https://snowmind.xyz"]:
            if prod not in origins:
                origins.append(prod)
        return origins

    @property
    def allowed_origin_regex(self) -> str | None:
        raw = self.ALLOWED_ORIGIN_REGEX.strip()
        if not raw:
            return None
        if self.DEBUG:
            return raw
        if raw == _DEV_ORIGIN_REGEX:
            return _PROD_ORIGIN_REGEX
        return raw

    # ── Supabase ─────────────────────────────────────────────
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""

    # ── Blockchain — RPC (3-tier fallback) ───────────────────
    AVALANCHE_RPC_URL: str = "https://api.avax.network/ext/bc/C/rpc"  # emergency/public fallback
    INFURA_RPC_URL: str = ""  # Primary: "https://avalanche-mainnet.infura.io/v3/<KEY>"
    ALCHEMY_RPC_URL: str = ""  # Fallback: "https://avax-mainnet.g.alchemy.com/v2/<KEY>"
    SNOWTRACE_API_KEY: str = ""  # Optional: explorer API key for transfer-history reconciliation
    SNOWTRACE_API_URL: str = "https://api.snowtrace.io/api"
    AVALANCHE_CHAIN_ID: int = 43114

    # ── Bundler + Smart Account infra ────────────────────────
    PIMLICO_API_KEY: str = ""
    ALCHEMY_AA_API_KEY: str = ""  # Fallback bundler
    ZERODEV_PROJECT_ID: str = ""

    # ── Deployed contracts (Avalanche C-Chain mainnet) ────────
    # Only SnowMindRegistry is deployed by us. All protocol contracts are live.
    REGISTRY_CONTRACT_ADDRESS: str = ""  # Set via env after deployment
    AAVE_V3_POOL: str = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
    BENQI_QIUSDC: str = "0xB715808a78F6041E46d61Cb123C9B4A27056AE9C"
    SPARK_SPUSDC: str = "0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d"
    EULER_VAULT: str = "0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e"
    SILO_SAVUSD_VAULT: str = "0x606fe9a70338e798a292CA22C1F28C829F24048E"  # bUSDC-142 (Silo1 from savUSD/USDC SiloConfig)
    SILO_SUSDP_VAULT: str = "0x8ad697a333569ca6f04c8c063e9807747ef169c1"  # bUSDC-162 (Silo1 from sUSDp/USDC SiloConfig)
    USDC_ADDRESS: str = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"  # Native USDC (6 decimals)
    PERMIT2: str = "0x000000000022D473030F116dDEE9F6B43aC78BA3"  # Uniswap Permit2 (Euler V2 deposits)
    ENTRYPOINT_V07: str = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"

    # ── Spark-specific addresses ─────────────────────────────
    SPARK_PSM3: str = ""  # PSM3 on Avalanche — for totalAssets() liquidity check

    # ── Benqi-specific addresses ─────────────────────────────
    BENQI_COMPTROLLER: str = "0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4"  # Benqi Comptroller on Avalanche

    # ── Auth / Privy ──────────────────────────────────────────
    PRIVY_APP_ID: str = ""       # From privy.io dashboard
    PRIVY_APP_SECRET: str = ""   # For server-side Privy API calls

    # ── Security ─────────────────────────────────────────────
    # KMS key ID for session key encryption (AES-256-GCM envelope encryption).
    # The actual encryption key NEVER lives in env vars — it stays in KMS.
    KMS_KEY_ID: str = ""  # AWS KMS key ID/ARN
    SESSION_KEY_ENCRYPTION_KEY: str = ""  # Local fallback only; production should use KMS_KEY_ID
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    BACKEND_API_KEY: str = ""  # Service-to-service auth key (never expose to frontend)

    # Legacy local deploy key path (not used in production runtime)
    DEPLOYER_PRIVATE_KEY: str = ""

    # ── Execution Service (Node.js) ───────────────────────────
    # Canonical target is the dedicated apps/execution service.
    # Legacy apps/backend/execution_service should be treated as compatibility-only.
    EXECUTION_SERVICE_URL: str = "http://localhost:3001"
    INTERNAL_SERVICE_KEY: str = ""  # Shared secret for backend ↔ executor auth

    # ── Scheduler ────────────────────────────────────────────
    REBALANCE_CHECK_INTERVAL: int = 3600  # 1 hour (seconds)
    # Legacy cooldown knob; accept fractional hours for backward compatibility
    # with existing envs that used 0.1 (6 minutes).
    MIN_REBALANCE_INTERVAL_HOURS: float = 1.0
    SCHEDULER_LOCK_TTL_MINUTES: int = 35  # Lock expires after 35 min

    # ── Optimizer Thresholds ─────────────────────────────────
    # All thresholds from ARCHITECTURE.md — change in ONE place only.
    TVL_CAP_PCT: float = 0.075           # Max 7.5% of Aave/Benqi pool TVL (Spark: no cap)
    BEAT_MARGIN: float = 0.0001          # 0.01% — skip rebalance if improvement below this
    MIN_BALANCE_USD: float = 0.0         # Skip rebalance only when total balance <= $0
    MAX_APY_SANITY_BOUND: float = 0.25   # 25% — reject any APY above this (Aave/Benqi only)
    VELOCITY_THRESHOLD: float = 0.25     # 25% — APY change rate threshold (Aave/Benqi only)
    UTILIZATION_THRESHOLD: float = 0.90  # 90% — exclude from new deposits
    EXPLOIT_APY_MULTIPLIER: float = 2.0  # Deprecated: retained for env compatibility (utilization-only stress trigger is active)
    UTILIZATION_POLL_INTERVAL: int = 30  # seconds between real-time utilization polls
    EMERGENCY_UTILIZATION_THRESHOLD: float = 0.92  # emergency targeted withdrawal threshold
    UTILIZATION_VELOCITY_THRESHOLD: float = 0.10  # 10% jump within a few polls triggers emergency
    UTILIZATION_CONFIRM_COUNT: int = 2  # consecutive successful high reads required
    EMERGENCY_WITHDRAWAL_COOLDOWN: int = 300  # seconds per (account, protocol) trigger cooldown
    STABILITY_SWING_THRESHOLD: float = 0.50  # 50% relative swing in 7 days → skip
    MIN_PROTOCOL_TVL_USD: float = 100000.0   # $100K minimum TVL for Aave/Benqi
    CIRCUIT_BREAKER_THRESHOLD: int = 3   # Consecutive RPC failures before excluding
    CIRCUIT_BREAKER_COOLDOWN_SECONDS: int = 60  # Seconds before half-open retry
    RPC_CONCURRENCY_LIMIT: int = 3       # Max concurrent RPC calls to avoid 429
    GAS_COST_ESTIMATE_USD: float = 0.008  # Realistic Avalanche UserOp gas cost
    PROFITABILITY_BREAKEVEN_DAYS: int = 7  # Rebalance allowed if gas is recouped within N days
    TWAP_SNAPSHOT_COUNT: int = 3         # Number of snapshots for TWAP calculation
    TWAP_WINDOW_MINUTES: int = 15         # Backward-compatible oracle TWAP window
    SPARK_DEPLOYMENT_RATIO: float = 0.90  # Spark deploys only 90% (10% instant-redemption buffer)

    # Backward-compatible allocator knob used by legacy routes.
    # Current architecture is APY-ranked allocation (no fixed base layer).
    BASE_LAYER_PROTOCOL_ID: str = "aave_v3"

    # ── Guarded Launch ─────────────────────────────────────
    MAX_TOTAL_PLATFORM_DEPOSIT_USD: float = 50000.0  # $50K beta cap
    MAX_SINGLE_REBALANCE_USD: float = 25000.0  # Max value movable in one rebalance
    PORTFOLIO_VALUE_DROP_PCT: float = 0.10  # 10% — halt if value drops this much between runs
    RECONCILIATION_ALERT_THRESHOLD_USD: float = 1.0  # $1 discrepancy triggers alert

    # ── Fees ──────────────────────────────────────────────
    AGENT_FEE_ENABLED: bool = False      # Temporary freeze: keep fee code paths but do not charge
    AGENT_FEE_RATE: float = 0.10        # 10% of profit on withdrawal
    PROFIT_FEE_PCT: float = 0.10         # Deprecated alias for legacy paths
    TREASURY_ADDRESS: str = ""           # Gnosis Safe multisig for fee collection

    # ── Cross-validation / Oracle ────────────────────────────
    DEFILLAMA_BASE_URL: str = "https://yields.llama.fi"
    RATE_DIVERGENCE_THRESHOLD: float = 0.02  # 2% — soft warning only (never block)

    # ── Monitoring ───────────────────────────────────────────
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""
    SENTRY_DSN: str = ""
    SENTRY_ENVIRONMENT: str = "production"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.05
    SENTRY_PROFILES_SAMPLE_RATE: float = 0.0
    SENTRY_SEND_PII: bool = False
    PAYMASTER_LOW_BALANCE_AVAX: float = 10.0  # Alert when < 10 AVAX remaining

    # ── API caching (short TTL to reduce RPC fan-out under dashboard polling) ──
    PORTFOLIO_CACHE_TTL_SECONDS: int = 8
    OPTIMIZER_RATES_CACHE_TTL_SECONDS: int = 20
    APY_TIMESERIES_CACHE_TTL_SECONDS: int = 60
    RISK_SCORE_MAX_AGE_HOURS: int = 30

    # ── AI Assistant ────────────────────────────────────────
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-flash-latest"
    GEMINI_TIMEOUT_SECONDS: int = 20
    ASSISTANT_MAX_HISTORY_MESSAGES: int = 20

    @field_validator("REBALANCE_CHECK_INTERVAL", mode="before")
    @classmethod
    def normalize_rebalance_check_interval(cls, value: object) -> object:
        """Treat empty/invalid-like env payloads as default-safe interval.

        Railway/hosted env dashboards sometimes leave variables present but
        blank (``""``). Pydantic then raises int parsing errors at startup.
        For this critical scheduler knob, blank should behave like unset.
        """
        if value is None:
            return 3_600

        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return 3_600

            # Accept integer-looking and float-looking numeric strings.
            try:
                parsed = int(float(stripped))
                return parsed if parsed > 0 else 3_600
            except (TypeError, ValueError):
                return value

        if isinstance(value, (int, float)):
            parsed = int(value)
            return parsed if parsed > 0 else 3_600

        return value

    @model_validator(mode="after")
    def enforce_production_rebalance_interval(self) -> "Settings":
        """Production cadence is fixed to hourly scheduler ticks.

        Deposit tiers are applied per account in scheduler/rebalancer logic.
        Keeping a fixed 1h global tick avoids environment drift where a stale
        REBALANCE_CHECK_INTERVAL blocks higher-frequency tiers.
        """
        if not self.DEBUG and self.REBALANCE_CHECK_INTERVAL != 3_600:
            logger.warning(
                "REBALANCE_CHECK_INTERVAL=%s is not the production standard; forcing 3600 seconds",
                self.REBALANCE_CHECK_INTERVAL,
            )
            self.REBALANCE_CHECK_INTERVAL = 3_600
        return self


    @property
    def pimlico_rpc_url(self) -> str:
        return f"https://api.pimlico.io/v2/avalanche/rpc?apikey={self.PIMLICO_API_KEY}"

    @property
    def alchemy_aa_rpc_url(self) -> str:
        """Alchemy Account Abstraction API — fallback bundler."""
        return f"https://avax-mainnet.g.alchemy.com/v2/{self.ALCHEMY_AA_API_KEY}"

    @property
    def BENQI_POOL(self) -> str:
        """Deprecated alias for BENQI_QIUSDC used by legacy code paths."""
        return self.BENQI_QIUSDC

    @property
    def SPARK_VAULT(self) -> str:
        """Deprecated alias for SPARK_SPUSDC used by legacy code paths."""
        return self.SPARK_SPUSDC

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


# Convenience alias for direct imports
settings = get_settings()

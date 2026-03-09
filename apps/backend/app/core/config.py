from __future__ import annotations

import json
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_ORIGINS = "https://www.snowmind.xyz,http://localhost:3000"


class Settings(BaseSettings):
    # ── App ──────────────────────────────────────────────────
    APP_NAME: str = "SnowMind API"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = False
    ALLOWED_ORIGINS: str = _DEFAULT_ORIGINS

    @property
    def allowed_origins(self) -> list[str]:
        """Parse ALLOWED_ORIGINS env var into a list.

        Accepts JSON array, comma-separated string, or empty string.
        """
        raw = self.ALLOWED_ORIGINS.strip()
        if not raw:
            return _DEFAULT_ORIGINS.split(",")
        if raw.startswith("["):
            return json.loads(raw)
        return [o.strip() for o in raw.split(",") if o.strip()]

    # ── Supabase ─────────────────────────────────────────────
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""

    # ── Blockchain ───────────────────────────────────────────
    AVALANCHE_RPC_URL: str = "https://api.avax-test.network/ext/bc/C/rpc"
    AVALANCHE_CHAIN_ID: int = 43113  # Fuji; override to 43114 for mainnet
    PIMLICO_API_KEY: str = ""
    ZERODEV_PROJECT_ID: str = ""

    # Deployed contracts (Fuji testnet)
    REGISTRY_CONTRACT_ADDRESS: str = "0xf842428ad92689741cafb0029f4d76361b2d02d4"
    AAVE_V3_POOL: str = "0x1775ECC8362dB6CaB0c7A9C0957cF656A5276c29"
    BENQI_POOL: str = "0x6ac240d13b85a698ee407617e51f9baab9e395a9"
    EULER_VAULT: str = "0x372193056e6c57040548ce833ee406509a457632"
    USDC_ADDRESS: str = "0x5425890298aed601595a70AB815c96711a31Bc65"
    ENTRYPOINT_V07: str = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"

    # ── Deployer (testnet Benqi accrual only) ────────────────
    DEPLOYER_PRIVATE_KEY: str = ""  # Testnet deployer for accrueInterest()

    # ── Auth / Privy ──────────────────────────────────────────
    PRIVY_APP_ID: str = ""      # From privy.io dashboard
    PRIVY_APP_SECRET: str = ""  # For server-side Privy API calls

    # ── Security ─────────────────────────────────────────────
    SESSION_KEY_ENCRYPTION_KEY: str = ""  # 32 bytes, hex-encoded
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    BACKEND_API_KEY: str = ""  # Frontend → backend auth (fallback)

    # ── Execution Service (Node.js sidecar) ──────────────────
    EXECUTION_SERVICE_URL: str = "http://localhost:3001"
    INTERNAL_SERVICE_KEY: str = ""  # Shared secret for backend ↔ executor auth

    # ── Optimizer ────────────────────────────────────────────
    REBALANCE_CHECK_INTERVAL: int = 1800  # 30 min
    MAX_PROTOCOL_ALLOCATION: float = 0.60
    MIN_REBALANCE_THRESHOLD: float = 0.05
    MIN_BALANCE_USD: float = 5000.0
    MAX_APY_SANITY_BOUND: float = 0.25  # 25% — reject anything above
    TWAP_WINDOW_MINUTES: int = 15
    MIN_REBALANCE_INTERVAL_HOURS: int = 6

    # ── Cross-validation / Oracle ────────────────────────────
    DEFILLAMA_BASE_URL: str = "https://yields.llama.fi"
    RATE_DIVERGENCE_THRESHOLD: float = 0.02  # 2% — halt if diverges

    # ── Runtime flags ────────────────────────────────────────
    IS_TESTNET: bool = True

    @property
    def pimlico_rpc_url(self) -> str:
        chain = "avalanche-fuji" if self.IS_TESTNET else "avalanche"
        return f"https://api.pimlico.io/v2/{chain}/rpc?apikey={self.PIMLICO_API_KEY}"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


# Convenience alias for direct imports
settings = get_settings()

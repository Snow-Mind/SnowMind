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
    AVALANCHE_RPC_URL: str = "https://api.avax.network/ext/bc/C/rpc"
    AVALANCHE_CHAIN_ID: int = 43114  # Mainnet; override to 43113 for Fuji dev
    PIMLICO_API_KEY: str = ""
    ZERODEV_PROJECT_ID: str = ""

    # Deployed contracts (Avalanche mainnet)
    REGISTRY_CONTRACT_ADDRESS: str = ""  # Redeploy on mainnet → set via env
    AAVE_V3_POOL: str = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
    BENQI_POOL: str = "0xB715808a78F6041E46d61Cb123C9B4A27056AE9C"
    EULER_VAULT: str = "0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e"  # Euler V2 USDC vault on Avalanche
    SPARK_VAULT: str = "0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d"  # Spark spUSDC savings vault on Avalanche
    USDC_ADDRESS: str = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"  # Native USDC
    ENTRYPOINT_V07: str = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"

    # ── Deployer (testnet Benqi accrual only — disabled on mainnet) ─────
    DEPLOYER_PRIVATE_KEY: str = ""

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

    # ── Waterfall Allocator ────────────────────────────────
    TVL_CAP_PCT: float = 0.15              # Max 15% of any protocol's TVL
    MAX_SINGLE_EXPOSURE_PCT: float = 0.40  # Default max per-protocol exposure
    BASE_BEAT_MARGIN: float = 0.005        # 50 bps above base layer to justify move
    GAS_COST_ESTIMATE_USD: float = 0.008   # Realistic Avalanche rebalance gas
    BASE_LAYER_PROTOCOL_ID: str = "aave_v3"  # Safe-harbor protocol (Aave V3 for mainnet)
    MIN_PROTOCOL_TVL_USD: float = 100000.0   # Skip protocols with TVL below $100K

    # ── Guarded Launch ─────────────────────────────────────
    MAX_TOTAL_PLATFORM_DEPOSIT_USD: float = 50000.0  # $50K beta cap

    # ── Fees ──────────────────────────────────────────────
    PROFIT_FEE_PCT: float = 0.10           # 10% of profit on withdrawal
    TREASURY_ADDRESS: str = ""             # SnowMind fee collection address

    # ── Cross-validation / Oracle ────────────────────────────
    DEFILLAMA_BASE_URL: str = "https://yields.llama.fi"
    RATE_DIVERGENCE_THRESHOLD: float = 0.02  # 2% — halt if diverges

    # ── Runtime flags ────────────────────────────────────────
    IS_TESTNET: bool = False

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

"""Fork tests — validate protocol adapters against real Avalanche mainnet contracts.

Run with:
    pytest tests/fork/test_mainnet_adapters.py -v -s

Requires AVALANCHE_RPC_URL env var pointing to a mainnet RPC (or uses public default).
These tests use read-only calls — no transactions, no gas, no private key needed.
"""

import os
import pytest
from decimal import Decimal
from unittest.mock import patch

# Skip entire module if no RPC available
MAINNET_RPC = os.environ.get(
    "AVALANCHE_RPC_URL",
    "https://api.avax.network/ext/bc/C/rpc",
)

# Mainnet addresses
AAVE_V3_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
BENQI_QIUSDCN = "0xB715808a78F6041E46d61Cb123C9B4A27056AE9C"
NATIVE_USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"


@pytest.fixture(autouse=True)
def _mainnet_config():
    """Override settings to point at mainnet for fork tests."""
    with patch.dict(os.environ, {
        "AVALANCHE_RPC_URL": MAINNET_RPC,
        "AVALANCHE_CHAIN_ID": "43114",
        "AAVE_V3_POOL": AAVE_V3_POOL,
        "BENQI_POOL": BENQI_QIUSDCN,
        "USDC_ADDRESS": NATIVE_USDC,
        "IS_TESTNET": "false",
    }):
        # Clear cached settings so new env vars take effect
        from app.core.config import get_settings
        get_settings.cache_clear()
        yield
        get_settings.cache_clear()


# ── Aave V3 Fork Tests ──────────────────────────────────────────────────────

class TestAaveV3Mainnet:
    """Validate the Aave V3 adapter against real mainnet Pool contract."""

    @pytest.mark.asyncio
    async def test_aave_get_rate_returns_valid_apy(self):
        """Aave V3 getReserveData should return a real APY for USDC."""
        from app.services.protocols.aave import AaveV3Adapter

        adapter = AaveV3Adapter()
        rate = await adapter.get_rate()

        print(f"\n  Aave V3 USDC APY: {float(rate.apy) * 100:.4f}%")
        print(f"  Aave V3 USDC TVL: ${float(rate.tvl_usd):,.0f}")

        # APY should be between 0% and 25% (sanity bound)
        assert rate.apy >= Decimal("0"), "APY should not be negative"
        assert rate.apy < Decimal("0.25"), f"APY {rate.apy} exceeds 25% sanity bound"
        assert rate.protocol_id == "aave_v3"
        # TVL should be > $1M (Aave on Avalanche has significant deposits)
        assert rate.tvl_usd > Decimal("1000000"), f"TVL ${rate.tvl_usd} too low — is this really mainnet?"

    @pytest.mark.asyncio
    async def test_aave_adapter_name(self):
        """Check adapter has correct metadata."""
        from app.services.protocols.aave import AaveV3Adapter

        adapter = AaveV3Adapter()
        assert adapter.name == "Aave V3"
        assert adapter.protocol_id == "aave_v3"


# ── Benqi Fork Tests ────────────────────────────────────────────────────────

class TestBenqiMainnet:
    """Validate the Benqi adapter against real mainnet qiUSDCn contract."""

    @pytest.mark.asyncio
    async def test_benqi_get_rate_returns_valid_apy(self):
        """Benqi supplyRatePerTimestamp should return a real APY for USDC."""
        from app.services.protocols.benqi import BenqiAdapter

        adapter = BenqiAdapter()
        rate = await adapter.get_rate()

        print(f"\n  Benqi USDC APY: {float(rate.apy) * 100:.4f}%")
        print(f"  Benqi USDC TVL: ${float(rate.tvl_usd):,.0f}")

        assert rate.apy >= Decimal("0"), "APY should not be negative"
        assert rate.apy < Decimal("0.25"), f"APY {rate.apy} exceeds 25% sanity bound"
        assert rate.protocol_id == "benqi"

    @pytest.mark.asyncio
    async def test_benqi_exchange_rate_is_sane(self):
        """Benqi exchangeRateCurrent should return > 0 (indicates active market)."""
        from app.services.protocols.benqi import BenqiAdapter

        adapter = BenqiAdapter()
        # exchangeRateCurrent is essential for qi → USDC conversion
        exchange_rate = await adapter.pool.functions.exchangeRateCurrent().call()

        print(f"\n  Benqi exchangeRate: {exchange_rate}")
        assert exchange_rate > 0, "Exchange rate should be positive (active market)"


# ── Cross-Adapter Comparison ────────────────────────────────────────────────

class TestCrossProtocol:
    """Compare rates across protocols to sanity-check they're reading real data."""

    @pytest.mark.asyncio
    async def test_all_active_adapters_return_rates(self):
        """Both Aave V3 and Benqi should return valid rates from mainnet."""
        from app.services.optimizer.rate_fetcher import RateFetcher

        fetcher = RateFetcher()
        rates = await fetcher.fetch_active_rates()

        print(f"\n  Active protocols returning rates: {list(rates.keys())}")
        for pid, rate in rates.items():
            print(f"    {pid}: APY={float(rate.apy)*100:.4f}%, TVL=${float(rate.tvl_usd):,.0f}")

        assert "aave_v3" in rates, "Aave V3 adapter failed to return rate"
        assert "benqi" in rates, "Benqi adapter failed to return rate"

        # Both should have positive APYs
        assert rates["aave_v3"].apy > Decimal("0")
        assert rates["benqi"].apy > Decimal("0")

    @pytest.mark.asyncio
    async def test_waterfall_allocator_produces_valid_output(self):
        """Run the waterfall allocator with real mainnet rates."""
        from app.services.optimizer.rate_fetcher import RateFetcher
        from app.services.optimizer.milp_solver import OptimizerInput, ProtocolInput
        from app.services.optimizer.waterfall_allocator import waterfall_allocate

        fetcher = RateFetcher()
        rates = await fetcher.fetch_active_rates()

        protocol_inputs = [
            ProtocolInput(
                protocol_id=pid,
                apy=rate.apy,
                risk_score=Decimal("3.0"),
            )
            for pid, rate in rates.items()
        ]
        tvl_by_protocol = {pid: rate.tvl_usd for pid, rate in rates.items()}

        inp = OptimizerInput(
            total_amount_usd=Decimal("5000"),
            protocols=protocol_inputs,
        )

        result = waterfall_allocate(
            inp=inp,
            tvl_by_protocol=tvl_by_protocol,
        )

        print(f"\n  Waterfall result (status={result.status}):")
        for pid, amt in result.allocations.items():
            print(f"    {pid}: ${float(amt):,.2f}")
        print(f"  Expected APY: {float(result.expected_apy)*100:.4f}%")

        assert result.status == "optimal"
        total_alloc = sum(result.allocations.values())
        assert float(total_alloc) == pytest.approx(5000.0, abs=5.0)
        assert result.expected_apy > Decimal("0")

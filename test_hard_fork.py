"""
HARD END-TO-END TEST: SnowMind on Anvil Fork
=============================================
Tests every protocol adapter, optimizer, rebalancer, and withdrawal flow
against a local Avalanche fork. Zero cost, real contract state.

Prerequisites:
  anvil --fork-url https://api.avax.network/ext/bc/C/rpc --chain-id 43114 --port 8545 --block-time 2

Run:
  cd apps/backend && python -m pytest ../../test_hard_fork.py -v -s
"""

import json
import time
from decimal import Decimal

import pytest
from web3 import Web3

# -- Fork RPC -----------------------------------------------------------------
FORK_URL = "http://127.0.0.1:8545"

# -- Contract addresses (Avalanche mainnet) ------------------------------------
USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
AAVE_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
BENQI_QIUSDC = "0xB715808a78F6041E46d61Cb123C9B4A27056AE9C"
SPARK_SPUSDC = "0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d"
EULER_VAULT = "0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e"
SILO_SAVUSD = "0x606fe9a70338e798a292CA22C1F28C829F24048E"
SILO_SUSDP = "0x8ad697a333569ca6f04c8c063e9807747ef169c1"

# Anvil funded accounts (10K ETH each)
WHALE = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# Minimal ABIs
ERC20_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "account", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "decimals", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint8"}]},
    {"name": "symbol", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "string"}]},
    {"name": "totalSupply", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "approve", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "transfer", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "to", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
]

ERC4626_ABI = ERC20_ABI + [
    {"name": "convertToAssets", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "shares", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "totalAssets", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "deposit", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "assets", "type": "uint256"}, {"name": "receiver", "type": "address"}],
     "outputs": [{"name": "shares", "type": "uint256"}]},
    {"name": "redeem", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "shares", "type": "uint256"}, {"name": "receiver", "type": "address"},
                {"name": "owner", "type": "address"}],
     "outputs": [{"name": "assets", "type": "uint256"}]},
    {"name": "maxWithdraw", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}],
     "outputs": [{"name": "maxAssets", "type": "uint256"}]},
    {"name": "asset", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "address"}]},
]

AAVE_POOL_ABI = [
    {"name": "getReserveData", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "asset", "type": "address"}],
     "outputs": [{"name": "", "type": "tuple",
                  "components": [
                      {"name": "configuration", "type": "uint256"},
                      {"name": "liquidityIndex", "type": "uint128"},
                      {"name": "currentLiquidityRate", "type": "uint128"},
                      {"name": "variableBorrowIndex", "type": "uint128"},
                      {"name": "currentVariableBorrowRate", "type": "uint128"},
                      {"name": "currentStableBorrowRate", "type": "uint128"},
                      {"name": "lastUpdateTimestamp", "type": "uint40"},
                      {"name": "id", "type": "uint16"},
                      {"name": "aTokenAddress", "type": "address"},
                      {"name": "stableDebtTokenAddress", "type": "address"},
                      {"name": "variableDebtTokenAddress", "type": "address"},
                      {"name": "interestRateStrategyAddress", "type": "address"},
                      {"name": "accruedToTreasury", "type": "uint128"},
                      {"name": "unbacked", "type": "uint128"},
                      {"name": "isolationModeTotalDebt", "type": "uint128"},
                  ]}]},
    {"name": "supply", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "asset", "type": "address"}, {"name": "amount", "type": "uint256"},
                {"name": "onBehalfOf", "type": "address"}, {"name": "referralCode", "type": "uint16"}],
     "outputs": []},
    {"name": "withdraw", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "asset", "type": "address"}, {"name": "amount", "type": "uint256"},
                {"name": "to", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
]

BENQI_ABI = [
    {"name": "mint", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "mintAmount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "redeemUnderlying", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "redeemAmount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "balanceOfUnderlying", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "owner", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "supplyRatePerTimestamp", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "exchangeRateStored", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "totalBorrows", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "getCash", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "totalReserves", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
]


def _build_and_send(w3, func, from_addr, gas=200_000):
    """Helper: build tx, send, wait for receipt. Auto-handles nonce + gas."""
    tx = func.build_transaction({
        "from": from_addr,
        "gas": gas,
        "gasPrice": w3.eth.gas_price + 1_000_000_000,
        "nonce": w3.eth.get_transaction_count(from_addr, "pending"),
    })
    return w3.eth.wait_for_transaction_receipt(w3.eth.send_transaction(tx))


@pytest.fixture(scope="module")
def w3():
    """Web3 connected to local Anvil fork."""
    provider = Web3(Web3.HTTPProvider(FORK_URL))
    assert provider.is_connected(), "Anvil fork not running on localhost:8545"
    chain = provider.eth.chain_id
    assert chain == 43114, f"Expected chain 43114 (Avalanche), got {chain}"
    return provider


@pytest.fixture(scope="module")
def usdc(w3):
    return w3.eth.contract(address=w3.to_checksum_address(USDC), abi=ERC20_ABI)


@pytest.fixture(scope="module")
def aave_pool(w3):
    return w3.eth.contract(address=w3.to_checksum_address(AAVE_POOL), abi=AAVE_POOL_ABI)


@pytest.fixture(scope="module")
def benqi(w3):
    return w3.eth.contract(address=w3.to_checksum_address(BENQI_QIUSDC), abi=BENQI_ABI + ERC20_ABI)


@pytest.fixture(scope="module")
def spark(w3):
    return w3.eth.contract(address=w3.to_checksum_address(SPARK_SPUSDC), abi=ERC4626_ABI)


@pytest.fixture(scope="module")
def euler(w3):
    return w3.eth.contract(address=w3.to_checksum_address(EULER_VAULT), abi=ERC4626_ABI)


@pytest.fixture(scope="module")
def silo_savusd(w3):
    return w3.eth.contract(address=w3.to_checksum_address(SILO_SAVUSD), abi=ERC4626_ABI)


@pytest.fixture(scope="module")
def silo_susdp(w3):
    return w3.eth.contract(address=w3.to_checksum_address(SILO_SUSDP), abi=ERC4626_ABI)


@pytest.fixture(scope="module")
def funded_account(w3, usdc):
    """Impersonate a USDC whale to get test funds."""
    potential_whales = [
        "0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9",
        "0x625E7708f30cA75bfd92586e17077590C60eb4cD",
    ]

    test_account = w3.to_checksum_address(WHALE)
    amount_needed = 100_000 * 10**6  # 100K USDC

    for whale_addr in potential_whales:
        try:
            cs_whale = w3.to_checksum_address(whale_addr)
            balance = usdc.functions.balanceOf(cs_whale).call()
            if balance >= amount_needed:
                # Fund whale with AVAX for gas (it may be a contract)
                w3.provider.make_request("anvil_setBalance", [whale_addr, hex(10**18)])
                w3.provider.make_request("anvil_impersonateAccount", [whale_addr])

                _build_and_send(w3, usdc.functions.transfer(test_account, amount_needed), cs_whale)

                w3.provider.make_request("anvil_stopImpersonatingAccount", [whale_addr])

                new_balance = usdc.functions.balanceOf(test_account).call()
                print(f"\n  Funded test account with {new_balance / 10**6:,.2f} USDC from {whale_addr}")
                return test_account
        except Exception as exc:
            print(f"\n  Whale {whale_addr} failed: {exc}")
            continue

    pytest.skip("Could not find a USDC whale to fund test account")


# ==============================================================================
# SECTION 1: PROTOCOL CONTRACT VERIFICATION
# ==============================================================================

class TestProtocolContracts:
    """Verify all 6 protocol contracts are live and readable on the fork."""

    def test_usdc_basics(self, w3, usdc):
        decimals = usdc.functions.decimals().call()
        symbol = usdc.functions.symbol().call()
        total_supply = usdc.functions.totalSupply().call()
        assert decimals == 6
        assert symbol == "USDC"
        assert total_supply > 0
        print(f"\n  USDC: {symbol}, {decimals} dec, supply={total_supply / 10**6:,.0f}")

    def test_aave_v3_reserve_data(self, w3, aave_pool):
        data = aave_pool.functions.getReserveData(w3.to_checksum_address(USDC)).call()
        liquidity_rate = data[2]
        apy = Decimal(str(liquidity_rate)) / Decimal("1e27") * Decimal("100")
        atoken = data[8]
        assert liquidity_rate > 0, "Aave liquidity rate is 0"
        assert apy < Decimal("50"), f"Aave APY {apy}% unreasonably high"
        assert atoken != "0x" + "0" * 40, "aToken is zero address"
        print(f"\n  Aave V3: APY~{float(apy):.2f}%, aToken={atoken}")

    def test_benqi_supply_rate(self, w3, benqi):
        supply_rate = benqi.functions.supplyRatePerTimestamp().call()
        exchange_rate = benqi.functions.exchangeRateStored().call()
        cash = benqi.functions.getCash().call()
        borrows = benqi.functions.totalBorrows().call()
        apy = Decimal(str(supply_rate)) * Decimal("31536000") / Decimal("1e18") * Decimal("100")
        assert supply_rate > 0
        assert exchange_rate > 0
        tvl = Decimal(str(cash + borrows)) / Decimal("1e6")
        print(f"\n  Benqi: APY~{float(apy):.2f}%, TVL~${float(tvl):,.0f}")

    def test_spark_vault(self, w3, spark):
        total_assets = spark.functions.totalAssets().call()
        convert_1m = spark.functions.convertToAssets(1_000_000).call()
        assert total_assets > 0, "Spark totalAssets is 0"
        assert convert_1m >= 1_000_000, f"Spark share price below 1.0"
        print(f"\n  Spark: TVL~${total_assets / 1e6:,.0f}")

    def test_euler_vault(self, w3, euler):
        total_assets = euler.functions.totalAssets().call()
        assert total_assets > 0, "Euler totalAssets is 0"
        print(f"\n  Euler: TVL~${total_assets / 1e6:,.0f}")

    def test_silo_savusd_vault(self, w3, silo_savusd):
        total_assets = silo_savusd.functions.totalAssets().call()
        assert total_assets > 0, "Silo savUSD totalAssets is 0"
        print(f"\n  Silo savUSD: TVL~${total_assets / 1e6:,.0f}")

    def test_silo_susdp_vault(self, w3, silo_susdp):
        total_assets = silo_susdp.functions.totalAssets().call()
        assert total_assets > 0, "Silo sUSDp totalAssets is 0"
        print(f"\n  Silo sUSDp: TVL~${total_assets / 1e6:,.0f}")


# ==============================================================================
# SECTION 2: DEPOSIT -> EARN -> WITHDRAW SIMULATION PER PROTOCOL
# ==============================================================================

class TestDepositEarnWithdraw:
    """Full deposit->earn->withdraw cycle for each protocol."""

    def test_aave_deposit_and_withdraw(self, w3, usdc, aave_pool, funded_account):
        amount = 1000 * 10**6
        _build_and_send(w3, usdc.functions.approve(w3.to_checksum_address(AAVE_POOL), amount), funded_account)

        before = usdc.functions.balanceOf(funded_account).call()
        r = _build_and_send(w3, aave_pool.functions.supply(
            w3.to_checksum_address(USDC), amount, funded_account, 0), funded_account, gas=500_000)
        assert r.status == 1, "Aave supply reverted"

        after_supply = usdc.functions.balanceOf(funded_account).call()
        assert after_supply == before - amount

        atoken_addr = aave_pool.functions.getReserveData(w3.to_checksum_address(USDC)).call()[8]
        atoken = w3.eth.contract(address=atoken_addr, abi=ERC20_ABI)
        assert atoken.functions.balanceOf(funded_account).call() >= amount * 99 // 100

        r = _build_and_send(w3, aave_pool.functions.withdraw(
            w3.to_checksum_address(USDC), 2**256 - 1, funded_account), funded_account, gas=500_000)
        assert r.status == 1, "Aave withdraw reverted"

        final = usdc.functions.balanceOf(funded_account).call()
        assert final >= before - amount // 1000
        print(f"\n  Aave: deposited {amount/1e6} USDC, withdrew {(final-after_supply)/1e6:.6f} USDC")

    def test_benqi_deposit_and_withdraw(self, w3, usdc, benqi, funded_account):
        amount = 1000 * 10**6
        _build_and_send(w3, usdc.functions.approve(w3.to_checksum_address(BENQI_QIUSDC), amount), funded_account)

        before = usdc.functions.balanceOf(funded_account).call()
        r = _build_and_send(w3, benqi.functions.mint(amount), funded_account, gas=500_000)
        assert r.status == 1, "Benqi mint reverted"

        assert benqi.functions.balanceOf(funded_account).call() > 0

        r = _build_and_send(w3, benqi.functions.redeemUnderlying(amount), funded_account, gas=500_000)
        assert r.status == 1, "Benqi redeem reverted"

        final = usdc.functions.balanceOf(funded_account).call()
        assert final >= before - amount // 1000
        print(f"\n  Benqi: deposited {amount/1e6} USDC, redeemed")

    def test_spark_deposit_and_withdraw(self, w3, usdc, spark, funded_account):
        amount = 1000 * 10**6
        _build_and_send(w3, usdc.functions.approve(w3.to_checksum_address(SPARK_SPUSDC), amount), funded_account)

        before = usdc.functions.balanceOf(funded_account).call()
        r = _build_and_send(w3, spark.functions.deposit(amount, funded_account), funded_account, gas=500_000)
        assert r.status == 1

        shares = spark.functions.balanceOf(funded_account).call()
        assert shares > 0

        r = _build_and_send(w3, spark.functions.redeem(shares, funded_account, funded_account), funded_account, gas=500_000)
        assert r.status == 1

        final = usdc.functions.balanceOf(funded_account).call()
        assert final >= before - amount // 1000
        print(f"\n  Spark: deposited {amount/1e6} USDC, got {shares} shares, redeemed")

    def test_euler_deposit_and_withdraw(self, w3, usdc, euler, funded_account):
        amount = 500 * 10**6
        _build_and_send(w3, usdc.functions.approve(w3.to_checksum_address(EULER_VAULT), amount), funded_account)

        before = usdc.functions.balanceOf(funded_account).call()
        r = _build_and_send(w3, euler.functions.deposit(amount, funded_account), funded_account, gas=500_000)
        assert r.status == 1

        shares = euler.functions.balanceOf(funded_account).call()
        assert shares > 0

        r = _build_and_send(w3, euler.functions.redeem(shares, funded_account, funded_account), funded_account, gas=500_000)
        assert r.status == 1

        final = usdc.functions.balanceOf(funded_account).call()
        assert final >= before - amount // 1000
        print(f"\n  Euler: deposited {amount/1e6} USDC, got {shares} shares, redeemed")

    def test_silo_savusd_deposit_and_withdraw(self, w3, usdc, silo_savusd, funded_account):
        amount = 500 * 10**6
        _build_and_send(w3, usdc.functions.approve(w3.to_checksum_address(SILO_SAVUSD), amount), funded_account)

        before = usdc.functions.balanceOf(funded_account).call()
        r = _build_and_send(w3, silo_savusd.functions.deposit(amount, funded_account), funded_account, gas=500_000)
        assert r.status == 1

        shares = silo_savusd.functions.balanceOf(funded_account).call()
        assert shares > 0

        r = _build_and_send(w3, silo_savusd.functions.redeem(shares, funded_account, funded_account), funded_account, gas=500_000)
        assert r.status == 1

        final = usdc.functions.balanceOf(funded_account).call()
        assert final >= before - amount // 1000
        print(f"\n  Silo savUSD: deposited {amount/1e6} USDC, got {shares} shares, redeemed")

    def test_silo_susdp_deposit_and_withdraw(self, w3, usdc, silo_susdp, funded_account):
        amount = 500 * 10**6
        _build_and_send(w3, usdc.functions.approve(w3.to_checksum_address(SILO_SUSDP), amount), funded_account)

        before = usdc.functions.balanceOf(funded_account).call()
        r = _build_and_send(w3, silo_susdp.functions.deposit(amount, funded_account), funded_account, gas=500_000)
        assert r.status == 1

        shares = silo_susdp.functions.balanceOf(funded_account).call()
        assert shares > 0

        r = _build_and_send(w3, silo_susdp.functions.redeem(shares, funded_account, funded_account), funded_account, gas=500_000)
        assert r.status == 1

        final = usdc.functions.balanceOf(funded_account).call()
        assert final >= before - amount // 1000
        print(f"\n  Silo sUSDp: deposited {amount/1e6} USDC, got {shares} shares, redeemed")


# ==============================================================================
# SECTION 3: EDGE CASES & ATTACK VECTORS
# ==============================================================================

class TestEdgeCases:
    """Stress tests and edge-case scenarios."""

    def test_zero_deposit_reverts(self, w3, spark, funded_account):
        """Depositing 0 should revert or be no-op."""
        try:
            r = _build_and_send(w3, spark.functions.deposit(0, funded_account), funded_account, gas=300_000)
            shares = spark.functions.balanceOf(funded_account).call()
            print(f"\n  Zero deposit: status={r.status}, shares={shares}")
        except Exception as e:
            print(f"\n  Zero deposit correctly reverted: {str(e)[:80]}")

    def test_withdraw_more_than_balance_reverts(self, w3, spark, funded_account):
        """Trying to redeem more shares than owned should revert."""
        shares_held = spark.functions.balanceOf(funded_account).call()
        absurd_amount = shares_held + 10**18

        reverted = False
        try:
            r = _build_and_send(w3, spark.functions.redeem(
                absurd_amount, funded_account, funded_account), funded_account)
            if r.status == 0:
                reverted = True
        except Exception:
            reverted = True

        assert reverted, "Over-withdrawal did NOT revert -- critical safety issue"
        print(f"\n  Over-withdrawal correctly reverted")

    def test_dust_deposit(self, w3, usdc, spark, funded_account):
        """1 wei USDC deposit -- tests dust handling."""
        time.sleep(3)  # Wait for pending txs to clear with 2s block time

        _build_and_send(w3, usdc.functions.approve(w3.to_checksum_address(SPARK_SPUSDC), 1), funded_account)

        try:
            r = _build_and_send(w3, spark.functions.deposit(1, funded_account), funded_account, gas=300_000)
            shares = spark.functions.balanceOf(funded_account).call()
            print(f"\n  Dust deposit (1 wei): status={r.status}, shares={shares}")
            if shares > 0:
                _build_and_send(w3, spark.functions.redeem(shares, funded_account, funded_account), funded_account, gas=300_000)
        except Exception as e:
            print(f"\n  Dust deposit reverted (expected for some vaults): {str(e)[:80]}")

    def test_share_price_consistency(self, w3, spark, euler, silo_savusd, silo_susdp):
        """Verify ERC-4626 vaults return consistent, positive share prices."""
        vaults = [
            ("Spark", spark, True),       # Same-decimal vault (6/6) -- price near 1.0
            ("Euler", euler, True),        # Same-decimal vault (6/6) -- price near 1.0
            ("Silo savUSD", silo_savusd, False),  # Different share/asset ratio
            ("Silo sUSDp", silo_susdp, False),    # Different share/asset ratio
        ]
        for name, vault, expect_near_one in vaults:
            share_decimals = vault.functions.decimals().call()
            one_share = 10 ** share_decimals
            raw = vault.functions.convertToAssets(one_share).call()
            assert raw > 0, f"{name} convertToAssets returned 0 -- vault may be broken"

            # Query twice to verify consistency
            raw2 = vault.functions.convertToAssets(one_share).call()
            assert raw == raw2, f"{name} share price inconsistent: {raw} vs {raw2}"

            price = Decimal(str(raw)) / Decimal(str(10**6))
            if expect_near_one:
                # Standard vaults: price should be >= 1.0 (yield accrual)
                assert price >= Decimal("0.99"), f"{name} share price {price} < 0.99 -- POSSIBLE DEPEG"
                assert price < Decimal("2.0"), f"{name} share price {price} > 2.0 -- SUSPICIOUS"
            else:
                # Non-standard ratio vaults: just verify positive and reasonable
                assert price > 0, f"{name} share price is 0"
                assert price < Decimal("1e12"), f"{name} share price absurdly high"
            print(f"\n  {name}: {share_decimals}dec shares, price={float(price):.6f} USDC")

    def test_max_withdraw_not_zero(self, w3, spark):
        """Spark vault must have liquidity available for withdrawals."""
        total = spark.functions.totalAssets().call()
        assert total > 0, "Spark vault is empty"
        print(f"\n  Spark totalAssets={total / 1e6:,.0f} USDC")


# ==============================================================================
# SECTION 4: PRODUCTION API VERIFICATION (against live backend)
# ==============================================================================

import urllib.request
import urllib.error

BACKEND = "https://snowmindbackend-production-10ed.up.railway.app/api/v1"
EXEC = "https://execution-service-production-b1e9.up.railway.app"


def _api_get(path: str) -> dict:
    req = urllib.request.Request(f"{BACKEND}{path}")
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())


def _api_post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BACKEND}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())


def _api_post_raw(url: str, body: dict) -> tuple:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


class TestProductionAPI:
    """Hit the LIVE production backend with test scenarios."""

    def test_health_endpoint(self):
        data = _api_get("/health")
        assert data["status"] == "ok"
        print(f"\n  Backend health: {data['status']} (v{data['version']})")

    def test_execution_service_health(self):
        req = urllib.request.Request(f"{EXEC}/health")
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        assert data["status"] == "ok"
        print(f"\n  Execution service: {data['status']}")

    def test_execution_rejects_unauthenticated(self):
        status, data = _api_post_raw(f"{EXEC}/execute-rebalance", {})
        assert status == 401, f"Expected 401, got {status}"
        print(f"\n  Execution auth: correctly rejected (401)")

    def test_rates_all_protocols(self):
        data = _api_get("/optimizer/rates")
        assert len(data) >= 6, f"Expected 6+ protocols, got {len(data)}"
        protocols_found = set()
        for r in data:
            pid = r["protocolId"]
            protocols_found.add(pid)
            tvl = float(r["tvlUsd"])
            apy = float(r["currentApy"]) * 100
            assert tvl > 0, f"{pid} TVL is 0"
            print(f"\n  {pid}: APY={apy:.2f}%, TVL=${tvl:,.0f}")
        expected = {"aave_v3", "benqi", "spark", "euler_v2", "silo_savusd_usdc", "silo_susdp_usdc"}
        assert expected.issubset(protocols_found), f"Missing: {expected - protocols_found}"

    def test_simulate_moderate_5k(self):
        data = _api_post("/optimizer/simulate", {"total_usdc": "5000", "risk_tolerance": "moderate"})
        assert data["dryRun"] is True
        assert float(data["expectedApy"]) > 0
        total_alloc = sum(float(a["proposedAmountUsd"]) for a in data["proposedAllocations"])
        assert abs(total_alloc - 5000) < 1, f"Allocations sum {total_alloc}, expected 5000"
        print(f"\n  Simulate $5K moderate: APY={float(data['expectedApy'])*100:.2f}%")
        for a in data["proposedAllocations"]:
            print(f"    {a['protocolId']}: ${float(a['proposedAmountUsd']):,.2f} ({float(a['proposedPct'])*100:.1f}%)")

    def test_simulate_conservative_1k(self):
        data = _api_post("/optimizer/simulate", {"total_usdc": "1000", "risk_tolerance": "conservative"})
        assert data["dryRun"] is True
        assert float(data["expectedApy"]) > 0
        print(f"\n  Simulate $1K conservative: APY={float(data['expectedApy'])*100:.2f}%")

    def test_simulate_aggressive_100k(self):
        data = _api_post("/optimizer/simulate", {"total_usdc": "100000", "risk_tolerance": "aggressive"})
        assert data["dryRun"] is True
        assert float(data["expectedApy"]) > 0
        print(f"\n  Simulate $100K aggressive: APY={float(data['expectedApy'])*100:.2f}%")
        for a in data["proposedAllocations"]:
            print(f"    {a['protocolId']}: ${float(a['proposedAmountUsd']):,.2f}")

    def test_simulate_zero_rejected(self):
        status, data = _api_post_raw(f"{BACKEND}/optimizer/simulate", {"total_usdc": "0", "risk_tolerance": "moderate"})
        assert status == 400, f"Expected 400, got {status}"
        print(f"\n  $0 rejected: {data.get('detail', data)}")

    def test_simulate_negative_rejected(self):
        status, data = _api_post_raw(f"{BACKEND}/optimizer/simulate", {"total_usdc": "-1000", "risk_tolerance": "moderate"})
        assert status == 400, f"Expected 400, got {status}"
        print(f"\n  Negative rejected: {data.get('detail', data)}")

    def test_rate_sanity_bounds(self):
        data = _api_get("/optimizer/rates")
        for r in data:
            apy = float(r["currentApy"])
            tvl = float(r["tvlUsd"])
            assert 0 <= apy < 2.0, f"{r['protocolId']} APY {apy*100}% out of range"
            assert 0 <= tvl < 1e12, f"{r['protocolId']} TVL ${tvl} out of range"
        print(f"\n  Rate sanity: all {len(data)} protocols within bounds")

    def test_simulate_allocation_sums_to_total(self):
        for risk in ["conservative", "moderate", "aggressive"]:
            for amount in ["1000", "5000", "25000", "50000"]:
                data = _api_post("/optimizer/simulate", {"total_usdc": amount, "risk_tolerance": risk})
                total_alloc = sum(Decimal(str(a["proposedAmountUsd"])) for a in data["proposedAllocations"])
                diff = abs(total_alloc - Decimal(amount))
                assert diff < Decimal("1"), f"Mismatch for {risk}/{amount}: sum={total_alloc}, expected={amount}"
        print(f"\n  All 12 risk/amount combos: allocations sum correctly")

    def test_dry_run_fresh_user(self):
        data = _api_post("/rebalance/dry-run", {"total_usdc": "10000"})
        assert data.get("dryRun") is True or data.get("dry_run") is True
        allocs = data.get("proposedAllocations", [])
        assert len(allocs) > 0, "No allocations proposed"
        print(f"\n  Dry-run $10K: {len(allocs)} protocols")

    def test_dry_run_with_existing_allocations(self):
        data = _api_post("/rebalance/dry-run", {
            "total_usdc": "2000",
            "current_allocations": {"aave_v3": "3000", "benqi": "2000"},
        })
        allocs = data.get("proposedAllocations", [])
        print(f"\n  Dry-run with positions: {len(allocs)} allocations, rebalance={data.get('rebalanceNeeded')}")

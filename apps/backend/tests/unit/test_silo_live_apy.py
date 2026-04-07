from decimal import Decimal
import pytest

from app.services.protocols.silo import SiloAdapter, _compute_silo_depositor_apr


def test_compute_silo_depositor_apr_matches_expected_formula() -> None:
    borrow_apr = Decimal("0.080005640948352")
    utilization = Decimal("0.8178354410868430417071991480")
    dao_fee_wad = Decimal("100000000000000000")  # 10%
    deployer_fee_wad = Decimal("0")

    apr = _compute_silo_depositor_apr(
        borrow_apr=borrow_apr,
        utilization=utilization,
        dao_fee_wad=dao_fee_wad,
        deployer_fee_wad=deployer_fee_wad,
    )

    # Expected from live Silo market arithmetic (~5.8888%).
    assert apr.quantize(Decimal("0.000000000000001")) == Decimal("0.058888303788988")


def test_compute_silo_depositor_apr_clamps_invalid_inputs() -> None:
    apr = _compute_silo_depositor_apr(
        borrow_apr=Decimal("0.10"),
        utilization=Decimal("1.5"),
        dao_fee_wad=Decimal("900000000000000000"),
        deployer_fee_wad=Decimal("900000000000000000"),
    )

    # Utilization clamps to 1 and total fees clamp to 100%, so depositor APR is 0.
    assert apr == Decimal("0")


class _FakeAsyncCall:
    def __init__(self, value):
        self._value = value

    async def call(self):
        return self._value


class _FakeVaultFunctions:
    def utilizationData(self):
        # collateral=200, debt=100 -> utilization=0.5, timestamp=1712345678
        return _FakeAsyncCall((200, 100, 1712345678))

    def siloConfig(self):
        return _FakeAsyncCall("0xconfig")


class _FakeVault:
    functions = _FakeVaultFunctions()


class _FakeConfigFunctions:
    def getConfig(self, _vault_address):
        # daoFee, deployerFee, ..., interestRateModel (index 9)
        return _FakeAsyncCall((0, 0, None, None, None, None, None, None, None, "0xirm"))


class _FakeConfigContract:
    functions = _FakeConfigFunctions()


class _FakeIRMFunctions:
    def __init__(self, captured: dict[str, int]):
        self._captured = captured

    def getCurrentInterestRate(self, _vault_address, block_timestamp):
        self._captured["block_timestamp"] = int(block_timestamp)
        # 5% borrow APR in WAD
        return _FakeAsyncCall(50000000000000000)


class _FakeIRMContract:
    def __init__(self, captured: dict[str, int]):
        self.functions = _FakeIRMFunctions(captured)


class _FakeEth:
    def __init__(self, captured: dict[str, int]):
        self._captured = captured

    def contract(self, address, abi):
        del address
        names = {item.get("name") for item in abi if isinstance(item, dict)}
        if "getConfig" in names:
            return _FakeConfigContract()
        if "getCurrentInterestRate" in names:
            return _FakeIRMContract(self._captured)
        raise AssertionError("Unexpected contract ABI requested")


class _FakeWeb3:
    def __init__(self, captured: dict[str, int]):
        self.eth = _FakeEth(captured)

    def to_checksum_address(self, value):
        return value


@pytest.mark.asyncio
async def test_silo_live_apr_uses_onchain_timestamp_without_get_block() -> None:
    captured: dict[str, int] = {}
    adapter = SiloAdapter(vault_address="0xvault")
    adapter.protocol_id = "silo_test"
    adapter._get_w3 = lambda: _FakeWeb3(captured)  # type: ignore[method-assign]

    apr, utilization = await adapter._read_live_depositor_apr(_FakeVault())

    assert captured["block_timestamp"] == 1712345678
    assert utilization == Decimal("0.5")
    assert apr == Decimal("0.025")

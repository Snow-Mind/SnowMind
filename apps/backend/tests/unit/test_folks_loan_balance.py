import pytest

from app.services.protocols.folks import FolksAdapter


class _CallResult:
    def __init__(self, value=None, exc: Exception | None = None) -> None:
        self._value = value
        self._exc = exc

    async def call(self):
        if self._exc is not None:
            raise self._exc
        return self._value


class _FakeHubPool:
    def __init__(self, wallet_shares: int, total_supply: int, total_amount: int) -> None:
        self._wallet_shares = wallet_shares
        self._total_supply = total_supply
        self._total_amount = total_amount
        self.functions = self

    def balanceOf(self, _account: str):
        return _CallResult(self._wallet_shares)

    def totalSupply(self):
        return _CallResult(self._total_supply)

    def getDepositData(self):
        return _CallResult((0, self._total_amount, 0, 0))


class _FakeLoanManager:
    def __init__(self, active_loans: set[str], loan_data: dict[str, tuple]) -> None:
        self._active_loans = active_loans
        self._loan_data = loan_data
        self.functions = self

    def isUserLoanActive(self, loan_id: str):
        return _CallResult(loan_id in self._active_loans)

    def getUserLoan(self, loan_id: str):
        if loan_id not in self._loan_data:
            return _CallResult(exc=RuntimeError("unknown loan"))
        return _CallResult(self._loan_data[loan_id])


class _FakeAccountManager:
    def __init__(self, created_accounts: set[str], lookup_account_id: str | None = None) -> None:
        self._created_accounts = created_accounts
        self._lookup_account_id = lookup_account_id
        self.functions = self

    def isAccountCreated(self, account_id: str):
        return _CallResult(account_id in self._created_accounts)

    def getAccountIdOfAddressOnChain(self, _addr: bytes, _chain_id: int):
        if self._lookup_account_id is None:
            return _CallResult(exc=RuntimeError("not registered"))
        return _CallResult(self._lookup_account_id)


class _FakeW3:
    @staticmethod
    def to_checksum_address(address: str) -> str:
        return address

    @staticmethod
    def to_hex(value):
        if isinstance(value, str):
            return value
        if isinstance(value, (bytes, bytearray)):
            return "0x" + bytes(value).hex()
        raise TypeError("unsupported value")


@pytest.mark.asyncio
async def test_folks_prefers_active_loan_collateral_over_wallet_shares(monkeypatch) -> None:
    adapter = FolksAdapter()
    adapter.account_nonce_scan_max = 1
    adapter.loan_nonce_scan_max = 1

    fake_hub = _FakeHubPool(wallet_shares=0, total_supply=2_000_000, total_amount=3_000_000)
    fake_account_manager = _FakeAccountManager(created_accounts={"acc-1-canonical"})
    fake_loan_manager = _FakeLoanManager(
        active_loans={"loan-acc-1-canonical-1"},
        loan_data={
            "loan-acc-1-canonical-1": (
                "acc-1-canonical",
                2,
                [1],
                [],
                [(750_000, 0)],
                [],
            )
        },
    )

    monkeypatch.setattr(adapter, "_get_w3", lambda: _FakeW3())
    monkeypatch.setattr(adapter, "_get_hub_pool", lambda: fake_hub)
    monkeypatch.setattr(adapter, "_get_account_manager", lambda: fake_account_manager)
    monkeypatch.setattr(adapter, "_get_loan_manager", lambda: fake_loan_manager)
    monkeypatch.setattr(
        adapter,
        "_build_account_id",
        lambda _user, nonce, legacy: f"acc-{nonce}-{'legacy' if legacy else 'canonical'}",
    )
    monkeypatch.setattr(adapter, "_build_loan_id", lambda account_id, nonce: f"loan-{account_id}-{nonce}")

    shares = await adapter.get_shares("0xabc")
    balance = await adapter.get_balance("0xabc")

    assert shares == 750_000
    assert balance == 1_125_000


@pytest.mark.asyncio
async def test_folks_falls_back_to_wallet_shares_when_no_active_loan(monkeypatch) -> None:
    adapter = FolksAdapter()
    adapter.account_nonce_scan_max = 0
    adapter.loan_nonce_scan_max = 0

    fake_hub = _FakeHubPool(wallet_shares=400_000, total_supply=2_000_000, total_amount=2_500_000)
    fake_account_manager = _FakeAccountManager(created_accounts=set())
    fake_loan_manager = _FakeLoanManager(active_loans=set(), loan_data={})

    monkeypatch.setattr(adapter, "_get_w3", lambda: _FakeW3())
    monkeypatch.setattr(adapter, "_get_hub_pool", lambda: fake_hub)
    monkeypatch.setattr(adapter, "_get_account_manager", lambda: fake_account_manager)
    monkeypatch.setattr(adapter, "_get_loan_manager", lambda: fake_loan_manager)
    monkeypatch.setattr(
        adapter,
        "_build_account_id",
        lambda _user, nonce, legacy: f"acc-{nonce}-{'legacy' if legacy else 'canonical'}",
    )
    monkeypatch.setattr(adapter, "_build_loan_id", lambda account_id, nonce: f"loan-{account_id}-{nonce}")

    shares = await adapter.get_shares("0xabc")
    balance = await adapter.get_balance("0xabc")

    assert shares == 400_000
    assert balance == 500_000

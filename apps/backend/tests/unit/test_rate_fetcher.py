"""Unit tests for the rate fetcher."""

from decimal import Decimal
from types import SimpleNamespace

from app.services.optimizer import rate_fetcher as rate_fetcher_module

from app.services.optimizer.rate_fetcher import RateFetcher
from app.services.protocols.base import ProtocolRate


def _build_rate(*, apy: Decimal, effective_apy: Decimal | None = None, tvl_usd: Decimal = Decimal("1000000")) -> ProtocolRate:
    return ProtocolRate(
        protocol_id="test_protocol",
        apy=apy,
        effective_apy=effective_apy if effective_apy is not None else apy,
        tvl_usd=tvl_usd,
    )


def test_validate_rate_accepts_finite_reasonable_values() -> None:
    rate = _build_rate(apy=Decimal("0.052"), effective_apy=Decimal("0.051"))
    assert RateFetcher.validate_rate(rate) is True


def test_validate_rate_rejects_non_finite_values() -> None:
    inf_apy = _build_rate(apy=Decimal("Infinity"), effective_apy=Decimal("Infinity"))
    nan_tvl = _build_rate(apy=Decimal("0.05"), effective_apy=Decimal("0.05"), tvl_usd=Decimal("NaN"))

    assert RateFetcher.validate_rate(inf_apy) is False
    assert RateFetcher.validate_rate(nan_tvl) is False


def test_validate_rate_rejects_out_of_bounds_values() -> None:
    excessive_apy = _build_rate(apy=Decimal("2.5"), effective_apy=Decimal("2.5"))
    negative_effective = _build_rate(apy=Decimal("0.05"), effective_apy=Decimal("-0.01"))

    assert RateFetcher.validate_rate(excessive_apy) is False
    assert RateFetcher.validate_rate(negative_effective) is False


class _FakeQuery:
    def __init__(self, rows_by_protocol: dict[str, list[dict]], failing_protocols: set[str], counter: dict[str, int]):
        self._rows_by_protocol = rows_by_protocol
        self._failing_protocols = failing_protocols
        self._counter = counter
        self._protocol_id: str | None = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key: str, value: str):
        if key == "protocol_id":
            self._protocol_id = value
        return self

    def gte(self, *_args, **_kwargs):
        return self

    def lte(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        self._counter["execute_calls"] += 1
        pid = self._protocol_id or ""
        if pid in self._failing_protocols:
            raise RuntimeError("simulated db decode failure")
        return SimpleNamespace(data=self._rows_by_protocol.get(pid, []))


class _FakeDB:
    def __init__(self, rows_by_protocol: dict[str, list[dict]], failing_protocols: set[str], counter: dict[str, int]):
        self._rows_by_protocol = rows_by_protocol
        self._failing_protocols = failing_protocols
        self._counter = counter

    def table(self, _name: str):
        return _FakeQuery(self._rows_by_protocol, self._failing_protocols, self._counter)


def test_twap_buffer_load_from_db_skips_invalid_rows_and_marks_loaded(monkeypatch) -> None:
    counter = {"execute_calls": 0}
    rows = {
        "good_proto": [
            {
                "protocol_id": "good_proto",
                "apy": "0.05",
                "effective_apy": "0.05",
                "tvl_usd": "1000000",
                "utilization_rate": "0.7",
                "fetched_at": 1710000000.0,
            },
            {
                "protocol_id": "good_proto",
                "apy": "NaN",
                "effective_apy": "0.05",
                "tvl_usd": "1000000",
                "utilization_rate": None,
                "fetched_at": 1710000001.0,
            },
        ],
    }
    fake_db = _FakeDB(rows_by_protocol=rows, failing_protocols={"broken_proto"}, counter=counter)

    monkeypatch.setattr(rate_fetcher_module, "get_supabase", lambda: fake_db)
    monkeypatch.setattr(
        rate_fetcher_module,
        "ALL_ADAPTERS",
        {"good_proto": object(), "broken_proto": object()},
    )

    buffer = rate_fetcher_module.TWAPBuffer(max_snapshots=3)
    buffer.load_from_db()

    # Broken protocol query should not block successful restore of valid rows.
    assert buffer.sample_count("good_proto") == 1
    assert buffer.get_latest("good_proto") is not None

    # Loader should mark itself complete to prevent per-request reload loops.
    assert buffer._loaded_from_db is True

    execute_calls_after_first_load = counter["execute_calls"]
    buffer.load_from_db()
    assert counter["execute_calls"] == execute_calls_after_first_load

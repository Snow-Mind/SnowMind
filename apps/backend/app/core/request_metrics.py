"""In-memory request telemetry for dashboard load diagnostics.

This module captures a bounded, short-retention sample stream for key
dashboard endpoints and exposes summarized stats (rate, latency, status mix)
for a specific smart account plus global dashboard dependencies.

Notes:
- Process-local only (sufficient for ad-hoc incident diagnostics).
- Bounded memory via per-bucket maxlen + retention pruning.
"""

from __future__ import annotations

import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock

_GLOBAL_SCOPE = "__global__"
_RETENTION_SECONDS = 2 * 60 * 60  # 2 hours
_MAX_SAMPLES_PER_BUCKET = 5000


@dataclass(slots=True)
class _Sample:
    ts: float
    latency_ms: float
    status: int
    method: str


_BUCKETS: dict[tuple[str, str], deque[_Sample]] = defaultdict(
    lambda: deque(maxlen=_MAX_SAMPLES_PER_BUCKET)
)
_LOCK = Lock()

_ACCOUNT_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"^/api/v1/portfolio/(?P<address>0x[a-fA-F0-9]{40})$"),
        "portfolio",
    ),
    (
        re.compile(r"^/api/v1/accounts/(?P<address>0x[a-fA-F0-9]{40})$"),
        "account_detail",
    ),
    (
        re.compile(r"^/api/v1/rebalance/(?P<address>0x[a-fA-F0-9]{40})/status$"),
        "rebalance_status",
    ),
    (
        re.compile(r"^/api/v1/rebalance/(?P<address>0x[a-fA-F0-9]{40})/history$"),
        "rebalance_history",
    ),
)

_GLOBAL_PATHS: dict[str, str] = {
    "/api/v1/optimizer/rates": "optimizer_rates",
    "/api/v1/optimizer/rates/timeseries": "optimizer_rates_timeseries",
}


def _normalize_path(path: str) -> str:
    if path != "/" and path.endswith("/"):
        return path[:-1]
    return path


def _classify(path: str) -> list[tuple[str, str]]:
    normalized = _normalize_path(path)
    endpoint = _GLOBAL_PATHS.get(normalized)
    if endpoint:
        return [(_GLOBAL_SCOPE, endpoint)]

    for regex, endpoint_name in _ACCOUNT_PATTERNS:
        match = regex.match(normalized)
        if match:
            address = match.group("address").lower()
            return [(address, endpoint_name)]

    return []


def _prune_locked(now_ts: float) -> None:
    cutoff = now_ts - _RETENTION_SECONDS
    empty_keys: list[tuple[str, str]] = []

    for key, bucket in _BUCKETS.items():
        while bucket and bucket[0].ts < cutoff:
            bucket.popleft()
        if not bucket:
            empty_keys.append(key)

    for key in empty_keys:
        _BUCKETS.pop(key, None)


def record_dashboard_request(
    *,
    method: str,
    path: str,
    status: int,
    latency_ms: float,
    now_ts: float | None = None,
) -> None:
    """Record a dashboard-related request sample if path is tracked."""
    targets = _classify(path)
    if not targets:
        return

    sample = _Sample(
        ts=now_ts if now_ts is not None else time.time(),
        latency_ms=max(0.0, float(latency_ms)),
        status=int(status),
        method=str(method).upper(),
    )

    with _LOCK:
        _prune_locked(sample.ts)
        for scope, endpoint in targets:
            _BUCKETS[(scope, endpoint)].append(sample)


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None

    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return float(sorted_values[0])

    rank = (percentile / 100.0) * (len(sorted_values) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(sorted_values) - 1)
    weight = rank - lower
    interpolated = sorted_values[lower] * (1.0 - weight) + sorted_values[upper] * weight
    return float(interpolated)


def _summarize(samples: list[_Sample], window_seconds: int, now_ts: float) -> dict:
    cutoff = now_ts - window_seconds
    filtered = [s for s in samples if s.ts >= cutoff]
    total = len(filtered)

    if total == 0:
        return {
            "totalRequests": 0,
            "requestsPerMinute": 0.0,
            "avgLatencyMs": None,
            "p50LatencyMs": None,
            "p95LatencyMs": None,
            "statusCounts": {"2xx": 0, "4xx": 0, "5xx": 0, "other": 0},
            "methodCounts": {},
        }

    latencies = [s.latency_ms for s in filtered]
    method_counts: dict[str, int] = {}
    status_counts = {"2xx": 0, "4xx": 0, "5xx": 0, "other": 0}

    for sample in filtered:
        method_counts[sample.method] = method_counts.get(sample.method, 0) + 1
        if 200 <= sample.status < 300:
            status_counts["2xx"] += 1
        elif 400 <= sample.status < 500:
            status_counts["4xx"] += 1
        elif 500 <= sample.status < 600:
            status_counts["5xx"] += 1
        else:
            status_counts["other"] += 1

    rpm = total / (window_seconds / 60.0)
    avg_latency = sum(latencies) / total

    return {
        "totalRequests": total,
        "requestsPerMinute": round(rpm, 3),
        "avgLatencyMs": round(avg_latency, 3),
        "p50LatencyMs": round(_percentile(latencies, 50.0) or 0.0, 3),
        "p95LatencyMs": round(_percentile(latencies, 95.0) or 0.0, 3),
        "statusCounts": status_counts,
        "methodCounts": method_counts,
    }


def get_dashboard_load_snapshot(address: str, *, window_seconds: int = 15 * 60) -> dict:
    """Return dashboard request diagnostics for one smart-account address."""
    normalized_address = str(address).lower()
    effective_window = max(60, int(window_seconds))
    now_ts = time.time()

    with _LOCK:
        _prune_locked(now_ts)

        account_endpoint_samples: dict[str, list[_Sample]] = {}
        global_endpoint_samples: dict[str, list[_Sample]] = {}
        account_all: list[_Sample] = []
        global_all: list[_Sample] = []

        for (scope, endpoint), bucket in _BUCKETS.items():
            bucket_list = list(bucket)
            if scope == normalized_address:
                account_endpoint_samples[endpoint] = bucket_list
                account_all.extend(bucket_list)
            elif scope == _GLOBAL_SCOPE:
                global_endpoint_samples[endpoint] = bucket_list
                global_all.extend(bucket_list)

    account_endpoints = {
        endpoint: _summarize(samples, effective_window, now_ts)
        for endpoint, samples in sorted(account_endpoint_samples.items())
    }
    global_endpoints = {
        endpoint: _summarize(samples, effective_window, now_ts)
        for endpoint, samples in sorted(global_endpoint_samples.items())
    }

    return {
        "windowSeconds": effective_window,
        "retentionSeconds": _RETENTION_SECONDS,
        "accountScope": {
            "summary": _summarize(account_all, effective_window, now_ts),
            "endpoints": account_endpoints,
        },
        "globalScope": {
            "summary": _summarize(global_all, effective_window, now_ts),
            "endpoints": global_endpoints,
        },
    }

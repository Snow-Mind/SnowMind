# SnowMind Security Audit — Executive Summary

**Date:** 2026-04-14 · **Branch:** `dev` · **Auditor:** Claude Opus 4.6
**Scope:** first-party code (contracts, backend, execution service, frontend)
**Detail:** [FULL_REPORT.md](FULL_REPORT.md)

---

## TL;DR

- **13 new findings.** 0 critical · 2 high · 3 medium · 5 low · 3 informational.
- **`N-12` should block the next release.** A stolen Privy JWT alone can drain any SnowMind account through a legacy endpoint that skips the wallet-signature gate. Fix is a one-line delete.
- **Smart-contract invariants: 7/7 PASS.** Foundry `StdInvariant` suite — 256 runs × 500 calls per invariant = 128 000 fuzzed calls each, 0 reverts. Suite in [`invariants/`](invariants/).
- **No application code was modified** by this audit. Reports only.

---

## Fix today — blocks ship

| ID | Sev | Title | Effort | Where |
|---|---|---|---|---|
| **N-12** | **HIGH** | `/api/v1/rebalance/{address}/withdraw-all` drains the account with only a Privy JWT. The modern `/withdrawals/execute` correctly requires a fresh wallet `ownerSignature`; this legacy route skips that check entirely. | 1 hour (delete route + frontend helper) | [`apps/backend/app/api/routes/rebalance.py:496`](../apps/backend/app/api/routes/rebalance.py), [`apps/web/lib/api-client.ts:361`](../apps/web/lib/api-client.ts) |

**Why it's a blocker.** Both the modern and legacy withdrawal paths end up calling `execute_emergency_withdrawal`, which builds a `user_transfer` to the owner EOA and signs it with the server-stored session key. The ZeroDev CallPolicy permits `USDC.transfer` to `ONE_OF([treasury, userEOA])`, so the UserOp lands on-chain. The difference: `/withdrawals/execute` requires an `ownerSignature` that only a user touching their wallet can produce, while `/rebalance/{address}/withdraw-all` accepts the Privy JWT alone. A stolen JWT (XSS, session theft, device compromise) is therefore sufficient to drain every protocol position.

**Recommended fix.** Delete the endpoint. Nothing in the production UI needs it — the withdraw page already routes through the signature-gated path. Full exploit sketch + two alternative fixes in [FULL_REPORT.md §3 "N-12"](FULL_REPORT.md).

---

## Fix this week

| ID | Sev | Title | Effort |
|---|---|---|---|
| N-01 | HIGH | Session-key expiry hardcoded to year 2100. Add `toTimestampPolicy({ validUntil: 30d })` to the permissions array and force rotation. | 1 day |
| N-03 | MED | Execution-service timestamp check uses `Math.abs` — accepts timestamps up to TTL seconds in the future. Replace with a two-sided check. | 15 min |
| N-04 | MED | Duplicate execution-service code tree at `apps/backend/execution_service/` parallels `apps/execution/`. Security fixes can diverge between the two copies. Delete the legacy one. | 1 hour |
| N-06 | LOW | Per-sender executor lock TTL (90s) is shorter than the backend→executor HTTP timeout (120s). Enables the N-02 race. Raise to 130s. | 15 min |

---

## Structural — schedule for the quarter

| ID | Sev | Title |
|---|---|---|
| N-02 | MED | Concurrent-withdrawal race between the backend's DB lock check and the on-chain fee-accounting update. Fix by inserting a `pending` row BEFORE calling the executor, with a partial unique index on `(account_id, status='pending')`. |

---

## Hygiene — no rush

| ID | Sev | Title |
|---|---|---|
| N-05 | LOW | Nonce length not validated on the execution service — any non-empty string is accepted. |
| N-08 | LOW | DEBUG-mode AES derivation from `SUPABASE_SERVICE_KEY` still present. Staging/dev envs with `DEBUG=true` derive session-key encryption keys from the Supabase service key. |
| N-09 | LOW | Two-phase `store_session_key` (deactivate then insert) is not transactional — concurrent calls can leave multiple active rows. |
| N-13 | LOW | Legacy `record_withdrawal_fee` hardcodes `fee_exempt=False`. If fees are re-enabled, the emergency-withdrawal path would mischarge fee-exempt accounts. |
| N-07 | INFO | Withdrawal payload passes empty `TREASURY` when fees are disabled. Currently `agent_fee_raw = 0` so no funds move, but the payload is brittle. |
| N-10 | INFO | Per-sender execution lock is process-local. Horizontal scale-out of the execution service would silently reintroduce the concurrent-UserOp bug. |
| N-11 | INFO | In-memory sliding-window rate limiter is process-local. Code comment acknowledges this. |

---

## New findings — full table

| ID | Sev | Title |
|---|---|---|
| **N-12** | **HIGH** | Withdraw-all endpoint bypasses wallet signature |
| N-01 | HIGH | Session-key expiry hardcoded year 2100 |
| N-02 | MED | Concurrent-withdrawal race between lock check and fee accounting |
| N-03 | MED | Execution-service `Math.abs` timestamp skew accepts future timestamps |
| N-04 | MED | Duplicate execution-service code tree |
| N-05 | LOW | Nonce length not validated on executor |
| N-06 | LOW | Per-sender lock TTL shorter than HTTP timeout |
| N-08 | LOW | DEBUG-mode AES derivation from Supabase key |
| N-09 | LOW | Session-key store/revoke two-phase race |
| N-13 | LOW | `record_withdrawal_fee` hardcodes `fee_exempt=False` |
| N-07 | INFO | Withdrawal executor passes empty `TREASURY` when fees disabled |
| N-10 | INFO | Per-sender execution lock is process-local |
| N-11 | INFO | Rate limiter is process-local |

---

## Residual-risk posture

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 5 |
| Informational | 3 |
| **Total** | **13** |

**Single biggest risk today:** `N-12` — a one-hour delete closes it.

---

## What's in this folder

```
audit/
├── SUMMARY.md                            ← you are here (CTO one-pager)
├── FULL_REPORT.md                        ← per-finding detail + exploit sketches + fix recommendations
└── invariants/
    ├── SnowMindRegistryInvariant.t.sol   ← Foundry StdInvariant suite (7/7 PASS)
    └── README.md                         ← how to run it
```

No application code was modified by this audit. The tracked codebase is unchanged.

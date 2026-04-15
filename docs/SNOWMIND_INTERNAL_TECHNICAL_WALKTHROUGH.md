# SnowMind Internal Technical Walkthrough

## 1) Product and Runtime Intent

SnowMind is a non-custodial USDC yield optimizer on Avalanche C-Chain.

Core promise:
- Users keep custody in a Kernel smart account (ERC-4337).
- Session-key constrained automation moves funds across allowed protocols.
- Safety gates are fail-closed and prioritize loss prevention over optimization frequency.

Core runtime components:
- Frontend (Next.js): onboarding, session-key grant, user auth state, dashboard.
- Backend (FastAPI): policy, authz, optimizer decisions, scheduler, accounting, API surface.
- Execution service (Node): ZeroDev/Kernel transaction building and UserOperation submission.
- Database (Supabase/Postgres): account state, session keys, allocations, rebalance logs, risk/APY snapshots.
- Contracts: on-chain registry and event/logging utilities.

## 2) Smart Account and Session-Key Architecture

### 2.1 Account model

SnowMind uses Kernel v3.1 smart accounts and EntryPoint v0.7. A user wallet (Privy-connected EOA) is the sudo owner.

Operational signer for automation is a generated session key with policy constraints.

### 2.2 Permission model

The session key is granted with a permission plugin that enforces:
- Allowed targets/selectors for protocol actions.
- Per-call amount limits.
- Gas policy.
- Rate limit policy.

Important implementation detail:
- Policy rules are consolidated to avoid duplicate permission hashes for identical target+selector combos.
- Permit2 rules are included for Euler flows.

### 2.3 Enable mode vs regular mode

Execution service decides whether to use enable mode first or regular mode by checking EntryPoint nonce keys for that permission identity.

Mode decision logic:
- If permission has never been used (zero sequence in both enable and regular keys), try enable mode.
- If permission sequence exists, use regular mode.

This avoids repeated duplicate-permission failures and is more accurate than kernel-internal nonce checks.

### 2.4 Session-key storage and lifecycle

Backend stores encrypted session-key material (approval blob + private key) in `session_keys`.

Security behavior:
- KMS envelope encryption preferred.
- In non-debug mode, KMS failure is fail-closed (no insecure fallback).
- Only one active key per account is enforced in practice and schema.

Lifecycle behavior:
- New key insert deactivates previous active keys.
- Invalid keys are revoked on definitive errors.
- Recovery path can temporarily reactivate prior deactivated keys when permission recovery is needed.

## 3) End-to-End Runtime Flows

### 3.1 Onboarding and activation

High-level sequence:
1. Frontend derives smart account address.
2. User funds smart account with USDC (shortfall-only transfer; avoids duplicate transfer).
3. Frontend grants session key and serializes permission payload.
4. Backend registers account and persists session key.
5. Backend triggers immediate best-effort initial rebalance.

Robustness features:
- RPC fallback and confirmation fallback logic in frontend.
- Wallet compatibility fallbacks for transaction submission.
- Re-grant-only mode for users with funds but inactive session key.

### 3.2 Scheduler-driven optimization

The scheduler runs with distributed lock semantics so only one instance executes account cycles at a time.

Cycle behavior:
- Gather active accounts.
- Require valid, non-expired session keys.
- Apply cadence gate based on principal tiers.
- Run rebalance pipeline with retries.
- Persist logs and telemetry.

Additional scheduled jobs:
- Daily APY snapshots.
- Daily risk snapshots.
- KPI snapshots.
- Reconciliation and snapshot cleanup.

### 3.3 Rebalance pipeline

The rebalancer does all decisioning before execution.

Simplified pipeline:
1. Ensure active session key exists and passes cooldown constraints.
2. Fetch spot rates and validate via TWAP/velocity/sanity logic.
3. Restrict candidate protocols by session-key scope and compatibility checks.
4. Reconcile DB allocations against on-chain balances.
5. Include idle USDC in total allocatable value.
6. Run targeted health checks (positions first, then APY-ranked candidates).
7. Compute new allocation with caps and liquidity constraints.
8. Apply gates (beat margin, minimum gap, movement, optional profitability, max move).
9. Apply circuit-breaker and idempotency protections.
10. Execute atomic UserOperation batch if needed.
11. Persist final outcome.

### 3.4 Withdrawal flow

Withdrawal is signature-authorized by owner EOA with TTL-bound message fields:
- smart account
- owner
- amount
- full/partial flag
- chain id
- timestamp

Then backend:
- Computes conservative withdrawable balance across protocols.
- Computes fee quote (currently fee charging disabled by config).
- Builds execution payload for atomic withdrawal batch.
- Verifies UserOperation success from EntryPoint events, not just tx hash.

Full withdrawal post-actions:
- Revoke session key.
- Deactivate account.
- Clear allocations.

## 4) Execution Service Boundary and Transaction Semantics

### 4.1 Backend to execution trust boundary

Calls from backend to execution service are protected with:
- Canonical HMAC signature over method, path, timestamp, nonce, body.
- Request TTL checks.
- Replay protection (memory and optional persistent nonce store).

### 4.2 Concurrency controls

Execution service protects itself and senders with:
- Global in-flight cap.
- Per-sender in-flight lock.
- Timeout wrappers.

This reduces duplicate permission races and process instability under load.

### 4.3 Atomic call construction

For rebalance operations:
- Withdrawals first.
- Optional transfers.
- Approvals.
- Deposits.

This ordering ensures funding availability and avoids impossible deposit attempts.

### 4.4 Retry matrix

When execution fails, service attempts controlled retries:
- Opposite permission mode (enable vs regular).
- No-paymaster retries for suspected paymaster-induced failures.
- Error decoding to separate recoverable permission conflicts from hard invalid-key conditions.

## 5) Optimizer Safety and Risk Controls

### 5.1 Rate safety

Rates are fetched from protocol adapters and validated with:
- sanity bounds,
- velocity checks,
- TWAP smoothing,
- short caches and persistence snapshots.

### 5.2 Health safety

Health checks are protocol-aware and not identical across markets.

Examples:
- Aave: reserve state flags + utilization.
- Benqi: comptroller pause signals + utilization.
- Spark: Avalanche-specific liquidity checks and no utilization-based exclusion model.
- Euler/Silo: vault and utilization checks with ERC-4626 mechanics.

### 5.3 Capital movement controls

Movement is bounded by:
- protocol liquidity and platform TVL caps,
- user-scoped allowed protocols,
- user allocation caps,
- per-cycle max movement,
- idle-overflow skip threshold.

### 5.4 Circuit-breakers and reconciliation

Safety net behavior includes:
- portfolio drop halt checks,
- stale principal correction paths,
- stranded-funds detection when session scope excludes funded protocols,
- DB to on-chain reconciliation self-healing.

## 6) Data Model and Critical Persistence

Key persistence tables (logical roles):
- `accounts`: ownership and activation state.
- `session_keys`: encrypted permission blobs and key metadata.
- `allocations`: latest portfolio distribution view.
- `rebalance_logs`: execution/skip/failure history and movement audit.
- `account_yield_tracking`: principal and withdrawal accounting basis.
- `daily_apy_snapshots`: historical APY.
- `daily_risk_scores`: historical risk snapshots.
- `protocol_circuit_breaker_state`: protocol-level safety memory.
- `scheduler_locks`: distributed lock coordination.
- `internal_request_nonces`: replay protection for service boundary.

## 7) Security Model Summary

Primary controls:
- Privy token verification + DID ownership checks.
- Owner-address matching on protected account operations.
- HMAC-authenticated internal service boundary.
- Encrypted session key storage with KMS-first posture.
- Replay defense (timestamp + nonce + persistence).
- Strict account-level concurrency and idempotency guards.
- Conservative execution confirmation requiring UserOperation event success.

Fail-safe philosophy in implementation:
- Prefer skipping a rebalance to executing under uncertainty.
- Prefer conservative quotes to avoid over-transfer.
- Disable deposits under degraded health signals.
- Halt on severe drift or unresolved safety anomalies.

## 8) What Should Be Audited First (Priority Map)

P0 (fund-loss critical):
- Session-key serialization/deserialization integrity and signer binding.
- Permission mode selection and replay/collision behavior.
- Withdrawal authorization correctness and replay resistance.
- Atomic batch correctness for withdrawal/deposit ordering.
- UserOperation success verification logic (event-level correctness).
- Any path that can deactivate accounts/session keys incorrectly.

P1 (safety/reliability critical):
- Principal/yield accounting reconciliation and drift normalization.
- Rebalance gating interactions (beat margin, cadence, max move, idempotency).
- Protocol adapter health checks and protocol-specific assumptions.
- Scheduler locking and retry interactions across multi-instance deployments.

P2 (operational resilience):
- RPC failover and cooldown behavior under heavy 429 conditions.
- Execution service concurrency and timeout envelope.
- Snapshot seeding/purging and dashboard consistency logic.

## 9) Known Operational Truths

- Fee charging is currently disabled by configuration, while fee plumbing remains implemented.
- Production rebalance scheduler interval is forced to hourly in non-debug mode.
- Smart account deployment can be deferred and occur on first effective UserOperation.
- Permit2 compatibility for older session blobs is explicitly guarded.

## 10) Practical Mental Model

Think of SnowMind as three nested safety envelopes:

1. Ownership and authorization envelope:
   user identity, account ownership, signed intent, and replay protection.

2. Decision envelope:
   rates + health + caps + gates decide whether moving funds is justified and safe.

3. Execution envelope:
   atomic call ordering, permission mode correctness, on-chain confirmation validation.

If any envelope cannot prove safety, the system should skip or halt rather than force execution.

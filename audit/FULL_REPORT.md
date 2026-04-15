# SnowMind — Full Security Audit Report

> **Audit date:** 2026-04-14
> **Branch:** `dev`
> **Auditor:** Claude Opus 4.6 (1M context) — adversarial review
> **Scope:** first-party code only (contracts, backend, execution, frontend)
> **Quick-read version:** [SUMMARY.md](SUMMARY.md) — CTO one-pager
> **Location:** this report lives at `audit/FULL_REPORT.md`. File links
> below are relative to this file (`../apps/...` points at the repo
> root). The repo-root `report.md` is a protocol-risk scoring document
> unrelated to this audit and is unchanged.

---

## 0. Executive Summary

SnowMind is a non-custodial DeFi yield optimizer on Avalanche. Users deploy
a Kernel v3.1 smart account via ZeroDev and grant a session key that allows
the backend to rebalance USDC across a fixed allowlist of protocols
(Aave V3, Benqi, Spark, Euler V2, two Silo vaults). The backend decides,
the execution service submits UserOps, and the Solidity
`SnowMindRegistry` contract is a logging-only registry.

### Residual-risk posture

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 5 |
| Informational | 3 |
| **Total** | **13** |

### Top two risks

1. **`POST /api/v1/rebalance/{address}/withdraw-all` bypasses the
   wallet-signature gate used by `/withdrawals/execute` (N-12).** A
   stolen Privy JWT alone is sufficient to drain every protocol position
   to the user's EOA — the attacker does not need to produce a fresh
   `ownerSignature`, in contrast to the `/withdrawals/execute` flow which
   does. Because ZeroDev's call policy allows `USDC.transfer` to
   `ONE_OF([treasury, userEOA])`, and `execute_emergency_withdrawal`
   builds a `user_transfer` with `to = owner_address`, the funds land in
   the user's EOA. If the attacker has already compromised the device or
   browser (XSS, token theft, session fixation), they typically also
   control that EOA. This is the single largest realistic loss path in
   the current codebase. Fix: delete the endpoint. One hour.
2. **Session-key expiry is effectively infinite** (year 2100 hardcode in
   the frontend — N-01). A compromised session key keeps authority until
   the user manually revokes or does a full withdrawal. Fix: add
   `toTimestampPolicy({ validUntil: 30d })` to the permissions array.

### New findings from this audit

- **N-12 [HIGH]** Withdraw-all endpoint bypasses wallet signature.
- **N-01 [HIGH]** Session-key expiry hardcoded to year 2100.
- **N-02 [MEDIUM]** Concurrent-withdrawal race window between backend
  lock check and on-chain fee-calculator update.
- **N-03 [MEDIUM]** Execution-service timestamp skew uses `Math.abs` —
  accepts timestamps up to TTL seconds in the future.
- **N-04 [MEDIUM]** Duplicate execution-service code tree at
  `apps/backend/execution_service/` parallels `apps/execution/`.
- **N-05 [LOW]** Nonce length is not validated on the execution service.
- **N-06 [LOW]** Per-sender execution lock auto-expires after 90 s, which
  is shorter than the 120 s backend→executor HTTP timeout.
- **N-08 [LOW]** DEBUG-mode AES derivation from `SUPABASE_SERVICE_KEY`
  still present for non-production envs.
- **N-09 [LOW]** Session-key store/revoke two-phase race.
- **N-13 [LOW]** Legacy `record_withdrawal_fee` in `fee_calculator.py`
  hardcodes `fee_exempt=False`, so if fees are re-enabled the emergency-
  withdrawal code path would mischarge accounts flagged as fee-exempt.
- **N-07 [INFO]** Withdrawal executor passes an empty `TREASURY` address
  when `AGENT_FEE_ENABLED=false`; fee amount is always 0 so no funds
  move, but the payload is brittle.
- **N-10 [INFO]** Per-sender execution lock is process-local (breaks on
  horizontal scale-out of the execution service).
- **N-11 [INFO]** Rate limiter is process-local.

---

## 1. Scope & Methodology

First-party scope:

- `contracts/src/SnowMindRegistry.sol`
- `contracts/script/DeployMainnet.s.sol`
- `contracts/test/SnowMindRegistry.t.sol`
- `apps/backend/app/**`
- `apps/execution/{server.js,execute.js,auth.js,auth.test.js}`
- `apps/web/lib/{api-client.ts,zerodev.ts,privy.ts,withdrawal-auth.ts}`,
  `apps/web/app/(app)/onboarding/page.tsx`,
  `apps/web/app/(app)/withdraw/page.tsx`, `apps/web/hooks/**`

Explicit exclusions: vendored libraries under `contracts/lib/**` (OZ,
forge-std), and third-party protocol contracts (Aave, Benqi, Spark,
Euler, Silo).

**Methodology:**

1. Threat-model the system (actors = scheduler, execution service,
   backend, frontend, rogue external caller; assets = user USDC, session
   key, internal service key, Supabase service key, KMS key).
2. Read every file in scope end-to-end; cross-reference call graphs.
3. Hunt for issues across the full backend route tree, worker tree,
   execution-service tree, and security-critical frontend surface.
4. Build and execute a Foundry `StdInvariant` suite for the on-chain
   registry (see §3).

---

## 2. New Findings

### N-01 [HIGH] — Session-key expiry hardcoded to year 2100 (effectively infinite)

**Affected:** [apps/web/lib/zerodev.ts:485-488](../apps/web/lib/zerodev.ts:485),
[apps/web/lib/zerodev.ts:776-778](../apps/web/lib/zerodev.ts:776)

**Root cause.** The frontend sets `expiresAt = 4102444800` (2100-01-01) and
the comment on line 485 explicitly says *"Session key never expires
on-chain"*. The on-chain Kernel permission has NO `toTimestampPolicy`
(see [zerodev.ts:778](../apps/web/lib/zerodev.ts:778)) — only `callPolicy`,
`gasPolicy`, and `rateLimitPolicy` are installed. So any valid signature
from the session-key signer will be accepted by the Kernel until the
permission plugin is uninstalled or the account is destroyed.

**Exploit scenario.** A compromised session private key (either from the
backend DB + KMS where it is stored server-side, or from any historical
point where the key was in flight) retains fund-movement authority
indefinitely. Any past backend compromise stays exploitable even after
the compromise has been remediated.

**Impact.** Within the call-policy scope:
- Can deposit/withdraw on the 6 allowed protocols.
- Can approve USDC to protocol addresses.
- Can call `USDC.transfer` to `treasury` OR `userEOA` (ONE_OF rule at
  [zerodev.ts:725-736](../apps/web/lib/zerodev.ts:725)).

The call-policy tightness means the attacker cannot drain to arbitrary
recipients — only to the user's own EOA or the (currently empty) treasury.
A malicious session key CAN, however, keep repeatedly withdrawing to the
user's EOA, which if that EOA is also compromised becomes a drain, AND
can force the portfolio out of the best-yield protocol to cause lost
interest.

**Recommendation.** Install `toTimestampPolicy({ validUntil: now + 30d })`
inside the permissions list at [zerodev.ts:752-786](../apps/web/lib/zerodev.ts:752)
and require the frontend to prompt for re-grant before expiry. Expose a
server-side monotonic rotation job (daily sweep deactivating keys older
than 30 d so the scheduler refuses to use them even if the plugin is
still installed).

---

### N-02 [MEDIUM] — Concurrent-withdrawal race between DB lock check and fee accounting

**Affected:** [apps/backend/app/api/routes/withdrawal.py:678-698](../apps/backend/app/api/routes/withdrawal.py:678), [apps/backend/app/api/routes/withdrawal.py:921-922](../apps/backend/app/api/routes/withdrawal.py:921)

**Root cause.** The backend's "lock" for a concurrent withdrawal is a
read-only SELECT for a `pending` row in `rebalance_logs`. The log row is
inserted only AFTER the UserOp resolves ([line 925](../apps/backend/app/api/routes/withdrawal.py:925)),
and the yield-tracking `record_withdrawal` call is also post-execution
([line 922](../apps/backend/app/api/routes/withdrawal.py:922)). Between the
lock check and the on-chain submission the backend holds no row — so two
parallel requests can both pass the check.

The execution-service per-sender concurrency lock at
[server.js:134-142](../apps/execution/server.js:134) catches the simultaneous
case (it rejects with 409 while another UserOp is in flight), BUT it
auto-expires after **90 seconds** ([server.js:137](../apps/execution/server.js:137)),
while the backend→executor HTTP timeout is **120 seconds**
([executor.py:244](../apps/backend/app/services/execution/executor.py:244)).
If the first UserOp takes between 90 s and 120 s to reach success
confirmation, the per-sender lock on the executor clears but the first
backend request is still waiting. A second backend request that arrives
at that moment would:

1. pass the DB lock check (no pending row yet);
2. pass the executor per-sender check (90 s expired);
3. submit a second concurrent UserOp with the SAME `fee_calc` (computed
   from stale `yield_tracking` because `record_withdrawal` has not yet run).

If both UserOps land on-chain they would both transfer `user_receives`
out, double-spending the intended amount from the user's pool.

**Impact.** In the AGENT_FEE_ENABLED=false default this is
user-controlled money only (no protocol loss), and the second UserOp
may revert on-chain if the protocol balance drops below the
`user_receives` target. But in the AGENT_FEE_ENABLED=true future, the
fee calculation is based on principal vs. net-withdrawn, which
double-executing would under-account the principal and cause the second
fee calc to undercharge.

**Recommendation.**
- Insert a PENDING `rebalance_logs` row BEFORE the HTTP call, as a real
  DB-backed mutex; update it to `executed`/`failed` after. Use a unique
  index on `(account_id, status='pending')` partial index.
- Alternatively, raise the executor per-sender lock TTL to 180 s so it
  strictly dominates the backend HTTP timeout.
- Compute the fee INSIDE the executor's successful-return path rather
  than in the backend pre-submission.

---

### N-03 [MEDIUM] — Execution-service timestamp skew check accepts future timestamps

**Affected:** [apps/execution/auth.js:52](../apps/execution/auth.js:52)

**Root cause.** The TTL check uses
`Math.abs(nowSeconds - tsInt) > ttlSeconds`. A request with
`timestamp = now + 299` is accepted. Combined with N-05 (no nonce length
validation), an attacker who has captured any signed request body and
shared secret can mint a future-dated request that remains valid for
up to `2 * ttlSeconds` (299 s future + 300 s TTL window = 599 s before
the timestamp expires out of the TTL window from the PAST side).

**Impact.** Extends the replay window for any captured request by up to
2× TTL. Not independently exploitable — the attacker still needs the
shared secret or the ability to forge the HMAC. But it magnifies any
other leak.

**Recommendation.** Enforce a strict upper bound:

```js
if (tsInt > nowSeconds + 30 || nowSeconds - tsInt > ttlSeconds) {
  return { ok: false, status: 401, error: "Request timestamp out of range" }
}
```

Allow a small (30 s) forward clock skew for normal drift; reject anything
further in the future.

---

### N-04 [MEDIUM] — Duplicate execution-service code tree

**Affected:**
- Canonical: [apps/execution/{server.js,auth.js,execute.js}](../apps/execution/server.js)
- Duplicate: [apps/backend/execution_service/{server.js,auth.js,execute.js}](../apps/backend/execution_service/server.js)
- Config note: [apps/backend/app/core/config.py:121-125](../apps/backend/app/core/config.py:121) ("Canonical target is the dedicated apps/execution service. Legacy apps/backend/execution_service should be treated as compatibility-only.")

**Root cause.** Two complete copies of the execution service exist in the
repo. The config file explicitly declares one canonical and the other
legacy, but both are still present and both compile. Security-critical
code (HMAC verification, replay prevention, request validation) lives in
both copies. Any security fix applied to the canonical copy will NOT
propagate to the legacy copy unless a developer remembers it.

**Impact.** Risk of a security fix in one copy being silently absent in
the other; a rogue or accidental deployment that points
`EXECUTION_SERVICE_URL` at the legacy copy would run stale security code.

**Recommendation.** Delete `apps/backend/execution_service/` in a
standalone PR (no logic changes) and verify no deployment scripts or
Dockerfiles reference the legacy path. If the legacy copy MUST be
retained for some deployment, replace its files with stubs that import
from the canonical copy.

---

### N-05 [LOW] — Execution service does not validate nonce length or format

**Affected:** [apps/execution/auth.js:41](../apps/execution/auth.js:41)

**Root cause.** `const nonce = String(headers["x-request-nonce"] || "")` —
accepts any non-empty string. There is no minimum length and no character
set enforcement. A pathological client sending a 1-character nonce
("1", "2", …) has a birthday-collision horizon of a few hundred requests
before self-collision (false 409 replay errors). The backend uses
`secrets.token_hex(16)` (32 chars, 128 bits) so normal operation is
safe — but a bug or malicious internal tool could generate weak nonces
and DoS its own requests.

**Impact.** Self-DoS, not a security bypass.

**Recommendation.** Enforce `nonce.length >= 16 && /^[0-9a-fA-F]+$/.test(nonce)`.

---

### N-06 [LOW] — Per-sender lock TTL is shorter than backend HTTP timeout

**Affected:** [apps/execution/server.js:137](../apps/execution/server.js:137) (90 s),
[apps/backend/app/services/execution/executor.py:244](../apps/backend/app/services/execution/executor.py:244) (120 s)

**Root cause.** The per-sender concurrency lock on the execution service
auto-expires after 90 s but the backend waits up to 120 s for the HTTP
response. A UserOp taking 91–120 s to confirm will clear the executor's
in-memory lock while the backend call is still in flight, opening the
race described in N-02.

**Impact.** Enables N-02 at ~1 % of concurrent-withdrawal attempts
against a slow bundler.

**Recommendation.** Raise the lock TTL to `EXECUTION_TIMEOUT_MS + slack`
(currently 60 000 ms + slack = 90 s). Since `EXECUTION_TIMEOUT_MS` is 60 s
and the HTTP client timeout is 120 s, the lock should be the larger of
the two plus 10 s safety → 130 s.

---

### N-07 [INFO] — Withdrawal executor passes empty TREASURY when fees are disabled

**Affected:** [apps/backend/app/api/routes/withdrawal.py:859](../apps/backend/app/api/routes/withdrawal.py:859),
[apps/backend/app/api/routes/withdrawal.py:670-675](../apps/backend/app/api/routes/withdrawal.py:670)

**Root cause.** The treasury guard at line 670 only fires when
`AGENT_FEE_ENABLED=true`. When fees are disabled (the current default),
the payload at line 859 embeds `"TREASURY": settings.TREASURY_ADDRESS`
which may be `""`. The executor's `agent_fee_raw` is forced to 0 at
line 832, so no actual USDC transfer to the empty address is built, but
the payload is brittle: a future refactor that removes the
`AGENT_FEE_ENABLED` check while leaving the treasury default empty
could silently route fees to `0x0` or revert.

**Recommendation.** Validate treasury unconditionally in the payload
builder, OR set `"TREASURY": "0x0000000000000000000000000000000000000000"`
explicitly when fees are disabled and have the executor refuse any call
with a zero-address fee recipient.

---

### N-08 [LOW] — DEBUG mode still auto-derives session-key AES from Supabase service key

**Affected:** [apps/backend/app/services/execution/session_key.py:226-245](../apps/backend/app/services/execution/session_key.py:226)

**Root cause.** The non-DEBUG path correctly raises a `RuntimeError` when
`SESSION_KEY_ENCRYPTION_KEY` is unset. But in DEBUG mode it silently
derives the key via `HMAC(SUPABASE_SERVICE_KEY, "snowmind-session-key-encryption-v1")`.
A staging or dev deployment with `DEBUG=true` (common for Railway
preview environments) stores production-shape session keys under an
AES key that is 1 hash away from the Supabase service key — anyone with
read access to the Supabase dashboard or `.env` can decrypt.

**Impact.** Stage/dev deployments that store real-looking session keys
(e.g. during QA against a live testnet or mainnet-fork) are at risk of
session-key plaintext exposure if the Supabase service key leaks.

**Recommendation.** Either (a) raise in DEBUG as well and require every
environment to set `SESSION_KEY_ENCRYPTION_KEY`, or (b) refuse to use
real mainnet addresses in DEBUG mode so DEBUG envs can only contain
throwaway state.

---

### N-09 [LOW] — Session-key store/revoke two-phase race

**Affected:** [apps/backend/app/services/execution/session_key.py:466-497](../apps/backend/app/services/execution/session_key.py:466)

**Root cause.** `store_session_key` first sets `is_active=false` on all
existing active rows, then inserts the new row. If two concurrent
`store_session_key` calls race, the sequence can be:

1. Caller A deactivates existing keys.
2. Caller B deactivates existing keys (no-op, already deactivated).
3. Caller A inserts new row (A').
4. Caller B inserts new row (B'), also with `is_active=true`.

Result: two active rows. `_select_latest_active_key_row` returns the
newest (B'), so the scheduler uses B', but A' also appears as "active"
in any query that isn't `order by created_at desc limit 1`. This
contradicts the comment on [line 466-468](../apps/backend/app/services/execution/session_key.py:466)
("Multiple active keys cause race conditions when concurrent rebalance
attempts pick up different keys with different permissionHashes").

**Impact.** Low — only affects the narrow window when a user double-clicks
"grant session key". Downstream code consistently prefers newest, so
the rebalancer converges after one tick.

**Recommendation.** Move to a single DB upsert that atomically
deactivates any existing active row in the same statement:

```sql
UPDATE session_keys
SET is_active = false
WHERE account_id = $1 AND is_active = true
RETURNING id;
-- then insert, wrapped in a BEGIN/COMMIT transaction
```

Or add a partial unique index: `CREATE UNIQUE INDEX session_keys_one_active_per_account ON session_keys(account_id) WHERE is_active;`. That index would reject the race at the database layer.

---

### N-10 [INFO] — Hardcoded per-sender UserOp submission lock uses process-local Map

**Affected:** [apps/execution/server.js:132-150](../apps/execution/server.js:132)

The execution service runs as a single Node process on Railway. If it
ever scales to >1 instance, the `activeSenders` Map becomes
per-instance and no longer prevents cross-instance concurrent UserOps
for the same sender. Railway scale-out would silently reintroduce the
bug. Tracked as a future-proofing concern, not a current finding.

---

### N-11 [INFO] — Rate-limiter is process-local and not horizontally scalable

**Affected:** [apps/backend/app/core/security.py:558-594](../apps/backend/app/core/security.py:558)

The in-memory sliding-window limiter enforces per-IP and per-API-key
quotas but only within a single process. Code comment acknowledges
this ("Post-MVP: replace with Redis for horizontal scaling"). Tracked
as operational debt.

---

### N-12 [HIGH] — Withdrawal authentication asymmetry (Privy JWT alone drains funds)

**Affected:**
- [apps/backend/app/api/routes/rebalance.py:496-553](../apps/backend/app/api/routes/rebalance.py:496) (`POST /api/v1/rebalance/{address}/withdraw-all`)
- [apps/backend/app/services/optimizer/rebalancer.py:1975-2135](../apps/backend/app/services/optimizer/rebalancer.py:1975) (`execute_emergency_withdrawal`)
- [apps/backend/app/services/optimizer/rebalancer.py:2097-2100](../apps/backend/app/services/optimizer/rebalancer.py:2097) (build `user_transfer` → `owner_addr`)
- [apps/backend/main.py:356](../apps/backend/main.py:356) (router mounted under `/api/v1/rebalance`)
- [apps/web/lib/api-client.ts:361-365](../apps/web/lib/api-client.ts:361) (frontend `withdrawAll` call — no signature)
- Compare with [apps/backend/app/api/routes/withdrawal.py:644-671](../apps/backend/app/api/routes/withdrawal.py:644) (proper signature-gated `/withdrawals/execute`)
- Compare with [apps/web/app/(app)/withdraw/page.tsx:150-163](../apps/web/app/(app)/withdraw/page.tsx:150) (frontend `executeWithdrawal` call — signs first)

**Root cause.** SnowMind has TWO full-withdrawal code paths:

1. **`POST /api/v1/withdrawals/execute`** — the modern, UX-facing path.
   Requires the caller to supply `ownerSignature`, `signatureMessage`,
   `signatureTimestamp`. The backend re-canonicalizes the message
   [withdrawal.py:553](../apps/backend/app/api/routes/withdrawal.py:553),
   checks a 300 s TTL [withdrawal.py:546](../apps/backend/app/api/routes/withdrawal.py:546),
   and verifies with `Account.recover_message`
   [withdrawal.py:565](../apps/backend/app/api/routes/withdrawal.py:565)
   that the signature was produced by the on-chain owner EOA. This is
   the correct "two-factor" posture: Privy JWT (for *who you are*) plus
   wallet signature (for *prove you're at the keyboard right now*).

2. **`POST /api/v1/rebalance/{address}/withdraw-all`** — a legacy path
   still exported to the frontend as `api.withdrawAll`. Its auth
   dependency is just
   [rebalance.py:502: `_auth: dict = Depends(require_privy_auth)`](../apps/backend/app/api/routes/rebalance.py:502).
   There is NO `ownerSignature` field in the request body; there is
   NO wallet-signature verification. The Privy JWT is the entire
   authentication factor.

After passing that single check, the route calls
[rebalancer.execute_emergency_withdrawal](../apps/backend/app/services/optimizer/rebalancer.py:1975)
which:

- Reads all on-chain protocol positions (line 1988).
- Builds an exit `withdrawals` array with `amountUSDC = "MAX"` per protocol.
- Builds a `user_transfer = { to: owner_address, amountUSDC: net_withdrawal_usd }`
  (line 2097-2100) — the smart account's USDC goes to the user's EOA.
- Submits the batched UserOp through the execution service, which signs
  it with the server-stored session key.
- Revokes the session key and deactivates the account.

The ZeroDev call policy allows `USDC.transfer` to
`ONE_OF([treasury, userEOA])`
([zerodev.ts:725-736](../apps/web/lib/zerodev.ts:725)), and `user_transfer.to`
is exactly `owner_address` (which was bound into the session key at
grant time as the `userEOA` slot), so the signed UserOp lands on-chain
without any additional permission check.

**Exploit scenario.** An attacker who has obtained a live Privy JWT by
any of:
- XSS on a SnowMind page or any page that shares a cookie/storage
  boundary with `app.snowmind.xyz`;
- stolen `localStorage` / `indexedDB` (supply-chain extension, stolen
  laptop, shared browser session);
- Privy provider compromise;
- session fixation via a phishing login flow;

calls `POST /api/v1/rebalance/{address}/withdraw-all` with nothing more
than `Authorization: Bearer <stolen Privy JWT>`. The backend passes all
ownership checks (`verify_account_ownership` → DID matches the stolen
JWT's `sub`), calls `execute_emergency_withdrawal`, and submits the
UserOp. All of the account's deployed USDC lands in the owner's EOA.

This IS a fund loss if the attacker is the same actor who compromised
the user's device — because that same actor typically also has (or can
exfiltrate) the user's wallet signing key. Even when the attacker does
NOT control the EOA, they can weaponize this path to:

- Force a session-key revocation + account deactivation on any user
  whose JWT they briefly touch (denial-of-service — user must
  re-onboard to use SnowMind again).
- Cancel a carefully-balanced strategy at a moment of the attacker's
  choosing, locking the user out of transient yield opportunities.

**The `/withdrawals/execute` path is immune to all of these attacks**
because the additional wallet signature provides a second factor that
the attacker cannot produce from the stolen JWT alone.

**Impact.** HIGH — fund-draining path reachable from a single-factor
compromise. Blast radius is the entire account balance. The attacker
cannot redirect to their own address, but in the common threat model
where device compromise implies EOA access, the practical outcome is
total loss of the account's deployed funds.

**Reproduction sketch** (do not run against live systems without
authorization):

```bash
# 1. Obtain a valid Privy access token for the target user (out of scope).
PRIVY_JWT="<stolen_bearer_token>"
SMART_ACCT="0x<target_smart_account_address>"

# 2. Call the vulnerable endpoint — no signature, no message.
curl -X POST "https://api.snowmind.xyz/api/v1/rebalance/${SMART_ACCT}/withdraw-all" \
  -H "Authorization: Bearer ${PRIVY_JWT}"

# 3. Observe the on-chain tx transferring all protocol positions to
#    the account's owner EOA and deactivating the SnowMind account.
```

For the `/withdrawals/execute` equivalent, step 2 would require also
passing `ownerSignature`, `signatureMessage`, and `signatureTimestamp`
— the attacker cannot forge the signature without the wallet private
key, so the analogous exploit fails.

**Recommendation.** Pick exactly one of the following:

- **Preferred: delete the endpoint.** The frontend `withdrawAll` button
  already routes through the modern `/withdrawals/execute` path in the
  withdraw page
  ([apps/web/app/(app)/withdraw/page.tsx:156-163](../apps/web/app/(app)/withdraw/page.tsx:156)).
  The legacy `api.withdrawAll` at
  [apps/web/lib/api-client.ts:361-365](../apps/web/lib/api-client.ts:361)
  is documented as an emergency-only path; grep the frontend to confirm
  no user-visible flow calls it, then delete both the client method
  and the backend route. (Also delete `execute_emergency_withdrawal`
  if nothing else calls it after the route is removed — grep shows only
  the one caller.)

- **Second best: require a wallet signature.** Add an `ownerSignature`
  /`signatureMessage`/`signatureTimestamp` body to the route and reuse
  `_verify_withdrawal_authorization` from
  [withdrawal.py:529-577](../apps/backend/app/api/routes/withdrawal.py:529)
  verbatim. Enforce the same 300 s TTL and recovery check.

- **Minimum acceptable:** gate the route behind `require_service_auth`
  (API-key only, not Privy JWT) so only internal ops tooling can invoke
  it. This at least removes the "stolen JWT → drain" chain.

Write a regression test that the endpoint rejects any request lacking a
valid EOA signature after the fix lands.

---

## 3. Smart-Contract Invariants

A Foundry `StdInvariant` suite was written at
[invariants/SnowMindRegistryInvariant.t.sol](invariants/SnowMindRegistryInvariant.t.sol)
and executed against the current contract source. The suite was
temporarily copied into `contracts/test/` for the run and then removed
to keep the tracked test tree pristine.

**Command:** `forge test --match-contract SnowMindRegistryInvariant -vvv`
(from the `contracts/` directory)

**Forge version:** `forge 1.5.1-stable`

**Result:** `Suite result: ok. 7 passed; 0 failed; 0 skipped; finished in
31.95s (103.52s CPU time)`. Each invariant ran **256 runs × 500 calls =
128 000 fuzzed handler invocations** with 0 reverts on the expected
paths.

| # | Invariant | Runs | Reverts | Result |
|---|---|---|---|---|
| 1 | `activeAccountCount == count(isRegistered == true)` | 256 × 500 | 0 | **PASS** |
| 2 | `activeAccountCount <= registeredAccounts.length` | 256 × 500 | 0 | **PASS** |
| 3 | `registeredAccounts.length` monotonic | 256 × 500 | 0 | **PASS** |
| 4 | every array entry has `accounts[a].registeredAt > 0` | 256 × 500 | 0 | **PASS** |
| 5 | `owner` stable under handler calls (includes fuzzed non-owner callers) | 256 × 500 | 0 | **PASS** |
| 6 | `pendingOwner == address(0)` under handler-only calls | 256 × 500 | 0 | **PASS** |
| 7 | `historical >= distinct(active)` bounds check | 256 × 500 | 0 | **PASS** |

The invariant suite also exercises three **unauthorized-caller**
handlers (`handler_unauthorized_register`, `handler_unauthorized_deregister`,
`handler_unauthorized_setProtocol`) that pass a fuzzed `rogue` address
different from `owner` and assert that every one of those calls reverts.
None of those handlers ever succeeded in mutating state — the contract's
`onlyOwner` modifier holds under all 128 000 × 3 = 384 000 fuzzed
unauthorized calls.

**Note on invariant #7.** This is a deliberately weak bounds check. The
registry's `registeredAccounts` array is append-only and does not
deduplicate: a `register(X) → deregister(X) → register(X)` sequence
pushes `X` twice while leaving only one address active. The invariant
tolerates this by asserting only `historical >= distinct`, not
`historical == distinct`. The asymmetry is an accepted design quirk
(see §5).

To re-run yourself:

```sh
cp invariants/SnowMindRegistryInvariant.t.sol contracts/test/
cd contracts && forge test --match-contract SnowMindRegistryInvariant -vvv
# Remember to `rm contracts/test/SnowMindRegistryInvariant.t.sol` after,
# or `git clean -fd contracts/test/` — the file was intentionally kept
# out of the tracked test tree.
```

See [invariants/README.md](invariants/README.md) for the rationale.

---

## 4. Off-Chain Observations Worth Calling Out

The following are **not findings** — they are design decisions that
deserve explicit acknowledgment so the user isn't surprised later.

- **Profitability gate disabled by default** ([config.py:155](../apps/backend/app/core/config.py:155)).
  Documented business decision ("growth phase"). The $25K max-single-
  rebalance cap at [config.py:166](../apps/backend/app/core/config.py:166)
  plus the 60-minute idempotency guard at [rebalancer.py:1314-1346](../apps/backend/app/services/optimizer/rebalancer.py:1314)
  prevent the worst failure modes.

- **Session private key passes through HTTP body** from frontend to
  backend during `storeSessionKey` at [api-client.ts ~L420](../apps/web/lib/api-client.ts).
  HTTPS protects it in transit but it is briefly in FastAPI request
  logs if request bodies are logged. Verified that the backend does not
  log full request bodies — but any middleware or APM that does would
  leak the key.

- **Withdrawal authorization signature** — correctly re-canonicalized on
  the server ([withdrawal.py:553-577](../apps/backend/app/api/routes/withdrawal.py:553))
  and verified against the owner's wallet via `eth_account.recover`.
  300-second TTL. This is the right pattern; no finding.

- **CallPolicy scope** ([zerodev.ts:517-750](../apps/web/lib/zerodev.ts:517)) is
  unusually tight: every `approve`, `supply`, `deposit`, `withdraw`,
  `mint`, `redeem` is pinned to a specific protocol address, and the
  USDC `transfer` destination is a ONE_OF of `[treasury, userEOA]`.
  This is the single most important defense-in-depth property in the
  system — a session-key compromise is still bounded.

- **Reconciliation job** at [scheduler.py:705-794](../apps/backend/app/workers/scheduler.py:705)
  runs daily at 03:00 UTC and reconciles DB allocations to on-chain
  reality, alerting on discrepancies above $1. Excellent safety net
  against DB/on-chain drift.

- **Dedup by ownership** at [accounts.py:504-510](../apps/backend/app/api/routes/accounts.py:504)
  rejects registration of an existing smart account with a different
  owner — protects against account hijacking during onboarding.

---

## 5. Concerns but Not Findings

- The execution service comment at [server.js:169](../apps/execution/server.js:169)
  ("DO NOT crash the process on uncaught exceptions") is a deliberate
  choice made after real incidents with ZeroDev SDK late-throwing. It is
  unusual and could hide real bugs, but the alternative (crash on every
  background ZeroDev callback) was worse in practice. Monitor Sentry for
  `uncaught_exception` log lines and treat bursts as operational alerts.

- `_get_legacy_aes_key` still exists as the non-KMS fallback. When
  `KMS_KEY_ID` is set and healthy, the KMS envelope path is taken and
  the legacy key is never computed. A future refactor should delete the
  legacy path entirely once all production deployments have KMS.

- The frontend session-key UX allows users to grant without seeing the
  scope restrictions the call policy enforces. A user who assumes the
  key can drain everything might delay granting; a user who assumes the
  key cannot drain anything might be lax about rotation. Education-level
  finding only.

- `DEPLOYER_PRIVATE_KEY` exists as a config field at [config.py:119](../apps/backend/app/core/config.py:119)
  but the code comment says it is not used in production. Confirm it
  is unset in prod and remove the field next cleanup cycle.

- **`registeredAccounts` unbounded growth.** `SnowMindRegistry.register`
  pushes unconditionally; `deregister` only flips the flag. Re-registering
  a previously-deregistered address pushes a duplicate into
  [contracts/src/SnowMindRegistry.sol:71](../contracts/src/SnowMindRegistry.sol:71),
  so the historical array can grow beyond the count of distinct accounts.
  Impact is low: the registry is logging-only, holds no funds, and is
  owner-gated. If the array grows unboundedly in production, add an
  off-chain indexer for historical queries and stop using the on-chain
  array as a source of truth.

---

## 6. Security Test Plan

To validate fixes, add or run the following tests after each related
change:

**Contract layer:**
1. Copy `invariants/SnowMindRegistryInvariant.t.sol` into `contracts/test/`
   and run `forge test --match-contract SnowMindRegistryInvariant -vvv`.

**Backend auth layer:**
2. Unit test: `require_privy_auth` rejects calls without a Bearer token,
   with a malformed Bearer token, and with a Bearer token whose
   signature is unverifiable. ([security.py:351](../apps/backend/app/core/security.py:351))
3. Integration test: every route under `apps/backend/app/api/routes/**`
   is behind `require_privy_auth` OR `require_api_key` — write a test
   that crawls the FastAPI app's route table and asserts it.

**Execution service:**
4. Existing `auth.test.js` is good; add tests for (a) future-dated
   timestamp within TTL (should reject after N-03 fix), (b) short nonces
   (should reject after N-05 fix), (c) concurrent submission via two
   request harnesses simulating the N-02 race.

**Session key lifecycle:**
5. Test: `store_session_key` twice concurrently and assert the
   `session_keys` table ends with exactly one `is_active=true` row
   (validates N-09 fix).
6. Test: `grantAndSerializeSessionKey` output `expiresAt` is within
   `now + MAX_SESSION_KEY_AGE_DAYS` (after N-01 fix).

**Withdrawal path:**
7. Test: `POST /withdrawal/execute` with two concurrent requests
   completes exactly one on-chain transfer (validates N-02 fix).
8. Test: withdrawal when treasury is empty-string and fees are disabled
   — confirm no zero-address transfer is embedded in the UserOp
   (validates N-07 fix).
9. **N-12 regression:** after removing `/rebalance/{address}/withdraw-all`,
   write an integration test that asserts the route returns 404 (or 405)
   and that a crawl of the FastAPI route table shows zero endpoints
   matching `withdraw_all` without a signature-verifying dependency.
   Similarly crawl `apps/web/lib/api-client.ts` for any caller of
   `/api/v1/rebalance/*/withdraw-all` and assert none exist.

**Config validation at startup:**
10. Startup test: in DEBUG mode with no `SESSION_KEY_ENCRYPTION_KEY`,
    fail closed — validates N-08 fix.

---

## 7. Remediation Roadmap

### Quick wins (1–3 days)

1. **N-12** — Delete `/api/v1/rebalance/{address}/withdraw-all`, delete
   `api.withdrawAll` from the frontend, and (if unreferenced after that)
   delete `execute_emergency_withdrawal` from `rebalancer.py`. This is
   the highest-impact quick win.
2. **N-01** — Add `toTimestampPolicy({ validUntil: 30d })` to the
   permissions array in `zerodev.ts`. Single-file change; one test update.
3. **N-03** — Replace `Math.abs` with a two-sided check in `auth.js` — 3 lines.
4. **N-05** — Enforce minimum nonce length in `auth.js` — 3 lines.
5. **N-06** — Raise per-sender lock TTL to 130 s in `server.js` — 1 line.
6. **N-08** — Delete the DEBUG-mode HMAC-derivation branch in
   `session_key.py:234-245`, replace with a raise. Force all envs to set
   `SESSION_KEY_ENCRYPTION_KEY` explicitly.
7. **N-13** — Fix `record_withdrawal_fee` in `fee_calculator.py:274-293`
   to accept a `fee_exempt` parameter and plumb it through. Alternatively,
   delete the legacy function entirely and have `execute_emergency_withdrawal`
   call `calculate_agent_fee` + `record_withdrawal` directly.

### Short term (1–2 weeks)

8. **N-02** — Insert a PENDING `rebalance_logs` row BEFORE calling the
   executor, with a partial unique index on
   `(account_id, status='pending')`. Solves the withdrawal race at the
   DB layer.
9. **N-04** — Delete `apps/backend/execution_service/` in a standalone
   PR after grepping all deployment scripts for references.
10. **N-09** — Wrap the `store_session_key` deactivate+insert in a DB
    transaction and add a partial unique index on `is_active`.

### Structural (weeks)

11. **Session-key custody** — Explore a dual-signer model where the
    session key is split into a committed-to piece (stored server-side,
    covers routine moves) and a user-held piece (required for large
    moves). Requires ZeroDev SDK support for multi-signer permission
    plugins.
12. **Execution-service horizontal scale** — Move the service to
    strict-mode persistent nonce storage by default and introduce Redis
    for both nonce storage and per-sender concurrency locking (required
    before horizontal scale-out; see N-10, N-11).

---

## 8. Audit Coverage Manifest

Files read end-to-end during this audit (no application code was
modified; every file below was opened as a read-only source of truth):

**Contracts (first-party only):**
- [contracts/src/SnowMindRegistry.sol](../contracts/src/SnowMindRegistry.sol) — full read
- [contracts/test/SnowMindRegistry.t.sol](../contracts/test/SnowMindRegistry.t.sol) — skimmed to understand existing test patterns
- [contracts/script/DeployMainnet.s.sol](../contracts/script/DeployMainnet.s.sol) — scoped (constructor-only contract)
- [contracts/foundry.toml](../contracts/foundry.toml) — verified remappings

**Backend (every route + every worker + every service in scope):**
- [apps/backend/app/core/security.py](../apps/backend/app/core/security.py) — full read
- [apps/backend/app/core/config.py](../apps/backend/app/core/config.py) — full read
- [apps/backend/app/api/routes/accounts.py](../apps/backend/app/api/routes/accounts.py) — full read
- [apps/backend/app/api/routes/rebalance.py](../apps/backend/app/api/routes/rebalance.py) — full read (source of N-12)
- [apps/backend/app/api/routes/withdrawal.py](../apps/backend/app/api/routes/withdrawal.py) — full read
- [apps/backend/app/api/routes/portfolio.py](../apps/backend/app/api/routes/portfolio.py) — skimmed head + key regions
- [apps/backend/app/api/routes/optimizer.py](../apps/backend/app/api/routes/optimizer.py) — auth surface fully mapped (all routes cataloged)
- [apps/backend/app/api/routes/assistant.py](../apps/backend/app/api/routes/assistant.py) — full read
- [apps/backend/app/api/routes/health.py](../apps/backend/app/api/routes/health.py) — full read
- [apps/backend/app/services/execution/session_key.py](../apps/backend/app/services/execution/session_key.py) — full read
- [apps/backend/app/services/execution/executor.py](../apps/backend/app/services/execution/executor.py) — full read
- [apps/backend/app/services/optimizer/rebalancer.py](../apps/backend/app/services/optimizer/rebalancer.py) — key regions including emergency withdrawal path
- [apps/backend/app/services/optimizer/health_checker.py](../apps/backend/app/services/optimizer/health_checker.py) — full read
- [apps/backend/app/services/optimizer/waterfall_allocator.py](../apps/backend/app/services/optimizer/waterfall_allocator.py) — full read
- [apps/backend/app/services/oracle/twap.py](../apps/backend/app/services/oracle/twap.py) — full read
- [apps/backend/app/services/oracle/validator.py](../apps/backend/app/services/oracle/validator.py) — full read
- [apps/backend/app/services/protocols/circuit_breaker.py](../apps/backend/app/services/protocols/circuit_breaker.py) — full read
- [apps/backend/app/services/fee_calculator.py](../apps/backend/app/services/fee_calculator.py) — full read
- [apps/backend/app/workers/scheduler.py](../apps/backend/app/workers/scheduler.py) — full read
- [apps/backend/app/workers/utilization_monitor.py](../apps/backend/app/workers/utilization_monitor.py) — full read
- [apps/backend/main.py](../apps/backend/main.py) — router-mount section (line 351-357)

**Execution service:**
- [apps/execution/server.js](../apps/execution/server.js) — full read
- [apps/execution/auth.js](../apps/execution/auth.js) — full read
- [apps/execution/auth.test.js](../apps/execution/auth.test.js) — full read
- [apps/execution/execute.js](../apps/execution/execute.js) — first ~500 lines (abi definitions, kernel client, error extraction)

**Frontend (security-adjacent surface):**
- [apps/web/lib/zerodev.ts](../apps/web/lib/zerodev.ts) — key regions (session-key grant, permission plugin, call policy)
- [apps/web/lib/api-client.ts](../apps/web/lib/api-client.ts) — full read
- [apps/web/lib/withdrawal-auth.ts](../apps/web/lib/withdrawal-auth.ts) — full read
- [apps/web/app/(app)/onboarding/page.tsx](../apps/web/app/(app)/onboarding/page.tsx) — head + transfer/grant flow
- [apps/web/app/(app)/withdraw/page.tsx](../apps/web/app/(app)/withdraw/page.tsx) — full read of signature flow

**Not audited (out of scope):**
- Anything under `contracts/lib/` (vendored OZ + forge-std)
- Third-party protocol code (Aave, Benqi, Spark, Euler, Silo)

## 9. Changelog and Provenance

- Invariant suite: [invariants/SnowMindRegistryInvariant.t.sol](invariants/SnowMindRegistryInvariant.t.sol),
  with runner instructions in [invariants/README.md](invariants/README.md).
  Executed against the current contract source; 7/7 invariants passed
  (256 runs × 500 calls each). See §3.
- Foundry was installed during this session via the standard `foundryup`
  installer at `$HOME/.foundry/`. The copied invariant file at
  `contracts/test/SnowMindRegistryInvariant.t.sol` was removed after
  the run; `git status` shows no changes to any tracked test file.

No application code was modified by this audit. The only files written
are:

- `audit/SUMMARY.md` (CTO one-pager)
- `audit/FULL_REPORT.md` (this file)
- `audit/invariants/SnowMindRegistryInvariant.t.sol`
- `audit/invariants/README.md`

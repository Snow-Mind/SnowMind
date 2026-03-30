# SnowMind Security Audit Report

**Date:** 2026-03-30
**Auditor:** Claude Opus 4.6 (automated security review)
**Scope:** First-party smart contracts, backend, execution service, frontend flows
**Commit:** `0346db4` (branch: `dev`)

---

## 1. Executive Summary

SnowMind is a yield optimization platform on Avalanche that manages user funds via Kernel v3.1 smart accounts with session keys. The system has **no critical direct fund-theft vulnerabilities** in the reviewed code, but carries **significant operational and infrastructure security risks** that could lead to unauthorized fund movement under specific compromise scenarios.

### Risk Posture: MODERATE-HIGH

### Top 3 Risks

1. **Shared API key exposed to frontend bypasses per-user authorization** -- The `NEXT_PUBLIC_BACKEND_API_KEY` is shipped to every browser. Combined with the `require_privy_auth` fallback accepting this key as `sub: "service"`, any user with browser DevTools can perform privileged operations (register accounts, store/revoke session keys, trigger rebalances) for ANY account.

2. **Session key encryption key derivable from Supabase service key** -- If `SESSION_KEY_ENCRYPTION_KEY` is not explicitly set, the AES key is HMAC-derived from `SUPABASE_SERVICE_KEY`. Compromise of the Supabase key (which has broad DB access) also compromises all encrypted session keys, enabling unauthorized fund movement within session-key scope.

3. **Execution service HMAC replay after restart** -- The nonce replay map is in-memory. Every service restart (common on Railway) clears the map, allowing replay of previously captured authenticated requests within the 300s TTL window.

---

## 2. Threat Model

### Assets
- User USDC deposited in lending protocols via smart accounts
- Session key material (serialized permissions + private keys)
- Encryption keys (SESSION_KEY_ENCRYPTION_KEY, KMS data keys)
- Shared secrets (INTERNAL_SERVICE_KEY, BACKEND_API_KEY)

### Actors
- **User:** Wallet owner, interacts via frontend
- **Backend service:** Python FastAPI, manages session keys and rebalance logic
- **Execution service:** Node.js, submits UserOps to bundler
- **Scheduler:** Cron-like worker, triggers periodic rebalances
- **Attacker:** External party with network access, stolen credentials, or malicious frontend

### Trust Boundaries
1. Frontend <-> Backend: Privy JWT + API key fallback
2. Backend <-> Execution service: HMAC-signed requests + shared key header
3. Execution service <-> ZeroDev bundler: Session key permissions
4. Smart account <-> DeFi protocols: On-chain call policies

---

## 3. Findings

### Finding F-01: Frontend-Exposed API Key Bypasses Per-User Authorization

| Field | Value |
|---|---|
| **Severity** | HIGH |
| **Affected Files** | `apps/backend/app/core/security.py:136-163`, `apps/web/lib/api-client.ts:42` |
| **Root Cause** | `require_privy_auth` accepts shared `BACKEND_API_KEY` as authentication, returning `sub: "service"`. `verify_account_ownership` unconditionally trusts `service` callers. The key is exposed via `NEXT_PUBLIC_BACKEND_API_KEY`. |

**Exploit Scenario:**
1. Attacker opens browser DevTools on snowmind.xyz and extracts `NEXT_PUBLIC_BACKEND_API_KEY` from the JS bundle.
2. Attacker calls `POST /api/v1/accounts/{victim_address}/session-key/revoke` with `X-API-Key` header.
3. Victim's session key is revoked, causing fund lockup (funds idle, no rebalancing).
4. Alternatively, attacker calls `PUT /api/v1/accounts/{victim_address}/diversification-preference` to manipulate allocation strategy.

**Impact:** Session key revocation for any account (denial of service); manipulation of account preferences; account enumeration. Actual fund theft requires additionally compromising session key material.

**Fix:**
- Remove API key fallback from `require_privy_auth` for user-facing endpoints.
- Create a separate `require_service_auth` dependency for internal/service endpoints.
- Never ship `BACKEND_API_KEY` to the frontend. Use Privy tokens exclusively for user auth.

---

### Finding F-02: Session Key Encryption Key Derived from Supabase Service Key

| Field | Value |
|---|---|
| **Severity** | HIGH |
| **Affected Files** | `apps/backend/app/services/execution/session_key.py:63-100` |
| **Root Cause** | When `SESSION_KEY_ENCRYPTION_KEY` is not set, the AES-256 key is deterministically derived from `SUPABASE_SERVICE_KEY` via HMAC-SHA256 with a static label `snowmind-session-key-encryption-v1`. |

**Exploit Scenario:**
1. Attacker obtains `SUPABASE_SERVICE_KEY` (leaked in logs, env dump, Supabase dashboard compromise, or shared credential store).
2. Attacker derives the AES key: `HMAC-SHA256(supabase_key, "snowmind-session-key-encryption-v1")`.
3. Attacker queries Supabase directly to read encrypted session keys from `session_keys` table.
4. Attacker decrypts all session keys and obtains serialized permissions + private keys.
5. Attacker submits UserOps via ZeroDev bundler to move funds within session key scope.

**Impact:** Complete compromise of all session keys and user fund movement within session-key permission scope.

**Fix:**
- Always set `SESSION_KEY_ENCRYPTION_KEY` as an independent, randomly generated 32-byte hex value in production.
- Remove the auto-derivation fallback or at minimum emit an error (not warning) in production mode.
- Migrate to KMS-only encryption in production (`KMS_KEY_ID`).
- Add startup check that refuses to boot in production without explicit `SESSION_KEY_ENCRYPTION_KEY` or `KMS_KEY_ID`.

---

### Finding F-03: Execution Service HMAC Nonce Replay After Restart

| Field | Value |
|---|---|
| **Severity** | HIGH |
| **Affected Files** | `apps/execution/server.js:11`, `apps/execution/auth.js:3-9,60-61` |
| **Root Cause** | `recentNonces` is an in-memory `Map`. On service restart, all nonces are lost. Any request captured within the TTL window (300s) can be replayed. |

**Exploit Scenario:**
1. Attacker captures a legitimate backend-to-execution-service request (e.g., via compromised reverse proxy, network tap, or log exposure).
2. Attacker waits for execution service restart (Railway redeploys, OOM kill, or triggers a crash via large payload).
3. Attacker replays the captured request with the same timestamp, nonce, and signature.
4. Execution service accepts it because the nonce map is empty.

**Impact:** Replay of any rebalance or withdrawal operation. Could cause duplicate fund movements or trigger unwanted rebalances.

**Fix:**
- Store nonces in a persistent store (Redis or Supabase) with TTL-based expiry.
- Alternatively, use strictly-increasing counters per sender instead of random nonces.
- Add a monotonic timestamp check (reject if timestamp <= last seen timestamp for this sender).

---

### Finding F-04: Internal Service Key Sent as Plaintext Header

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **Affected Files** | `apps/backend/app/services/execution/executor.py:29`, `apps/execution/auth.js:38-40` |
| **Root Cause** | The HMAC shared secret is sent as `x-internal-key` header in every request, alongside the HMAC signature. The auth code checks BOTH the key AND the signature, but the key alone is sufficient for identity (line 39: `headers["x-internal-key"] !== key`). |

**Exploit Scenario:**
1. Attacker captures any single request between backend and execution service.
2. `x-internal-key` header contains the raw shared secret.
3. Attacker can now forge new requests with valid HMAC signatures.

**Impact:** The HMAC signing provides no additional security over the plaintext key. Any single request capture compromises the shared secret permanently.

**Fix:**
- Remove `x-internal-key` from request headers.
- Rely solely on the HMAC signature for authentication.
- If a static key check is needed, use a separate, non-secret identifier (e.g., service name) rather than the HMAC key itself.

---

### Finding F-05: Distributed Lock Race Condition in Scheduler

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **Affected Files** | `apps/backend/app/workers/scheduler.py:100-119` |
| **Root Cause** | `_acquire_lock` uses Supabase upsert then a separate read to verify. Between the upsert and the verification read, another instance can overwrite the holder. Both instances may then see themselves as the holder. |

**Exploit Scenario:**
1. Two Railway instances trigger `_run_with_lock` simultaneously.
2. Instance A upserts lock with holder=A.
3. Instance B upserts lock with holder=B (overwrites A's holder).
4. Instance A reads lock -- sees holder=B, fails.
5. Instance B reads lock -- sees holder=B, succeeds.
6. BUT: in a different timing scenario, both can succeed if reads interleave with upserts.

**Impact:** Concurrent rebalance execution for the same accounts. The per-sender guard in the execution service mitigates double-submission for a single account, but processing the same account set twice wastes resources and could cause ordering issues.

**Fix:**
- Use Supabase RPC with a PostgreSQL advisory lock or `INSERT ... ON CONFLICT DO NOTHING` with a conditional check.
- Or use Redis `SET NX EX` for atomic lock acquisition.
- Ensure the lock acquire is a single atomic operation.

---

### Finding F-06: No Ownership Check on GET /accounts/{address}

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **Affected Files** | `apps/backend/app/api/routes/accounts.py:315-379` |
| **Root Cause** | `get_account` requires authentication but does not verify the caller owns the account. Any authenticated user (or API key holder) can query any account's details including session key status, allowed protocols, and creation time. |

**Exploit Scenario:**
1. Attacker authenticates with their own Privy account.
2. Iterates over known/guessed smart account addresses.
3. Retrieves session key metadata (active status, expiry, allowed protocols) for all accounts.

**Impact:** Information disclosure. Attacker learns which accounts have active session keys, their expiry times, and which protocols they use. Useful for targeted attacks or competitive intelligence.

**Fix:**
- Add `verify_account_ownership(auth_claims, account_row, db=db)` after fetching the account.
- Or return only minimal public info without session key details for non-owners.

---

### Finding F-07: Legacy Privy DID Backfill First-Claim Race

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **Affected Files** | `apps/backend/app/core/security.py:208-225` |
| **Root Cause** | When a legacy account has no `privy_did`, the first authenticated request backfills it. If an attacker authenticates before the legitimate owner, they claim ownership. |

**Exploit Scenario:**
1. Attacker discovers a legacy account address (no `privy_did` in DB).
2. Attacker creates a Privy account and calls `GET /api/v1/accounts/{address}`.
3. `verify_account_ownership` sees no stored DID, backfills attacker's DID.
4. Legitimate owner is now permanently locked out of their account management.

**Impact:** Permanent ownership takeover of legacy accounts for management operations. Does not directly steal funds (session key is separate) but blocks legitimate key management (revocation, renewal).

**Preconditions:** Requires legacy accounts with no privy_did set. New accounts created through the current flow always have privy_did.

**Fix:**
- Remove automatic backfill on read endpoints.
- Only backfill privy_did during write operations that require wallet signature verification.
- Or require a signed challenge to claim a legacy account.

---

### Finding F-08: Session Key Private Key Stored Server-Side

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **Affected Files** | `apps/backend/app/services/execution/session_key.py:240-244`, `apps/web/lib/zerodev.ts` |
| **Root Cause** | The session key's private key is generated client-side, sent to the backend, and stored encrypted in the DB. This gives the backend unilateral ability to submit UserOps without further user interaction. |

**Exploit Scenario:**
1. Attacker compromises the backend server (RCE, dependency supply chain attack).
2. Decrypts session keys (if encryption key is also compromised per F-02).
3. Submits UserOps to move funds within session key scope (supply/withdraw to allowed protocols, transfer to treasury address).

**Impact:** Design trade-off (needed for automated rebalancing), but increases blast radius of backend compromise.

**Fix (Hardening):**
- Ensure session key call policies are as restrictive as possible (already done -- scoped to specific protocols and functions).
- Ensure `transfer()` calls are scoped only to the treasury address in the call policy.
- Add monitoring for unusual session key usage patterns (already partially implemented via `detect_unusual_activity`).
- Consider threshold-based alerts for large fund movements.

---

### Finding F-09: Smart Contract -- registeredAccounts Grows Unboundedly

| Field | Value |
|---|---|
| **Severity** | LOW |
| **Affected Files** | `contracts/src/SnowMindRegistry.sol:61-62,117-129` (test) |
| **Root Cause** | `registeredAccounts` is append-only. Deregister + re-register pushes the same address again. No mechanism to clean up. |

**Impact:** Unbounded storage growth. No immediate security impact since the array is not iterated on-chain, but affects off-chain indexing and increases storage costs over time.

**Fix:**
- Track whether an address was ever registered using the `registeredAt != 0` pattern and skip re-push.
- Or document that `registeredAccounts` is a historical log (already implied by "append-only historical list" comment).

---

### Finding F-10: Execution Service Swallows Uncaught Exceptions

| Field | Value |
|---|---|
| **Severity** | LOW |
| **Affected Files** | `apps/execution/server.js:58-89` |
| **Root Cause** | `process.on('uncaughtException')` and `process.on('unhandledRejection')` log but don't crash. While intentional for ZeroDev SDK stability, this means genuine corruption or invariant violations won't terminate the process. |

**Impact:** Process may continue in a corrupt state, potentially executing operations with stale or invalid data.

**Fix:**
- Track exception frequency. If more than N exceptions in M seconds, trigger graceful shutdown.
- Or use a process manager that monitors error rate and restarts proactively.

---

### Finding F-11: CORS Allows Localhost Origins

| Field | Value |
|---|---|
| **Severity** | LOW |
| **Affected Files** | `apps/backend/app/core/config.py:22-27` |
| **Root Cause** | `ALLOWED_ORIGIN_REGEX` includes `localhost` and `127.0.0.1` patterns. In production, this could allow locally-running attacker code to make authenticated cross-origin requests if the user has a valid session. |

**Impact:** Minimal in practice (attacker needs local code execution on victim's machine), but violates defense-in-depth.

**Fix:**
- Use environment-specific CORS config. Strip localhost patterns in production.

---

### Finding F-12: Profitability Gate Disabled

| Field | Value |
|---|---|
| **Severity** | INFORMATIONAL |
| **Affected Files** | `apps/backend/app/services/optimizer/rebalancer.py:885-897` |
| **Root Cause** | The profitability gate (step 8b) is commented out "for testing." This allows rebalances that cost more in gas than they earn, reducing user returns. |

**Impact:** Economic inefficiency. Not a security vulnerability but affects user trust and fund performance.

**Fix:**
- Re-enable before production launch with appropriate thresholds.

---

### Finding F-13: Smart Contract Lacks Emergency Pause

| Field | Value |
|---|---|
| **Severity** | INFORMATIONAL |
| **Affected Files** | `contracts/src/SnowMindRegistry.sol` |
| **Root Cause** | No `pause()` / `unpause()` mechanism. If a vulnerability is discovered, there's no way to halt operations without deploying a new contract. |

**Impact:** The registry is event-logging only (no fund custody), so impact is limited. But best practice for any owner-gated contract.

**Fix:**
- Add OpenZeppelin `Pausable` with `whenNotPaused` modifier on `register`, `deregister`, and `logRebalance`.

---

### Finding F-14: No Update-Preference Ownership Check

| Field | Value |
|---|---|
| **Severity** | MEDIUM |
| **Affected Files** | `apps/backend/app/api/routes/accounts.py:567-597` |
| **Root Cause** | `update_diversification_preference` endpoint requires authentication but does NOT call `verify_account_ownership`. Any authenticated user can change any account's diversification preference. |

**Impact:** Attacker can manipulate another user's allocation strategy (e.g., force concentration into a single protocol), affecting their yield optimization.

**Fix:**
- Add ownership verification after fetching the account.

---

## 4. No Finding But Concern

### 4.1 ZeroDev SDK Dependency Risk
The entire fund movement pipeline depends on ZeroDev's SDK, bundler, and paymaster infrastructure. A ZeroDev outage or breaking change blocks all rebalances and withdrawals. The codebase has extensive workarounds for ZeroDev quirks (mode selection, enable/regular mode, nonce key construction), suggesting high coupling and fragility.

### 4.2 Single Encryption Envelope for Permission + Private Key
Storing both the serialized permission and the session private key in a single encrypted envelope means a single decryption exposes everything needed to submit UserOps. Consider encrypting them separately with different keys or splitting access.

### 4.3 Paymaster Sponsorship Abuse
An attacker who can trigger rebalances (via F-01) can cause paymaster gas spending for no legitimate purpose. The paymaster balance check exists but doesn't gate individual operations.

### 4.4 DB-as-Source-of-Truth vs On-Chain
The system has extensive reconciliation logic because DB and on-chain state can diverge. This is inherent to the architecture but represents ongoing operational risk. Any reconciliation bug could cause phantom withdrawals or missed positions.

### 4.5 Smart Contract is Logging-Only
SnowMindRegistry does NOT custody funds or enforce access control on fund movements. All fund operations go through session keys and the smart account directly. The registry is purely an audit trail. This is a good security property but means the on-chain audit trail can be skipped if the backend chooses not to call `logRebalance`.

---

## 5. Security Test Plan

### 5.1 For F-01 (API Key Bypass)
- [ ] Verify that removing `X-API-Key` from request still works with valid Privy token
- [ ] Verify that `X-API-Key` alone does NOT satisfy `require_privy_auth` on user endpoints
- [ ] Test that service-to-service calls use a separate auth mechanism

### 5.2 For F-02 (Encryption Key Derivation)
- [ ] Verify production environment has `SESSION_KEY_ENCRYPTION_KEY` or `KMS_KEY_ID` set
- [ ] Verify application fails to start without explicit encryption config in production
- [ ] Test that changing `SUPABASE_SERVICE_KEY` does NOT affect session key decryption when `SESSION_KEY_ENCRYPTION_KEY` is set

### 5.3 For F-03 (Nonce Replay)
- [ ] Capture a valid request, restart execution service, replay -- should be rejected
- [ ] Test with persistent nonce store (Redis/DB) after fix

### 5.4 For F-04 (Internal Key Header)
- [ ] Verify auth works without `x-internal-key` header after fix
- [ ] Test that forged requests without valid HMAC are rejected

### 5.5 For F-05 (Lock Race)
- [ ] Simulate concurrent scheduler starts and verify only one acquires the lock
- [ ] Test lock expiry and re-acquisition

### 5.6 For F-06 & F-14 (Missing Ownership Checks)
- [ ] Call GET /accounts/{other_user_address} with attacker's Privy token -- should be denied
- [ ] Call PUT /accounts/{other_user_address}/diversification-preference -- should be denied

### 5.7 For F-07 (DID Backfill Race)
- [ ] Create legacy account without privy_did, attempt claim from two different Privy users -- only first should succeed (or neither without explicit claim flow)

### 5.8 General
- [ ] Run Foundry fuzz tests for SnowMindRegistry (already present -- verify coverage)
- [ ] Test withdrawal flow end-to-end with session key that excludes target protocol
- [ ] Test rebalance with concurrent requests for same account
- [ ] Verify session key expiry is enforced at execution time (not just DB lookup)

---

## 6. Prioritized Remediation Roadmap

### Quick Wins (1-2 days)
1. **F-01:** Remove API key from frontend bundle; separate service auth from user auth
2. **F-04:** Remove `x-internal-key` header from executor requests
3. **F-06:** Add ownership check to GET /accounts/{address}
4. **F-14:** Add ownership check to PUT diversification-preference
5. **F-11:** Strip localhost from CORS in production config
6. **F-12:** Re-enable profitability gate

### Short-Term (1 week)
7. **F-02:** Add startup validation requiring explicit encryption key in production
8. **F-03:** Move nonce store to Redis or Supabase for persistence across restarts
9. **F-07:** Replace auto-backfill with explicit account claiming flow
10. **F-05:** Replace Supabase upsert lock with atomic PostgreSQL advisory lock

### Structural (2-4 weeks)
11. **F-02:** Migrate to KMS-only encryption; remove local AES fallback
12. **F-08:** Explore MPC or threshold signing to avoid server-side private key storage
13. **F-13:** Add Pausable to SnowMindRegistry (requires redeployment)
14. Add rate-based process health monitoring for execution service (F-10)

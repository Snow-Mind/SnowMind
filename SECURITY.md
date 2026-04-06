# Security Policy

## Threat Model

SnowMind is a non-custodial yield optimizer. The core security design ensures that even if the SnowMind backend is fully compromised, user funds cannot be stolen.

### What the Session Key CAN Do

The AI agent's session key is scoped to:

- Call whitelisted protocol methods only (Aave V3 `supply/withdraw`, Benqi `mint/redeem`, Spark `deposit/redeem`, Euler V2 `deposit/redeem`, Silo `deposit/redeem`)
- Execute a **maximum number of transactions per day** (rate-limited on-chain)
- Operate only while the user has not revoked it (session keys have infinite on-chain lifetime; revocation is immediate)

### What the Session Key CANNOT Do

- Transfer tokens to arbitrary addresses (only user-owner sweep and treasury transfer are allowed)
- Call any contract not on the whitelist
- Call any function not on the whitelist (e.g., `borrow()`, `liquidate()`, `approve()`)
- Exceed the per-transaction or per-day limits
- Operate after the user revokes it (revocation is immediate, on-chain)

### Worst-Case Scenario

If the SnowMind backend is fully compromised and the attacker gains access to the encrypted session key:

1. Attacker decrypts the session key (requires breaking AES-256-GCM)
2. Attacker can only supply/withdraw to Aave V3, Benqi, Spark, Euler V2, or Silo — cannot transfer funds
3. Worst outcome: suboptimal allocations (funds moved between approved protocols)
4. User revokes session key from their wallet — immediate on-chain effect
5. User withdraws all funds from protocols directly using their master key

**Funds are never at risk of theft through the session key mechanism.**

### Rate Manipulation Protection

- All rates are **TWAP-smoothed** over a 15-minute window (not spot reads)
- Rates are **cross-validated** against DefiLlama API as a soft signal (logged, not a hard gate)
- If divergence exceeds 2%, it is logged as a warning for monitoring
- Any rate above **25% APY** triggers an alert and halts auto-rebalancing
- Minimum 2 consecutive TWAP reads required before any rebalance

### On-Chain Safety Constraints

- **15% TVL cap**: Allocator constraint prevents over-allocation to any single lending pool's liquidity (Aave/Benqi). ERC-4626 vaults (Spark, Euler, Silo) have no TVL cap.
- **Deposit-tier cadence gate**: Minimum time between optimizer runs scales by principal size (<= $3,000: 12h, <= $10,000: 4h, <= $100,000: 2h, > $100,000: 1h)
- **Net-positive gate**: Rebalance only executes if improvement exceeds gas costs

## Emergency Procedures

### User Emergency (Panic Button)

1. Go to **Settings** in the SnowMind app
2. Click **"Revoke Session Key"** — takes effect immediately on-chain
3. The optimizer can no longer execute any transactions
4. Withdraw funds directly from Aave V3/Benqi/Spark/Euler/Silo using your wallet (MetaMask)

### This Works Even If SnowMind Is Down

Your master key (MetaMask/Privy) can always interact with your smart account directly. The SnowMind backend is **never required** for emergency withdrawal.

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email: **security@snowmind.app** (or open a private security advisory on GitHub)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a timeline for resolution.

## Scope

The following are in scope for security reports:

- Smart account session key bypass
- Unauthorized fund movement
- Rate manipulation leading to loss
- Backend API authentication bypass
- Session key encryption weakness
- Cross-site scripting (XSS) in the frontend
- SQL injection in Supabase queries

## Out of Scope

- Protocol-level bugs in Aave V3, Benqi, Spark, Euler, or Silo (report to those teams)
- Social engineering attacks
- Denial of service (unless demonstrating a novel vector)
- Issues in third-party dependencies with known CVEs (report upstream)

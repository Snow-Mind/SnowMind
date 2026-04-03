# Snow Mind Protocol Risk Scoring Framework

## Overview

This document defines how Snow Mind evaluates and scores the risk of each supported protocol. The scoring system serves two purposes:

1. **User-facing**: A visible score (out of 10) on the protocol selection page so users can quickly assess risk at a glance.
2. **AI assistant context**: The breakdown behind the score, which the AI assistant uses to explain *why* a protocol scored the way it did when users ask.

Scores are not used for rebalancing decisions — Snow Mind's optimization engine has its own separate logic for that. This scoring is purely to help users decide which protocols to activate.

---

## Hard Filters

Every protocol must pass all of the following to be listed on Snow Mind. These are non-negotiable.

| Filter | Requirement |
|--------|-------------|
| Audit | At least 1 completed security audit |
| Exploit history | No exploits in the past 12 months |
| Source code | Verified and published on a block explorer (e.g. Snowtrace) |

If a protocol fails any hard filter, it is excluded entirely — no score is given and it does not appear on the protocol selection page.

---

## Scoring Categories (10 points max)

### 1. Protocol Safety (max 3 points)

How secure and trustworthy is the protocol itself?

| Check | Points | Details |
|-------|--------|---------|
| Audited | 1 | At least 1 completed audit from a recognized firm |
| No exploit history ever | 1 | The protocol has never been exploited across any deployment or version |
| Governance structure | 1 | Protocol is governed by a DAO multisig or has immutable/timelocked contracts. Score 0 if controlled by a single EOA without safeguards |

**Notes:**
- Exploit history considers all versions. If a protocol's v1 was exploited but v2 is a full rewrite, it still loses the point — the team's track record matters.
- Governance check looks at who can change protocol parameters (interest rate models, collateral factors, etc.) and whether there are timelocks or multisig requirements.

### 2. Liquidity (max 3 points)

🔄 **Check every 24 hours**

How much capital is in the protocol and how reliable is access to it?

| Check | Points | Details |
|-------|--------|---------|
| TVL > $10M | 3 | Large, established pool with deep liquidity |
| TVL > $1M | 2 | Moderate liquidity, sufficient for most deposit sizes |
| TVL > $500K | 1 | Smaller pool, limited capacity |
| TVL < $500K | 0 | Very small, deposits may significantly impact rates |

**Notes:**
- TVL is measured as the total USDC deposited in the specific market/vault Snow Mind interacts with, not the protocol's overall TVL across all assets and chains.
- TVL should be refreshed every 24 hours. A sustained drop in TVL (e.g. 30%+ decline over 7 days) should trigger a flag for manual review.

### 3. Collateral Quality (max 2 points)

What assets are borrowers posting as collateral against the USDC that Snow Mind lends?

| Check | Points | Details |
|-------|--------|---------|
| Blue chip only or N/A | 2 | Collateral is BTC, ETH, USDC, or other major assets. Also applies to non-lending protocols (e.g. Spark) where there is no direct collateral exposure |
| Mixed or yield-bearing stablecoins | 1 | Collateral includes yield-bearing assets like sUSDe, savUSD, sAVAX alongside blue chip. These carry additional depeg or strategy risk |
| Exotic or synthetic only | 0 | Collateral is entirely composed of newer, less proven synthetic or algorithmic assets |

**Notes:**
- For non-lending protocols like Spark Savings, score 2 (N/A) because users don't have direct exposure to borrower collateral. The risk is different (governance/backing risk) and the AI assistant should explain this distinction.
- For curated vaults like Euler 9Summits, evaluate the collateral accepted across the underlying lending markets the curator allocates to.

### 4. Yield Profile (max 2 points)

🔄 **Check every 24 hours**

How sustainable and predictable is the yield?

| Check | Points | Details |
|-------|--------|---------|
| Organic and stable | 2 | Yield comes from real borrower interest or protocol-set rates (e.g. DSR). 30-day APY has low variance |
| Organic but volatile | 1 | Yield is from real lending activity but fluctuates significantly due to high utilization, rate curve dynamics, or frequent supply/demand shifts |
| Mostly incentive-driven | 0 | Yield is primarily from token incentive programs (e.g. AVAX rewards, governance token emissions) that can end at any time |

**Notes:**
- APY stability should be checked every 24 hours. Compare the current APY to the 7-day and 30-day averages.
- If a protocol's APY is a combination of organic yield + incentives, score based on the organic portion. If organic yield alone would be competitive, score 1 or 2. If removing incentives would make it unattractive, score 0.

### 5. Architecture (max 1 point)

How directly does Snow Mind interact with the yield source?

| Check | Points | Details |
|-------|--------|---------|
| Direct deposit | 1 | Snow Mind deposits USDC directly into the lending pool or savings contract. No intermediary manages the allocation |
| Through curator or wrapper | 0 | Deposit goes through an additional layer (vault curator, meta-vault, savings wrapper) that makes allocation decisions on behalf of depositors |

**Notes:**
- This captures additional trust dependencies. A curated vault means trusting both the underlying protocol AND the curator's risk management decisions.
- Spark scores 0 here because USDC goes through a savings wrapper into Sky Protocol's DSR — there's a conversion and protocol dependency layer.
- Euler 9Summits scores 0 because a curator decides which underlying lending markets receive the capital.
- Direct lending on Aave, Benqi, or Silo scores 1 because Snow Mind controls the deposit directly.

---

## Current Protocol Scores

| Protocol | Safety (/3) | Liquidity (/3) | Collateral (/2) | Yield (/2) | Architecture (/1) | Total (/10) |
|----------|-------------|----------------|------------------|------------|-------------------|-------------|
| Aave V3 | 3 | 3 | 2 | 2 | 1 | **10** |
| Spark Savings | 3 | 3 | 2 | 2 | 0 | **9** |*
| Benqi Lending | 3 | 3 | 2 | 2 | 1 | **10** |
| Silo (savUSD/USDC) | 3 | 2 | 1 | 1 | 1 | **8** |
| Silo (sUSDp/USDC) | 2 | 1 | 1 | 1 | 1 | **6** |
| Euler (9Summits) | 2 | 2 | 1 | 1 | 0 | **6** |

*Aave and Benqi both score 10 but for different reasons — the AI assistant should explain this when asked.

### Score Justifications

**Aave V3 (10/10)**
- Safety 3: Multiple audits (Trail of Bits, OpenZeppelin, others), no exploits, DAO governance with timelocks.
- Liquidity 3: ~$21M USDC TVL on Avalanche.
- Collateral 2: Blue chip collateral (ETH, BTC, AVAX).
- Yield 2: Organic lending interest, stable rates.
- Architecture 1: Direct deposit into lending pool.

**Spark Savings (9/10)**
- Safety 3: Audited, no exploits, governed by Sky Protocol (formerly MakerDAO) DAO.
- Liquidity 3: ~$114M USDC TVL.
- Collateral 2: N/A — not a lending market, no direct collateral exposure.
- Yield 2: Rate set by Sky governance, very stable.
- Architecture 0: USDC is wrapped through a savings layer into Sky Protocol's DSR.

**Benqi Lending (10/10)**
- Safety 3: Audited, no exploits, Avalanche-native with established governance.
- Liquidity 3: Deep Avalanche USDC liquidity and mature market depth.
- Collateral 2: Blue chip collateral (AVAX, BTC, ETH).
- Yield 2: Organic lending interest, stable rates.
- Architecture 1: Direct deposit into lending pool.

**Silo savUSD/USDC (8/10)**
- Safety 3: Audited, formally verified, no exploits, DAO multisig governance.
- Liquidity 2: ~$1M USDC TVL.
- Collateral 1: savUSD is a yield-bearing stablecoin from Avant Protocol (delta-neutral strategies). Carries depeg and strategy risk.
- Yield 1: Organic but volatile — rate depends on utilization in an isolated two-asset market.
- Architecture 1: Direct deposit into Silo lending pool.

**Silo sUSDp/USDC (6/10)**
- Safety 2: Newer market profile with shorter production history than core venues.
- Liquidity 1: ~$462K USDC available. Very new market with limited history.
- Collateral 1: sUSDp is a yield-bearing stablecoin from Parallel Protocol. Smaller market cap, less proven.
- Yield 1: Organic but newly launched — insufficient historical data to confirm stability.
- Architecture 1: Direct deposit into Silo lending pool.

**Euler 9Summits (6/10)**
- Safety 2: Euler v2 is audited, but Euler v1 suffered a $197M exploit in March 2023. Full rebuild, but history counts.
- Liquidity 2: ~$4M USDC TVL.
- Collateral 1: Accepts yield-bearing stablecoins (sUSDe at 90% LTV with tight 2.5% liquidation buffer) alongside blue chip assets.
- Yield 1: Organic lending yield but volatile — utilization sits at ~91% near the rate curve kink, causing rate swings.
- Architecture 0: Deposit goes through 9Summits as curator of an Euler Earn vault. Curator decides allocation across underlying markets.

---

## 24-Hour Monitoring Checklist

The following data points should be refreshed every 24 hours for each active protocol. Changes may trigger a score update.

### Liquidity Monitoring
- [ ] Current TVL — has it crossed a scoring threshold ($500K, $1M, $10M)?
- [ ] TVL trend — has TVL dropped more than 10% in the past 7 days?
- [ ] Available withdrawal liquidity — is there enough USDC available for Snow Mind to exit its position?
- [ ] Utilization rate — is it approaching dangerous levels (>90%)?

### Yield Monitoring
- [ ] Current APY vs 7-day average — has it deviated more than 50%?
- [ ] Current APY vs 30-day average — is the trend up or down?
- [ ] Incentive programs — have any reward programs started or ended?
- [ ] APY source breakdown — what portion is organic vs incentives?

### Collateral Monitoring (for lending protocols with non-blue-chip collateral)
- [ ] Collateral peg status — is savUSD, sUSDp, sUSDe, etc. maintaining its peg?
- [ ] Collateral TVL — has the underlying collateral protocol's TVL changed significantly?
- [ ] Collateral redemption status — are redemptions functioning normally?

### Protocol Health
- [ ] Any new security incidents or exploit reports?
- [ ] Governance proposals that change risk parameters?
- [ ] Smart contract upgrades or migrations announced?

---

## How the AI Assistant Uses This

When a user asks "why does this protocol score X?" or "which protocols should I activate?", the AI assistant should:

1. Reference the specific category scores and explain what each means in plain language.
2. Highlight which factors are most relevant to that user's situation (e.g. deposit size affects liquidity risk).
3. Explain tradeoffs honestly — higher yield protocols score lower for a reason, but that doesn't mean they're bad choices for users who understand the risk.
4. Never recommend a specific allocation — help users understand the risks so they can make their own informed decision.

The scoring is a starting point for conversation, not a final verdict.

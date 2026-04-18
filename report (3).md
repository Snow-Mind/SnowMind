# SnowMind Protocol Risk Assessment Report

> Last updated: 2026-04-06
> This document serves as a reference for the SnowMind AI assistant to help users understand and compare protocol risks.

---

## Scoring Framework (Max 9 Points)

### Hard Filters (Pass/Fail — must pass ALL to be listed)

| Filter | Requirement |
|---|---|
| **Audit** | At least 1 completed security audit from a recognized firm |
| **Exploit History** | No exploits in the past 12 months (any version/deployment) |
| **Source Code** | Verified and published on a block explorer |

> Protocols that fail any hard filter are excluded entirely. No score is assigned.

### Scoring Categories

| # | Category | Max Points | Data Source |
|---|---|---|---|
| 1 | Oracle Quality | 2 | Manual review |
| 2 | Liquidity | 3 | On-chain (updated daily) |
| 3 | Collateral Quality | 2 | Manual review |
| 4 | Yield Profile | 1 | On-chain (updated daily) |
| 5 | Architecture | 1 | Manual review |
| | **Total** | **9** | |

---

### 1. Oracle Quality (Max 2 Points)

| Points | Criteria |
|---|---|
| **2** | Industry-standard oracle (Chainlink, Chronicle, Pyth, Edge/Chaos Labs) with multi-source aggregation and on-chain verifiable configuration. OR no external oracle dependency (e.g., rate set by protocol governance). |
| **1** | Reputable oracle provider, but with trust assumptions: oracle selection controlled by a third party (e.g., curator), single price source with no fallback, or limited battle-testing at scale. |
| **0** | Custom/proprietary oracle, TWAP on low-liquidity pool, no fallback mechanism, or oracle logic not publicly verifiable on-chain. |

### 2. Liquidity (Max 3 Points)

> Measured as TVL (USDC) in the specific market/vault only, not protocol-wide. Updated every 24 hours from on-chain data.

| Points | Criteria |
|---|---|
| **3** | TVL > $10M (deep liquidity) |
| **2** | TVL > $1M (sufficient capacity) |
| **1** | TVL > $500K (limited capacity) |
| **0** | TVL < $500K (may impact withdrawal rates) |

### 3. Collateral Quality (Max 2 Points)

| Points | Criteria |
|---|---|
| **2** | Blue-chip / N/A — BTC, ETH, USDC, or other major assets. OR no collateral risk (e.g., savings vault). |
| **1** | Mixed / yield-bearing — includes assets like sUSDe, stETH with depeg or slashing risk. |
| **0** | Exotic / synthetic — newer, unproven, or highly volatile collateral. |

### 4. Yield Profile (Max 1 Point)

> Updated every 24 hours from on-chain data. All listed protocols have organic yield (from real borrower interest), since SnowMind only reads base lending rates, not token incentives.

| Points | Criteria |
|---|---|
| **1** | Organic & stable — 30-day APY standard deviation is less than 30% of the mean APY. |
| **0** | Organic but volatile — 30-day APY standard deviation is 30% or more of the mean APY. |

### 5. Architecture (Max 1 Point)

| Points | Criteria |
|---|---|
| **1** | Direct deposit — USDC deposited directly into the lending pool or vault. |
| **0** | Through curator/wrapper — additional intermediary contract layer between SnowMind and the yield source. |

---

## Protocol Assessments

### Aave V3 (Avalanche)

| Category | Points | Notes |
|---|---|---|
| Oracle Quality | 2/2 | Chainlink multi-source feeds, governance-controlled, with fallback oracle |
| Liquidity | /3 | Dynamic — fetched every 24 hours from on-chain TVL |
| Collateral Quality | 1/2 | Mixed — mostly blue-chip but exotic assets (USDe, sUSDe, FRAX) enabled as collateral |
| Yield Profile | /1 | Dynamic — fetched every 24 hours from on-chain data |
| Architecture | /1 | |
| **Total** | **/9** | |

**Hard Filters:**
- Audit: PASS — Multiple audits from Trail of Bits, OpenZeppelin, SigmaPrime, and others
- Exploit History: PASS — No exploits on Aave V3 (V2 flash loan incident in 2020 was on a previous version)
- Source Code: PASS — Verified on Snowtrace (Avalanche block explorer)

**Details:**

**Oracle (2/2):**
Aave V3 uses Chainlink price feeds managed through the `AaveOracle` contract. This is a 2/2 because:
- **Industry-standard provider**: Chainlink aggregators, which themselves aggregate multiple independent price sources (DEXs, CEXs)
- **Fallback mechanism**: The contract has `setFallbackOracle()` — a secondary price source activates if the primary Chainlink feed becomes unavailable
- **Governance-controlled**: Only `POOL_ADMIN` or `ASSET_LISTING_ADMIN` roles (both controlled by Aave DAO through on-chain voting with timelocks) can change oracle sources. No single party can swap the price feed
- **Additional safety**: `PriceOracleSentinel` contract pauses borrows and liquidations during oracle outages or L2 sequencer downtime, preventing bad liquidations from stale prices

**Liquidity (Dynamic — checked every 24 hours):**
Measured as total USDC supplied in Aave V3's USDC market on Avalanche (not protocol-wide TVL). Score is calculated from on-chain data:
- TVL > $10M = 3 pts | TVL > $1M = 2 pts | TVL > $500K = 1 pt | TVL < $500K = 0 pts
- As of 2026-04-05: $100.15M supplied, with a supply cap of $240.3M
- Notable: Aave uses a dual cap system (supply cap + borrow cap) where the borrow cap ($173.8M) is always set below the supply cap, ensuring a withdrawal buffer even at max utilization

**Collateral Quality (1/2):**
Aave V3 Avalanche is a shared-pool model — any collateral-enabled asset can be used to borrow USDC. This is 1/2 because:
- **Majority is blue-chip**: BTC ($155M), AVAX ($143M), WETH ($31M), USDT ($55M), and USDC itself make up the vast majority of collateral by value
- **Exotic assets are present**: USDe ($2.75K supplied, $5M cap), sUSDe ($28.4K supplied, $5M cap), and FRAX ($7.88K, isolated) are enabled as collateral
- **Mitigations**: Aave governance sets conservative parameters for riskier assets — lower Max LTV (70% vs 75%), higher liquidation penalty (8.5% vs 4%), and tight supply caps
- **E-Mode risk**: sUSDe in Stablecoin E-Mode gets 89% LTV with only 4% liquidation penalty, increasing depeg exposure
- Despite mitigations, the possibility of bad debt from exotic collateral depeg events means this cannot score 2/2

**Yield Profile (Dynamic — checked every 24 hours):**
Yield is organic — 100% from borrower interest, no token emissions. Score is calculated from 30-day rolling APY data:
- Std dev < 30% of mean APY = 1 pt | Std dev >= 30% = 0 pts
- As of 2026-04-05: Supply APY 2.50%, 1-week avg 2.54%, range ~2-3% — appears stable

**Architecture (1/1):**
SnowMind deposits USDC directly into Aave V3's lending pool — no wrapper, curator, or intermediary contract. Direct interaction with the protocol's smart contracts.

---

### Benqi (Avalanche)

| Category | Points | Notes |
|---|---|---|
| Oracle Quality | 2/2 | Dual oracle system: Chainlink + Edge Oracle (by Chaos Labs & Chainlink), audited by Zellic |
| Liquidity | /3 | Dynamic — fetched every 24 hours from on-chain TVL |
| Collateral Quality | /2 | |
| Yield Profile | /1 | Dynamic — fetched every 24 hours from on-chain data |
| Architecture | /1 | |
| **Total** | **/9** | |

**Hard Filters:**
- Audit: PASS — Audited by Halborn and others
- Exploit History: PASS — No exploits
- Source Code: PASS — Verified on Snowtrace

**Details:**

**Oracle (2/2):**
Benqi uses a dual oracle system — Chainlink + Edge Oracle (a joint product by Chaos Labs and Chainlink). This is 2/2 because:
- **Dual independent oracle networks**: Two separate providers securing price feeds, adding redundancy
- **Industry-standard providers**: Both Chainlink and Chaos Labs are established, reputable oracle providers
- **Audited**: The oracle contract has been fully audited by Zellic
- **On-chain verifiable**: Oracle contract addresses are published in Benqi's documentation
- Additionally, Chaos Oracle is used for AVAX and stablecoin feeds

**Liquidity (Dynamic — checked every 24 hours):**
Measured as available USDC liquidity in Benqi's USDC market on Avalanche. Score is calculated from on-chain data:
- TVL > $10M = 3 pts | TVL > $1M = 2 pts | TVL > $500K = 1 pt | TVL < $500K = 0 pts
- As of 2026-04-05: ~$6M available liquidity

**Collateral Quality (2/2):**
Benqi Core Markets use a shared-pool model (Compound V2 fork). This is 2/2 because:
- **Mostly blue-chip**: AVAX, WETH.e, BTC.b are the major collateral assets
- **Stablecoins**: USDC, USDt, AUSD, EURC
- **sAVAX**: Only yield-bearing asset — liquid-staked AVAX, well-understood with established track record
- **No exotic collateral**: No USDe, sUSDe, synthetics, or unproven assets — significantly cleaner collateral pool than Aave

**Yield Profile (Dynamic — checked every 24 hours):**
Yield is organic — from borrower interest, no token emissions. Score is calculated from 30-day rolling APY data:
- Std dev < 30% of mean APY = 1 pt | Std dev >= 30% = 0 pts

**Architecture (1/1):**
SnowMind deposits USDC directly into Benqi's lending pool — no wrapper, curator, or intermediary contract. Direct interaction with the protocol's smart contracts.

---

### Spark / spUSDC

> Note: Spark is NOT a lending protocol. It is a savings vault (spUSDC) that deploys USDC into yield-generating strategies via the Spark Liquidity Layer. The risk profile is fundamentally different from lending protocols like Aave or Benqi.

| Category | Points | Notes |
|---|---|---|
| Oracle Quality | 2/2 | No external oracle dependency — savings rate set by Spark/Sky governance |
| Liquidity | /3 | Dynamic — fetched every 24 hours from on-chain data |
| Collateral Quality | 2/2 | N/A — no borrowers or collateral. But USDS conversion risk exists (see details) |
| Yield Profile | /1 | Dynamic — fetched every 24 hours from on-chain data |
| Architecture | 0/1 | Multiple intermediary layers: PSM + Spark Liquidity Layer + yield strategies |
| **Total** | **/9** | |

**Hard Filters:**
- Audit: PASS — Spark/Sky (formerly MakerDAO) contracts are among the most audited in DeFi
- Exploit History: PASS — No exploits
- Source Code: PASS — Verified and open source

**Details:**

**Oracle (2/2):**
No external price oracle is needed. The vault rate is anchored to the Sky Savings Rate (SSR), which is a governance-set parameter — not derived from any price feed. This is 2/2 under "no external oracle dependency."

**Liquidity (Dynamic — checked every 24 hours):**
Liquidity for spUSDC works differently from lending protocols:
- 10% of deposits are kept in the contract as instant withdrawal liquidity
- Remaining withdrawals depend on the PSM (Peg Stability Module) having sufficient USDC to swap USDS → USDC
- Score is based on available USDC liquidity measured as: vault's 10% instant buffer + USDC available in the PSM (combined)
- TVL > $10M = 3 pts | TVL > $1M = 2 pts | TVL > $500K = 1 pt | TVL < $500K = 0 pts

**Collateral Quality (2/2):**
There are no borrowers and no collateral in the traditional sense — this is a savings vault, not a lending market. Score is 2/2 under "N/A — no collateral risk."

However, there are **unique risks specific to Spark** that users should understand:
- **USDS conversion risk**: Deposited USDC is converted to USDS via the PSM. If USDS depegs, the value of deposits is affected
- **Strategy risk**: 90% of deposits are deployed into yield-generating strategies via the Spark Liquidity Layer. These strategies are selected by Spark Governance — users don't control or choose which strategies are used
- **PSM dependency**: Withdrawals rely on the PSM having enough USDC liquidity. In extreme scenarios (bank run, USDS depeg), the PSM could be drained, making USDC withdrawals temporarily unavailable
- **Governance dependency**: Both the savings rate and strategy selection are managed by Spark/Sky governance. Rate changes and strategy updates happen via governance decisions

**Yield Profile (Dynamic — checked every 24 hours):**
Yield is anchored to the Sky Savings Rate (SSR) as a minimum, with additional yield from Spark Liquidity Layer strategies. Score is calculated from 30-day rolling APY data:
- Std dev < 30% of mean APY = 1 pt | Std dev >= 30% = 0 pts
- Rate is variable and adjusts based on market dynamics and underlying strategies
- Unlike lending protocols, yield is not from borrower interest — it comes from governance-set rates + strategy returns

**Architecture (0/1):**
This is 0/1 because USDC does not stay as USDC. The deposit flow involves multiple intermediary layers:
1. User deposits USDC into spUSDC vault
2. USDC is swapped to USDS via the PSM (Peg Stability Module)
3. USDS is deployed into the Spark Liquidity Layer
4. Spark Liquidity Layer allocates across yield-generating strategies

Each layer adds smart contract risk. This is the most intermediated architecture among all listed protocols.

---

### Euler V2 (9Summits Cluster — Avalanche)

> Note: Euler V2 uses a curator model. Vaults are managed by third-party curators (in this case, 9Summits) who control oracle selection, collateral parameters, and risk settings. The vault type is "Governed."

| Category | Points | Notes |
|---|---|---|
| Oracle Quality | 1/2 | Chainlink for blue-chip assets, but curator-controlled — sUSDe uses non-whitelisted RedStone adapter |
| Liquidity | /3 | Dynamic — fetched every 24 hours from on-chain data |
| Collateral Quality | 1/2 | Mixed — BTC.b and WETH.e are blue-chip, but sUSDe and savUSD are yield-bearing with aggressive LTV |
| Yield Profile | /1 | Dynamic — fetched every 24 hours from on-chain data |
| Architecture | 0/1 | Deposits go through curator's vault layer, not directly into a core lending pool |
| **Total** | **/9** | |

**Hard Filters:**
- Audit: PASS — Euler V2 core contracts audited. Note: Euler V1 had a $197M exploit in March 2023 (funds were returned). V2 is a complete rewrite
- Exploit History: PASS — No exploits on V2. V1 exploit was on a previous, separate version
- Source Code: PASS — Verified on block explorer

**Details:**

**Oracle (1/2):**
Oracle selection is controlled by the 9Summits curator, not by Euler governance or a DAO. This is 1/2 because:
- **Blue-chip assets use Chainlink**: BTC.b, WETH.e, and sAVAX all use Chainlink price feeds (industry standard)
- **sUSDe uses RedStone**: A push-based oracle with 25000s max staleness. The oracle adapter is **not whitelisted in Euler's adapter registry** (medium-severity flag). This is the highest-LTV collateral (90%) using the least battle-tested oracle
- **savUSD uses a separate oracle**: Different provider from both Chainlink and RedStone — not fully verified
- **Curator trust assumption**: The 9Summits curator can change oracle configurations. Users trust the curator to make sound oracle choices, rather than protocol governance

**Liquidity (Dynamic — checked every 24 hours):**
Measured as available USDC in the 9Summits Cluster USDC vault. Score is calculated from on-chain data:
- TVL > $10M = 3 pts | TVL > $1M = 2 pts | TVL > $500K = 1 pt | TVL < $500K = 0 pts
- As of 2026-04-05: $307K available liquidity ($3.33M supplied, $3.02M borrowed)
- Utilization is 90.78% — very high, which significantly limits withdrawal capacity
- No dual cap system like Aave — utilization is not structurally bounded

**Collateral Quality (1/2):**
Six vaults can borrow USDC from this market. This is 1/2 because:
- **Blue-chip collateral**: BTC.b (80% LTV), WETH.e (80% LTV) — standard, safe
- **Liquid staking**: sAVAX (70% LTV) — moderate risk, well-understood
- **Yield-bearing / exotic**: sUSDe (90% LTV, 92.5% LLTV) and savUSD (85% LTV, 88% LLTV) — these are the concern
- **sUSDe at 90% LTV is very aggressive**: For comparison, Aave gives sUSDe only 70% LTV. A depeg from $1.23 to ~$1.10 could create bad debt. Combined with a non-whitelisted oracle adapter, this is the highest risk factor in this vault
- **Re7 Labs BTC.b**: Cross-cluster exposure at 0% LTV (effectively disabled)

**Yield Profile (Dynamic — checked every 24 hours):**
Yield is organic — from borrower interest. Score is calculated from 30-day rolling APY data:
- Std dev < 30% of mean APY = 1 pt | Std dev >= 30% = 0 pts
- As of 2026-04-05: Supply APY 6.86%, Borrow APY 9.44%
- High APY is driven by high utilization (90.78%) — if utilization drops, APY drops significantly

**Architecture (0/1):**
This is 0/1 because deposits go through the curator's vault layer:
1. SnowMind deposits USDC into the 9Summits Cluster vault (not Euler's core contracts directly)
2. The curator controls risk parameters, oracle selection, and collateral settings
3. Additional smart contract risk from the curator layer on top of Euler V2's core contracts

---

### Silo — savUSD/USDC (Avalanche)

> Note: This is an **Immutable & Isolated** market — only two assets (savUSD and USDC). Unlike shared-pool protocols, the collateral risk is limited to a single asset. Market ID: 142. Deployer: Silo Labs.

| Category | Points | Notes |
|---|---|---|
| Oracle Quality | 2/2 | Both savUSD and USDC use Chainlink price feeds. Oracle is immutable — cannot be changed after deployment |
| Liquidity | /3 | Dynamic — fetched every 24 hours from on-chain data |
| Collateral Quality | 1/2 | savUSD is a yield-bearing stablecoin (Avant Protocol) with no instant redemption |
| Yield Profile | /1 | Dynamic — fetched every 24 hours from on-chain data |
| Architecture | 1/1 | Direct deposit into Silo's lending pool |
| **Total** | **/9** | |

**Hard Filters:**
- Audit: PASS — Silo V2 contracts audited. Risk report available (linked on market page)
- Exploit History: PASS — No exploits on Silo V2
- Source Code: PASS — Verified on block explorer. SiloDeployer and SiloFactories from silo-contracts-v2 repository

**Details:**

**Oracle (2/2):**
Both assets in this market use Chainlink price feeds. This is 2/2 because:
- **Industry-standard provider**: Chainlink for both USDC and savUSD
- **Immutable oracle**: The market is immutable — the oracle cannot be changed after deployment. This removes the governance/admin attack vector entirely (no one can swap to a malicious feed)
- **On-chain verifiable**: Oracle contract addresses are visible on the market page
- Note: SovaGuard risk report also references an ERC4626 oracle layer — Silo supports dual oracles per token (one for borrowing power, one for solvency). The primary oracle shown on-chain is Chainlink

**Liquidity (Dynamic — checked every 24 hours):**
Measured as available USDC in the Silo savUSD/USDC market. Score is calculated from on-chain data:
- TVL > $10M = 3 pts | TVL > $1M = 2 pts | TVL > $500K = 1 pt | TVL < $500K = 0 pts
- As of 2026-04-05: **100% utilization — 0 USDC available to withdraw**. $2M USDC TVL, all borrowed
- Supply APR spiked to 20.5% — this is the Dynamic IRM punishing full utilization, not a sign of healthy yield
- This is a critical liquidity concern: SnowMind cannot withdraw USDC from this market until borrowers repay or new deposits come in

**Collateral Quality (1/2):**
Isolated 2-asset market — only savUSD can be used as collateral to borrow USDC. This is 1/2 because:
- **savUSD is a yield-bearing stablecoin** by Avant Protocol. Underlying assets are deployed across on-chain strategies to generate yield
- **No instant redemption**: savUSD → avUSD requires a cooldown queue. Cooldown is configurable by admin (1 day at time of review, max 90 days). This means in a stress scenario, savUSD holders cannot exit instantly, which could cause price dislocation
- **savUSD contract**: Owned by a known MPC wallet, not upgradeable (immutable) — positive
- **USDC contract**: Owned by a Regular wallet (EOA) — yellow flag. Contract is upgradeable via non-standard proxy — implementation can be changed by admin
- **Isolated market limits blast radius**: Unlike Aave/Benqi, exposure is limited to savUSD only — no risk from unrelated exotic collateral

**Yield Profile (Dynamic — checked every 24 hours):**
Yield is organic — from borrowers paying interest to borrow USDC against savUSD collateral. Score is calculated from 30-day rolling APY data:
- Std dev < 30% of mean APY = 1 pt | Std dev >= 30% = 0 pts
- As of 2026-04-05: Supply APR 20.5%, but this is artificially elevated by 100% utilization. The APR chart shows it was stable around ~5% before spiking recently — the spike indicates a liquidity stress event, not sustainable yield

**Architecture (1/1):**
SnowMind deposits USDC directly into Silo's lending pool — no wrapper, curator, or intermediary. Direct interaction with the protocol's smart contracts. The market is immutable (core contracts are not upgradeable), which reduces smart contract upgrade risk.

---

### Silo — sUSDp/USDC (Avalanche)

> Note: This is an **Immutable & Isolated** market — only two assets (sUSDp and USDC). Market ID: 162. Deployer: Silo Labs. Uses Static Kink IRM.

| Category | Points | Notes |
|---|---|---|
| Oracle Quality | 1/2 | USDC uses Chainlink, sUSDp uses DIA Fundamental Oracle — reputable but less battle-tested than Chainlink |
| Liquidity | /3 | Dynamic — fetched every 24 hours from on-chain data |
| Collateral Quality | 1/2 | sUSDp (Staked USDp) is a yield-bearing stablecoin |
| Yield Profile | /1 | Dynamic — fetched every 24 hours from on-chain data |
| Architecture | 1/1 | Direct deposit into Silo's lending pool |
| **Total** | **/9** | |

**Hard Filters:**
- Audit: PASS — Silo V2 contracts audited
- Exploit History: PASS — No exploits on Silo V2
- Source Code: PASS — Verified on block explorer

**Details:**

**Oracle (1/2):**
- **USDC**: Chainlink USDC/USD price feed — industry standard
- **sUSDp**: Chainlink-wrapped DIA feed — developed by SiloLabs. The oracle contract is a Chainlink adapter, but the underlying price data comes from DIA's Fundamental Oracle
  - DIA is a multi-chain oracle platform sourcing data from 100+ CEXs and DEXs. It covers 20k+ feeds across 60+ blockchains
  - SovaGuard's automated check confirms: "This feed is deployed by DIA" — the primary feed price provider is **not in the known lists** (Chainlink, Redstone, Pyth, EO)
  - Oracle price is close to market price (0.75% diff vs CoinGecko/DEX) and frequently updated (1-minute intervals)
  - "Fundamental" pricing derives value from backing/redemption rather than market price — adds complexity
  - Contract is a minimal proxy (EIP-1167) with fixed implementation — cannot be upgraded
  - However, DIA is **less battle-tested than Chainlink** — smaller validator set, less track record securing large TVL, and not in our tier-1 oracle list (Chainlink, Chronicle, Pyth, Edge/Chaos Labs)
- Scoring 1/2: both oracles are confirmed and functional, but the underlying sUSDp data source (DIA) is less proven at scale, preventing a 2/2
- **Immutable oracle**: Positive — once set, the oracle cannot be changed by anyone, removing admin attack vectors

**Liquidity (Dynamic — checked every 24 hours):**
Measured as available USDC in the Silo sUSDp/USDC market. Score is calculated from on-chain data:
- TVL > $10M = 3 pts | TVL > $1M = 2 pts | TVL > $500K = 1 pt | TVL < $500K = 0 pts
- As of 2026-04-05: $379K available USDC ($1.5M USDC TVL, 75% utilization)
- Healthier utilization than the savUSD/USDC market (75% vs 100%)

**Collateral Quality (1/2):**
Isolated 2-asset market — only sUSDp can be used as collateral to borrow USDC. This is 1/2 because:
- **sUSDp (Staked USDp)** is a yield-bearing stablecoin — similar risk profile to savUSD
- **sUSDp is non-borrowable** — can only be deposited as collateral, reducing rehypothecation risk
- **Liquidation fee: 3.5%** — moderate penalty to incentivize liquidators
- Isolated market limits blast radius to sUSDp only

**Yield Profile (Dynamic — checked every 24 hours):**
Yield is organic — from borrowers paying interest to borrow USDC against sUSDp collateral. Score is calculated from 30-day rolling APY data:
- Std dev < 30% of mean APY = 1 pt | Std dev >= 30% = 0 pts
- As of 2026-04-05: Supply APR 3.4% with "Stable rate" state — appears stable

**Architecture (1/1):**
SnowMind deposits USDC directly into Silo's lending pool — no wrapper, curator, or intermediary. Direct interaction with the protocol's smart contracts. The market is immutable (core contracts and oracles are not upgradeable).

---

### Silo V3 — Gami USDC Vault (Avalanche)

> Note: This is a **Silo V3 ERC-4626 vault** managed by Gami (curator). Unlike V2's isolated markets where SnowMind deposits directly, this vault allocates USDC across multiple underlying Silo V3 lending markets. Vault address: 0x1F05...a1c5. Silo's own risk assessment: "High". Performance fee: 10%. Timelock: 1 day (applies to vault parameter changes by curator, NOT withdrawals).

| Category | Points | Notes |
|---|---|---|
| Oracle Quality | 0/2 | Multiple markets with different oracles — DIA fundamental, contract rate with hardcoded pegs, PT oracle. No uniform standard |
| Liquidity | /3 | Dynamic — fetched every 24 hours from on-chain data |
| Collateral Quality | 0/2 | Exotic — sUSDp, savUSD, PT-avUSD (Pendle Principal Tokens), sUSDe, sYUSD. All yield-bearing or synthetic |
| Yield Profile | /1 | Dynamic — fetched every 24 hours from on-chain data |
| Architecture | 0/1 | Deposits go through Gami's vault layer, which then allocates across Silo V3 markets |
| **Total** | **/9** | |

**Hard Filters:**
- Audit: PASS — Silo V3 uses the same underlying contracts as V2 (audited), with an added vault layer
- Exploit History: PASS — No exploits on Silo V2 or V3
- Source Code: PASS — Verified on block explorer

**Details:**

**Oracle (0/2):**
The vault allocates across multiple markets, each with a different oracle setup. This is 0/2 because the vault's oracle risk is determined by its worst oracle, and multiple markets rely on non-standard, less-proven feeds:

- **sUSDp/USDC (49.40% allocation):** DIA sUSDp/USD "Fundamental Oracle" + hardcoded 1 USD = 1 USDC + Chainlink USDC/USD
  - DIA is a multi-chain oracle platform, but significantly less battle-tested than Chainlink. Smaller validator set, less track record securing large TVL
  - "Fundamental" pricing derives value from backing/redemption rather than market price — adds complexity
  - Hardcoded USDC peg assumption — if USDC depegs, oracle won't reflect reality
  - Silo rates this oracle "High" risk

- **savUSD/USDC (28.45% allocation):** savUSD/avUSD ERC-4626 contract rate + hardcoded 1 avUSD = 1 USDC
  - Contract rate oracle reads the vault's internal exchange rate (`convertToAssets`) — no external price feed
  - Vulnerable to donation-based exchange rate manipulation (attacker sends tokens directly to vault to inflate rate)
  - Hardcoded avUSD = USDC peg assumption — if avUSD depegs, oracle continues reporting the wrong price
  - Silo rates this oracle "High" risk

- **PT-avUSD (15 May)/USDC (22.14% allocation):** Pendle Principal Token oracle — methodology not fully verified
  - PT pricing is inherently complex — discount converges to par at maturity, but pre-maturity requires specialized time-aware oracles
  - Traditional PT oracles (linear discount, AMM TWAP) have known pricing issues

- **Remaining markets (0% allocation):** sUSDe/USDC, sYUSD/USDC, PT-savUSD/USDC — currently 0% but the curator can reallocate to these at any time

~78% of the vault's capital depends on non-Chainlink or partially-Chainlink oracles with hardcoded peg assumptions.

**Liquidity (Dynamic — checked every 24 hours):**
Measured as available USDC in the Gami vault. Score is calculated from on-chain data:
- TVL > $10M = 3 pts | TVL > $1M = 2 pts | TVL > $500K = 1 pt | TVL < $500K = 0 pts
- As of 2026-04-06: ~$3M total vault deposits across 7 markets
- Important: Withdrawal liquidity depends on the underlying Silo V3 markets having available USDC. If utilization is high across markets, the vault may not be able to fulfill large withdrawals immediately

**Collateral Quality (0/2):**
The vault is exposed to collateral from all 7 underlying markets. This is 0/2 because every collateral asset is exotic or synthetic:
- **sUSDp (49.40%):** Staked USDp — yield-bearing stablecoin, unproven at scale, oracle unverifiable
- **savUSD (28.45%):** Yield-bearing stablecoin by Avant Protocol, no instant redemption (cooldown queue)
- **PT-avUSD (22.14%):** Pendle Principal Token — synthetic asset that trades at a discount pre-maturity, illiquid secondary market
- **Potential exposure (0% now, curator can reallocate):** sUSDe, sYUSD, PT-savUSD — all yield-bearing or synthetic
- None of the collateral assets are blue-chip (BTC, ETH, USDC). The entire vault is backed by newer, yield-bearing, or synthetic stablecoins with limited track records
- Silo's own risk reports rate multiple markets as "High" risk

**Yield Profile (Dynamic — checked every 24 hours):**
Yield is organic — from borrowers paying interest across the underlying Silo V3 markets. Score is calculated from 30-day rolling APY data:
- Std dev < 30% of mean APY = 1 pt | Std dev >= 30% = 0 pts
- As of 2026-04-06: Blended vault APR varies by market allocation. sUSDp/USDC at 3.35%, savUSD/USDC at 5.89%, PT-avUSD at 0.87%
- The 10% performance fee is deducted from yield before distribution to depositors

**Architecture (0/1):**
This is 0/1 because deposits go through the Gami curator's vault layer:
1. SnowMind deposits USDC into the Gami vault contract
2. Gami vault allocates USDC across 7 underlying Silo V3 lending markets
3. The curator (Gami) controls allocation weights, market selection, and can reallocate at any time (subject to 1-day timelock for parameter changes)
4. Additional smart contract risk from both the vault layer and the underlying Silo V3 market contracts

**Key Risks Specific to This Vault:**
- **Curator trust**: Gami controls allocation. No Guardian or Allocator roles are set — the curator has full control
- **Oracle diversity risk**: Each market uses a different oracle. SnowMind cannot control or verify all oracle quality uniformly
- **Cascading liquidation risk**: If one market's collateral depegs, bad debt in that market could affect the vault's share price
- **PT maturity risk**: PT-avUSD matures May 15, 2026. After maturity, the market dynamics change — the curator must manage the rollover
- **"High" self-assessed risk**: Silo's own risk engine rates this vault "High" — they are explicitly warning users

---

### Folks Finance xChain (Avalanche Hub)

> Note: Folks Finance uses a **Hub-and-Spoke architecture**. All lending logic, pool state, oracle prices, and liquidation logic live on the **Avalanche hub chain**. Other chains (Ethereum, Base, BSC, Arbitrum, etc.) are spoke entry points that relay user actions to the hub via Wormhole, Chainlink CCIP, and Circle CCTP. SnowMind deposits directly on the Avalanche hub, so cross-chain messaging risk does not apply to our deposits — but it is a protocol-level risk since spoke-chain users share the same lending pools.

| Category | Points | Notes |
|---|---|---|
| Oracle Quality | 2/2 | Chainlink + Pyth dual system via custom NodeManager with staleness/deviation checks |
| Liquidity | /3 | Dynamic — fetched every 24 hours from on-chain data |
| Collateral Quality | 1/2 | Mixed — blue-chip core (AVAX, BTC.b, wETH.e) but exotic assets present (SHIB, SolvBTC, sUSDe) |
| Yield Profile | /1 | Dynamic — fetched every 24 hours from on-chain data |
| Architecture | 1/1 | Direct deposit into HubPool lending contract on Avalanche |
| **Total** | **/9** | |

**Hard Filters:**
- Audit: PASS — OtterSec (xChain Lending, May 2024), Trail of Bits (V2), Coinspect, CertiK. Active Immunefi bug bounty ($200K). All reports: [github.com/Folks-Finance/audits](https://github.com/Folks-Finance/audits)
- Exploit History: PASS — No exploits. EVM xChain deployment live since mid-2024 (~18 months). Note: relatively young compared to Aave/Benqi
- Source Code: PASS — Verified on Snowtrace, open source on [GitHub](https://github.com/Folks-Finance/xchain-contracts)

**Details:**

**Oracle (2/2):**
Folks Finance uses a dual oracle system — Chainlink + Pyth — via a custom on-chain NodeManager. This is 2/2 because:
- **Dual industry-standard providers**: Both Chainlink and Pyth are tier-1 oracle providers
- **NodeManager architecture**: On-chain DAG of oracle nodes with parent/child relationships. Supports composable setups — e.g., median of Chainlink + Pyth, cross-rate calculations
- **Safety checks enforced on-chain**: Staleness tolerance (rejects stale prices), deviation tolerance (multiple feeds must agree within threshold), zero-price protection
- **On-chain verifiable**: OracleManager at `0x7218Bd1050D41A9ECfc517abdd294FB8116aEe81`, NodeManager at `0x802063A23E78D0f5D158feaAc605028Ee490b03b` — both on Avalanche
- Note: Admin key holders and oracle update governance are **not publicly documented** — a transparency gap, though the oracle infrastructure itself is strong

**Liquidity (Dynamic — checked every 24 hours):**
Measured as available USDC in the Folks Finance USDC HubPool on Avalanche. Score is calculated from on-chain data:
- TVL > $10M = 3 pts | TVL > $1M = 2 pts | TVL > $500K = 1 pt | TVL < $500K = 0 pts
- USDC HubPool contract: `0x88f15e36308ED060d8543DA8E2a5dA0810Efded2` (Pool ID: 1)
- As of 2026-04-06: ~$558K USDC TVL — relatively thin liquidity
- On-chain data available via `getDepositData()` (total deposits), `getVariableBorrowData()` / `getStableBorrowData()` (total borrows)
- Note: Cross-chain USDC deposits from spoke chains aggregate into this single hub pool via Circle CCTP, so liquidity can grow from multi-chain activity

**Collateral Quality (1/2):**
Folks Finance is a shared-pool model — any collateral-enabled asset can be used to borrow USDC. This is 1/2 because:
- **Blue-chip core**: AVAX ($1.05M), BTC.b ($366K), wETH.e ($42K) — standard, safe assets
- **Liquid staking tokens**: sAVAX ($245K), ggAVAX ($511K), tAVAX ($22K), tETH ($19K) — moderate risk, depeg/slashing exposure
- **Yield-bearing wrappers**: SolvBTC ($1.29M), sUSDe ($35K), savUSD ($2.49M), yBTC.b ($3.44M) — additional smart contract risk layers
- **Meme token**: SHIB ($13K) — unusual for a lending protocol, highly volatile. Small TVL limits impact but signals looser listing standards
- **Mitigations**: Protocol uses collateral caps and borrow caps (USD-denominated) per asset to limit exposure to riskier collateral
- Despite caps, the presence of SHIB and multiple yield-bearing derivatives prevents a 2/2. Broader collateral surface than Benqi, comparable to Aave

**Yield Profile (Dynamic — checked every 24 hours):**
Yield is organic — from borrowers paying interest. Score is calculated from 30-day rolling APY data:
- Std dev < 30% of mean APY = 1 pt | Std dev >= 30% = 0 pts
- As of 2026-04-06: ~5.17% APY on USDC
- Interest rate model is a standard kinked/jump rate: optimal utilization 90%, 10% reserve/retention ratio, 0.10% flash loan fee
- Supports both variable and stable borrow rates

**Architecture (1/1):**
SnowMind deposits USDC directly into the HubPool contract on Avalanche — no wrapper, curator, or intermediary. Direct interaction with the protocol's smart contracts. Since SnowMind operates on Avalanche (the hub chain), the cross-chain messaging layer (Wormhole, CCIP, CCTP) is not in our deposit/withdrawal path.

**Key Risks Specific to Folks Finance:**
- **Protocol maturity**: EVM xChain deployment is ~18 months old — younger than Aave, Benqi, or Silo. Less battle-tested under extreme market stress
- **Cross-chain contagion**: While SnowMind's deposits are direct on the hub, spoke-chain users share the same pools. A bug in the cross-chain messaging layer (Wormhole had a $320M exploit in 2022) could affect pool state
- **Governance transparency gap**: No public documentation on admin key holders, timelock durations, multisig configuration, or who can pause the protocol. This is the biggest unknown
- **Low USDC liquidity**: ~$558K is thin — large deposits or withdrawals could significantly impact utilization and APY
- **SHIB as collateral**: A meme token with extreme volatility being accepted as collateral is an unusual risk factor

---

## Changelog

| Date | Change |
|---|---|
| 2026-04-05 | Initial framework created. Removed audit point from scoring (redundant with hard filter). Added Oracle Quality (2 pts) as new category. Removed Protocol Safety category. |
| 2026-04-06 | Added Silo V3 Gami USDC vault assessment. Oracle 0/2 (DIA, contract rate, hardcoded pegs), Collateral 0/2 (all exotic/synthetic), Architecture 0/1 (curator vault layer). Updated Silo sUSDp/USDC oracle from 0/2 → 1/2 after confirming sUSDp uses DIA Fundamental Oracle. Added Folks Finance xChain assessment. Oracle 2/2 (Chainlink + Pyth dual), Collateral 1/2 (mixed — SHIB + yield-bearing wrappers), Architecture 1/1 (direct HubPool deposit). |

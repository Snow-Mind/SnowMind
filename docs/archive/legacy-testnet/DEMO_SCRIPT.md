# SnowMind — Demo Video Script

**Duration**: 3 minutes
**Format**: Screen recording with voiceover
**Network**: Avalanche Fuji Testnet

---

## 00:00 – 00:20 | Introduction

**Show**: SnowMind landing page (full hero with mountain scene)

**Say**:
> "SnowMind is the first autonomous yield optimizer built natively on Avalanche.
> You deposit stablecoins into your own smart account, and our MILP solver
> continuously finds the mathematically optimal split across lending protocols —
> 24/7, non-custodial, gas-free."

**Action**: Slow scroll down the landing page to show the Neural Snowflake animation, stats bar, and "How It Works" section.

---

## 00:20 – 00:40 | Connect Wallet

**Show**: Click "Launch App" → Privy login modal

**Say**:
> "Connecting is simple. Use MetaMask, or just your email — Privy handles
> embedded wallets. No seed phrase needed for new users."

**Action**: Connect with a wallet. Show the dashboard loading.

---

## 00:40 – 01:10 | Smart Account Setup

**Show**: Setup wizard (4 steps)

**Say**:
> "Watch: a ZeroDev Kernel v3.1 smart account is being created on Avalanche Fuji.
> This is an ERC-4337 smart account — your funds live here, not in our servers."

**Action**:
1. Step 1: Welcome screen
2. Step 2: Smart account created → **copy the address, paste into Snowtrace** to show it's a real contract
3. Step 3: "Now I authorize the optimizer. This creates a scoped session key — it can only supply and withdraw to Aave V3. No transfers, no other contracts."
   → Show the transaction confirmation on Snowtrace
4. Step 4: Done

---

## 01:10 – 01:40 | Deposit

**Show**: Dashboard → click "Deposit"

**Say**:
> "I'll deposit test USDC. This sends a real UserOperation through the Pimlico
> bundler to Aave V3 on Fuji. Gas is sponsored — I pay nothing."

**Action**:
1. Enter amount (e.g., 1000 USDC)
2. Click Deposit
3. Show the transaction processing
4. **Click the tx hash → opens Snowtrace** showing the real transaction
5. Show aUSDC balance appearing in the dashboard

---

## 01:40 – 02:10 | Dashboard & Optimizer

**Show**: Dashboard with live data

**Say**:
> "The dashboard shows my live portfolio — current balance, aUSDC yield,
> and the optimizer's recommended allocation. The MILP solver runs every
> 5 minutes in demo mode."

**Action**:
1. Point out: total deposited, current APY, yield earned
2. Show the allocation chart (pie/bar showing protocol split)
3. Show optimizer status: "The solver calculates the globally optimal allocation
   using Mixed-Integer Linear Programming — not a heuristic, not a guess."

---

## 02:10 – 02:40 | On-Chain Verification

**Show**: Switch to Snowtrace

**Say**:
> "Everything is publicly verifiable. Here's our SnowMindRegistry contract
> on Snowtrace — every rebalance event is logged on-chain."

**Action**:
1. Open Snowtrace → SnowMindRegistry contract address
2. Click "Events" tab → show logged events (AccountRegistered, OptimizerRebalance)
3. Click "Contract" tab → show verified source code
4. Switch to the `/activity` page → "And you can see all this live in the app too, no wallet required."

---

## 02:40 – 02:55 | Security Model

**Show**: Settings page or security section of landing page

**Say**:
> "Security is non-negotiable. Session keys are enforced on-chain by the
> EVM itself — not by our backend. The optimizer can only supply and withdraw.
> It can never transfer your funds. And you can revoke access instantly."

---

## 02:55 – 03:00 | Closing

**Show**: Landing page hero with Neural Snowflake

**Say**:
> "SnowMind. Your money, working smarter. Built on Avalanche."

**Action**: Show the URL: `snowmind.vercel.app`

---

## Recording Tips

- Use 1920x1080 resolution
- Slow mouse movements so viewers can follow
- Pause briefly on each Snowtrace page so addresses are readable
- Pre-fund the test wallet with USDC so the deposit is instant
- Have the backend running in demo mode (5-min optimizer interval)
- Keep browser bookmarks hidden for a clean look

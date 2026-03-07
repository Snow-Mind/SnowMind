# SnowMind — Autonomous Yield Optimizer on Avalanche

> Deposit stablecoins. Our AI agent splits them across Aave V3 on Avalanche,
> optimizing yield 24/7. Non-custodial. Gas-free. Starting from $5K.

---

## Live Demo (Fuji Testnet)

**Live Site**: https://snowmind.vercel.app
**Test Network**: Avalanche Fuji C-Chain (Chain ID: 43113)
**Faucet**: Get test USDC at https://app.aave.com/faucet/ (switch to Fuji)

## Verified Smart Contracts (Fuji Testnet)

| Contract | Address | Snowtrace |
|---|---|---|
| SnowMindRegistry | `TBD` | [View + Source Code](https://testnet.snowtrace.io/address/TBD#code) |
| Aave V3 Pool (Fuji) | `0x1775ECC8362dB6CaB0c7A9C0957cF656A5276c29` | [View](https://testnet.snowtrace.io/address/0x1775ECC8362dB6CaB0c7A9C0957cF656A5276c29) |
| USDC (Fuji) | `0x5425890298aed601595a70AB815c96711a31Bc65` | [View](https://testnet.snowtrace.io/address/0x5425890298aed601595a70AB815c96711a31Bc65) |
| ZeroDev EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | [View](https://testnet.snowtrace.io/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032) |

## Architecture

```
User Wallet (MetaMask / Privy)
        ↓ Privy Auth
ZeroDev Kernel v3.1 Smart Account (ERC-4337)
        ↓ Session Key (scoped: supply/withdraw only)
SnowMind Python Backend (FastAPI on Railway)
        ↓ MILP Optimizer (PuLP) + APScheduler
Pimlico Bundler (ERC-4337, gas sponsored)
        ↓ UserOperation
Aave V3 Pool (Fuji Testnet)
        ↓ aUSDC minted to Smart Account
SnowMindRegistry (logs rebalance events on-chain)
```

```
┌────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 15 · Vercel)                            │
│  Privy Auth → ZeroDev Kernel v3.1 Smart Account            │
│  → Session key grant → Dashboard                           │
└──────────────────┬─────────────────────────────────────────┘
                   │ HTTPS (REST/JSON)
┌──────────────────▼─────────────────────────────────────────┐
│  BACKEND (FastAPI · Railway)                               │
│  Rate Fetcher → MILP Solver → Rebalance Engine             │
│  Session Key Manager → Pimlico Bundler → On-chain          │
│  Supabase (PostgreSQL) for state persistence               │
└──────────────────┬─────────────────────────────────────────┘
                   │ ERC-4337 UserOperations
┌──────────────────▼─────────────────────────────────────────┐
│  AVALANCHE C-CHAIN (On-chain)                              │
│  ZeroDev Kernel v3.1 Smart Accounts                        │
│  Pimlico Paymaster (gas sponsoring)                        │
│  Aave V3 (supply/withdraw) · Benqi (mint/redeem)           │
│  SnowMindRegistry (immutable event log)                    │
└────────────────────────────────────────────────────────────┘
```

## Testing the App (Judge Instructions)

### Option A — Full Test (5 minutes)

1. Open https://snowmind.vercel.app
2. Click **"Get Test Funds"** → redirects to Aave faucet for test USDC on Fuji
3. Click **"Launch App"** → connect wallet (or use email login via Privy)
4. Complete the 4-step setup wizard:
   - Step 1: Welcome
   - Step 2: Smart account auto-created — verify address on Snowtrace
   - Step 3: Authorize optimizer — produces a **real tx** on Fuji
   - Step 4: Done!
5. Click **"Deposit"** → enter test USDC amount → confirm
   - This sends a **real UserOperation** to Aave V3 on Fuji
6. View your aUSDC balance live in the dashboard
7. Check transaction history → click any tx hash → opens Snowtrace

### Option B — Observer Test (1 minute)

Visit: https://snowmind.vercel.app/activity

See **all** live rebalance events emitted from the SnowMindRegistry contract. No wallet needed.

### Option C — Demo Walkthrough Page

Visit: https://snowmind.vercel.app/demo

Step-by-step guide with quick links to verified contracts and live activity.

## Verify On-Chain Activity

All transactions are verifiable on Avalanche Fuji:

- **SnowMindRegistry events**: Search the registry address on [testnet.snowtrace.io](https://testnet.snowtrace.io) → Events tab
- **Your smart account**: Search your smart account address on [testnet.snowtrace.io](https://testnet.snowtrace.io)
- **UserOperations**: Visible as internal transactions on the EntryPoint contract

## How The Optimizer Works

SnowMind uses **MILP (Mixed-Integer Linear Programming)** to allocate funds:

```
MAXIMIZE:  Σ(allocation_i × apy_i) − λ × Σ(allocation_i × risk_i)

SUBJECT TO:
  Σ allocation_i = total_deposit          // Budget: all funds allocated
  allocation_i  ≤ 0.60 × total            // Max 60% per protocol
  active_protocols ≥ 2                    // Min 2 protocols active
  allocation_i  ≥ $500 OR allocation_i = 0 // Min $500 per position or nothing
```

- Optimizer runs every **5 minutes** (demo mode) / **30 minutes** (production)
- Only rebalances when: improvement > 5% allocation delta **AND** net positive after gas
- Rates are **TWAP-smoothed** (15-minute window) and **cross-validated** against DefiLlama
- Any rate above **25% APY** triggers an alert and halts auto-rebalancing

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, TypeScript, Tailwind CSS 4, Framer Motion |
| Auth | Privy (embedded wallets + social login) |
| Smart Account | ZeroDev Kernel v3.1 (ERC-4337 + ERC-7579) |
| Gas Sponsoring | Pimlico Paymaster (users pay zero gas) |
| Backend | FastAPI (Python 3.12), Railway |
| Database | Supabase (PostgreSQL + Row Level Security) |
| Optimizer | PuLP MILP solver |
| Protocols | Aave V3, Benqi (Avalanche) |
| Custom Contract | SnowMindRegistry (Solidity, Foundry, verified on Snowtrace) |
| CI/CD | GitHub Actions → Vercel + Railway |

## Repository Structure

```
snowmind/
├── apps/
│   ├── web/              # Next.js 15 frontend (Vercel)
│   │   ├── app/          # App Router pages
│   │   ├── components/   # UI components (shadcn, snow theme, dashboard)
│   │   ├── hooks/        # React Query hooks
│   │   ├── lib/          # API client, constants, utilities
│   │   └── stores/       # Zustand state management
│   └── backend/          # FastAPI backend (Railway)
│       ├── app/
│       │   ├── api/      # Route handlers
│       │   ├── core/     # Config, security, database, logging
│       │   ├── models/   # Pydantic models
│       │   ├── services/ # Optimizer, protocols, execution, oracle
│       │   └── workers/  # APScheduler cron jobs
│       └── tests/        # pytest unit + integration tests
├── contracts/            # Solidity + Foundry (SnowMindRegistry)
├── packages/
│   └── shared-types/     # Shared TypeScript types (npm workspace)
├── docs/                 # Architecture, deployment, demo script
└── .github/workflows/    # CI + deploy pipelines
```

## Running Locally

### Prerequisites

- Node.js 20+, pnpm 9+, Python 3.12+, uv

### Setup

```bash
# 1. Clone
git clone https://github.com/your-org/snowmind
cd snowmind

# 2. Install frontend dependencies
pnpm install

# 3. Install backend dependencies
cd apps/backend
uv sync
cd ../..

# 4. Set environment variables
cp apps/web/.env.example apps/web/.env.local
cp apps/backend/.env.example apps/backend/.env
# Fill in your API keys (see .env.example files for details)

# 5. Run frontend (port 3000)
pnpm dev

# 6. Run backend (port 8000) — in a separate terminal
cd apps/backend
uv run uvicorn main:app --reload
```

## Security Model

- **Non-custodial**: SnowMind never holds your master keys. Funds stay in your smart account.
- **Scoped session keys**: Can ONLY call `supply()`/`withdraw()` on whitelisted protocol contracts.
- **Zero transfer permission**: Session key cannot move funds to any address — only supply/withdraw to approved pools.
- **Instant revocation**: Revoke the session key from the Settings page (on-chain, immediate effect).
- **TWAP rates**: 15-minute time-weighted average prevents flash loan rate manipulation.
- **25% APY sanity cap**: Any protocol reporting > 25% APY triggers an alert and halts rebalancing.
- **60% concentration cap**: MILP hard constraint — no more than 60% of your deposit in any single protocol.
- **Emergency withdrawal**: Works even if SnowMind backend is down — your MetaMask can always interact with your smart account directly.

See [SECURITY.md](SECURITY.md) for the full threat model.

## Documentation

- [Architecture Deep Dive](docs/ARCHITECTURE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Demo Video Script](docs/DEMO_SCRIPT.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

## License

MIT

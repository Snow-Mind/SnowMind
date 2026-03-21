# SnowMind — Autonomous Yield Optimizer on Avalanche

> Deposit USDC. Our AI agent allocates across Aave V3, Benqi, and Spark
> on Avalanche mainnet — optimizing yield 24/7. Non-custodial. Gas-free.

---

## Live App

**App**: https://www.snowmind.xyz
**Network**: Avalanche C-Chain (Chain ID: 43114)

## Mainnet Contract Addresses

| Contract | Address |
|---|---|
| Native USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |
| Aave V3 Pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Benqi qiUSDCn | `0xB715808a78F6041E46d61Cb123C9B4A27056AE9C` |
| Spark spUSDC | `0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d` |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 16 · Vercel)                            │
│  Privy Auth → ZeroDev Kernel v3.1 Smart Account            │
│  → Session key grant → Dashboard                           │
└──────────────────┬─────────────────────────────────────────┘
                   │ HTTPS (REST/JSON + Privy JWT)
┌──────────────────▼─────────────────────────────────────────┐
│  BACKEND (FastAPI · Railway)                               │
│  Rate Fetcher → Waterfall Allocator → Rebalancer           │
│  Fee Calculator → Execution Service (Node.js sidecar)      │
│  Supabase (PostgreSQL) for state persistence               │
└──────────────────┬─────────────────────────────────────────┘
                   │ ERC-4337 UserOperations (Pimlico)
┌──────────────────▼─────────────────────────────────────────┐
│  AVALANCHE C-CHAIN (43114)                                 │
│  Kernel v3.1 Smart Accounts + Session Keys                 │
│  Aave V3 · Benqi · Spark                                    │
│  ZeroDev Paymaster (gas sponsoring)                        │
└────────────────────────────────────────────────────────────┘
```

## How The Optimizer Works

SnowMind uses a **Waterfall Allocator** with Spark as the base layer:

1. Fetch live APYs from all protocols (on-chain reads, TWAP-smoothed)
2. Cross-validate against DefiLlama oracle (>2% divergence → halt)
3. Sort protocols by APY descending; fill each if it beats Spark by ≥0.5%
4. Cap exposure: 40% max per protocol, 15% of protocol TVL
5. Park remainder in Spark (the safe default)
6. Execute rebalance atomically via ERC-4337 batched UserOperations

**Safety features:**
- 6-hour minimum between rebalances, 30% max move per cycle
- Circuit breaker: 3 consecutive failures → protocol excluded
- $100K minimum TVL to participate
- 25% APY sanity cap — anything higher is rejected
- $50K total platform deposit cap (guarded beta)

## Fee Model

- **10% agent fee** — only on yield earned, never on principal
- Collected atomically during withdrawal (fee + remainder in one UserOp)
- Fee goes to Gnosis Safe treasury multisig

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind CSS 4, Framer Motion |
| Auth | Privy (embedded wallets + social login) |
| Smart Account | ZeroDev Kernel v3.1 (ERC-4337 + ERC-7579) |
| Gas Sponsoring | ZeroDev Paymaster + Pimlico Bundler |
| Backend | FastAPI (Python 3.12), Railway |
| Execution | Node.js sidecar (ZeroDev SDK, session key signing) |
| Database | Supabase (PostgreSQL + Row Level Security) |
| Optimizer | Waterfall Allocator (Spark base layer) |
| Protocols | Aave V3, Benqi, Spark (Avalanche mainnet) |
| Encryption | AES-256-GCM (session keys at rest) |
| Oracle | DefiLlama Yields API (rate cross-validation) |

## Repository Structure

```
snowmind/
├── apps/
│   ├── web/                # Next.js 16 frontend (Vercel)
│   │   ├── app/            # App Router pages
│   │   ├── components/     # UI components (dashboard, panels)
│   │   ├── hooks/          # React Query hooks
│   │   ├── lib/            # API client, constants, ZeroDev helpers
│   │   └── stores/         # Zustand state management
│   └── backend/            # FastAPI backend (Railway)
│       ├── app/
│       │   ├── api/        # Route handlers (accounts, health, rebalance)
│       │   ├── core/       # Config, security, database, logging
│       │   ├── models/     # Pydantic models
│       │   ├── services/   # Optimizer, protocols, execution, fees
│       │   └── workers/    # Scheduler (30-min rebalance cycles)
│       ├── execution_service/  # Node.js sidecar for UserOp signing
│       └── tests/          # pytest unit + integration tests
├── contracts/              # Solidity + Foundry (SnowMindRegistry)
├── packages/
│   └── shared-types/       # Shared TypeScript types (npm workspace)
└── ARCHITECTURE.md         # Full plain-English architecture walkthrough
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
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/backend/.env.example apps/backend/.env
# Fill in your API keys (see .env.example files for details)

# 5. Run frontend (port 3000)
pnpm dev

# 6. Run backend (port 8000) — in a separate terminal
cd apps/backend
uv run uvicorn main:app --reload

# 7. Run execution service (port 3001) — in a separate terminal
cd apps/backend/execution_service
node execute.js
```

## Security Model

- **Non-custodial**: SnowMind never holds your master keys. Funds stay in your smart account.
- **Scoped session keys**: Can ONLY call supply/withdraw on whitelisted protocol contracts + USDC transfer to treasury.
- **On-chain enforcement**: Session key call policies enforced by the Kernel smart account — even a stolen key can't exceed permissions.
- **7-day expiry**: Session keys auto-expire. Max 20 ops/day.
- **AES-256-GCM encryption**: Session keys encrypted at rest in Supabase.
- **TWAP rates**: 15-minute time-weighted average prevents flash manipulation.
- **DefiLlama cross-validation**: On-chain rates checked against independent oracle.
- **Emergency withdrawal**: Works even if SnowMind backend is down — your wallet can always interact with your smart account directly on Snowtrace.

## Documentation

- [Architecture Deep Dive](ARCHITECTURE.md) — Plain-English walkthrough of the entire system
- [Deployment Guide](DEPLOYMENT_GUIDE.md) — Step-by-step mainnet deployment instructions

## License

MIT !
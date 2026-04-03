# SnowMind — Autonomous Yield Optimizer on Avalanche

> Deposit USDC. Our AI agent allocates across Aave V3, Benqi, Spark,
> Euler V2 (9Summits), and Silo on Avalanche mainnet — optimizing yield 24/7.
> Non-custodial. Gas-free.

---

## Live App

**App**: https://app.snowmind.xyz (legacy https://www.snowmind.xyz still supported)
**Network**: Avalanche C-Chain (Chain ID: 43114)

## Mainnet Contract Addresses

| Contract | Address |
|---|---|
| Native USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |
| Aave V3 Pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| Benqi qiUSDCn | `0xB715808a78F6041E46d61Cb123C9B4A27056AE9C` |
| Spark spUSDC | `0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d` |
| Euler V2 (9Summits) | `0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e` |
| Silo savUSD/USDC | `0x606fe9a70338e798a292CA22C1F28C829F24048E` |
| Silo sUSDp/USDC | `0x8ad697a333569ca6f04c8c063e9807747ef169c1` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
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
│  Aave V3 · Benqi · Spark · Euler V2 · Silo                │
│  ZeroDev Paymaster (gas sponsoring)                        │
└────────────────────────────────────────────────────────────┘
```

## How The Optimizer Works

SnowMind uses a **Waterfall Allocator** with Spark as the base layer:

1. Fetch live APYs from all healthy protocols (on-chain reads, TWAP-smoothed)
2. Cross-validate against DefiLlama as a soft signal (logged, not a hard gate)
3. Rank protocols by effective TWAP APY descending; allocate top-down
4. Cap exposure: 7.5% of protocol TVL for lending pools (Aave, Benqi); no TVL cap for ERC-4626 vaults (Spark, Euler, Silo)
5. Skip rebalance if APY improvement < 0.01% (beat margin)
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
| Protocols | Aave V3, Benqi, Spark, Euler V2 (9Summits), Silo (Avalanche mainnet) |
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
│       │   └── workers/    # Scheduler (configurable rebalance cycles)
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
- **Infinite on-chain lifetime**: Session keys do not expire on-chain. Users can revoke at any time. Max 20 ops/day.
- **AES-256-GCM encryption**: Session keys encrypted at rest in Supabase.
- **TWAP rates**: 15-minute time-weighted average prevents flash manipulation.
- **DefiLlama soft cross-validation**: On-chain rates compared to independent oracle (logged as signal, not a hard gate).
- **Emergency withdrawal**: Works even if SnowMind backend is down — your wallet can always interact with your smart account directly on Snowtrace.

## Documentation

- [Architecture Deep Dive](ARCHITECTURE.md) — Plain-English walkthrough of the entire system
- [Deployment Guide](DEPLOYMENT_GUIDE.md) — Step-by-step mainnet deployment instructions

## License

MIT !
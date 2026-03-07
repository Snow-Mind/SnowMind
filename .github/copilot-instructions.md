# SnowMind — GitHub Copilot Instructions

You are building **SnowMind**: an autonomous, non-custodial AI yield optimizer running natively on the Avalanche C-Chain. Users deposit stablecoins into their own ZeroDev Kernel v3.1 smart account. A Python FastAPI backend continuously solves a MILP (Mixed-Integer Linear Programming) optimization problem and rebalances funds across Avalanche lending protocols (Benqi, Aave V3) to maximize risk-adjusted yield — 24/7, without the user touching anything.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 15 · Vercel)                             │
│  Privy Auth → ZeroDev Kernel v3.1 Smart Account             │
│  → Session key grant → Dashboard                            │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS (REST/JSON)
┌────────────────────▼────────────────────────────────────────┐
│  BACKEND (FastAPI · Railway)                                │
│  Rate Fetcher → MILP Solver → Rebalance Engine              │
│  Session Key Manager → Pimlico Bundler → On-chain           │
│  Supabase (PostgreSQL) for state persistence                │
└────────────────────┬────────────────────────────────────────┘
                     │ ERC-4337 UserOperations
┌────────────────────▼────────────────────────────────────────┐
│  AVALANCHE C-CHAIN (On-chain)                               │
│  ZeroDev Kernel v3.1 Smart Accounts                        │
│  Pimlico Paymaster (gas sponsoring)                         │
│  Benqi (qiToken: mint/redeem) · Aave V3 (supply/withdraw)  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Monorepo Structure

```
snowmind/
├── apps/
│   ├── web/                          # Next.js 15 (Vercel)
│   │   ├── app/
│   │   │   ├── (marketing)/          # Public pages
│   │   │   │   ├── page.tsx          # Landing page
│   │   │   │   ├── how-it-works/
│   │   │   │   └── layout.tsx
│   │   │   ├── (app)/                # Authenticated app
│   │   │   │   ├── dashboard/
│   │   │   │   ├── portfolio/
│   │   │   │   ├── settings/
│   │   │   │   └── layout.tsx
│   │   │   ├── api/                  # Next.js API routes (thin proxy only)
│   │   │   │   └── health/
│   │   │   ├── globals.css
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── ui/                   # shadcn/ui primitives
│   │   │   ├── snow/                 # SnowMind branded animations
│   │   │   │   ├── SnowCanvas.tsx    # Particle snow WebGL/canvas
│   │   │   │   ├── CrystalCard.tsx   # Glassmorphic frost card
│   │   │   │   └── NeuralSnowflake.tsx # Animated SVG snowflake
│   │   │   ├── dashboard/
│   │   │   │   ├── AllocationChart.tsx
│   │   │   │   ├── YieldMetrics.tsx
│   │   │   │   └── RebalanceHistory.tsx
│   │   │   └── wallet/
│   │   │       ├── ConnectButton.tsx
│   │   │       └── SmartAccountSetup.tsx
│   │   ├── lib/
│   │   │   ├── privy.ts
│   │   │   ├── zerodev.ts
│   │   │   ├── api-client.ts
│   │   │   └── constants.ts
│   │   ├── hooks/
│   │   │   ├── useSmartAccount.ts
│   │   │   ├── usePortfolio.ts
│   │   │   └── useRebalanceHistory.ts
│   │   ├── stores/
│   │   │   └── portfolio.store.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── public/
│   │   └── package.json
│   │
│   └── backend/                      # FastAPI (Railway)
│       ├── app/
│       │   ├── api/
│       │   │   ├── routes/
│       │   │   │   ├── accounts.py   # Smart account registration
│       │   │   │   ├── optimizer.py  # Run optimizer on demand
│       │   │   │   ├── portfolio.py  # Read portfolio state
│       │   │   │   ├── rebalance.py  # Trigger/status
│       │   │   │   └── health.py
│       │   │   └── __init__.py
│       │   ├── core/
│       │   │   ├── config.py         # Pydantic settings
│       │   │   ├── security.py       # JWT, API key auth
│       │   │   ├── database.py       # Supabase client
│       │   │   └── logging.py
│       │   ├── services/
│       │   │   ├── optimizer/
│       │   │   │   ├── milp_solver.py    # PuLP MILP core
│       │   │   │   ├── rate_fetcher.py   # On-chain APY reads + TWAP
│       │   │   │   ├── risk_scorer.py    # Static risk model (MVP)
│       │   │   │   └── rebalancer.py     # Cost-aware rebalance trigger
│       │   │   ├── protocols/
│       │   │   │   ├── base.py           # Abstract protocol interface
│       │   │   │   ├── benqi.py          # Benqi adapter (mint/redeem)
│       │   │   │   └── aave.py           # Aave V3 adapter (supply/withdraw)
│       │   │   ├── execution/
│       │   │   │   ├── session_key.py    # AES-256 encrypted key management
│       │   │   │   ├── userop_builder.py # ERC-4337 UserOperation construction
│       │   │   │   └── bundler.py        # Pimlico client
│       │   │   └── oracle/
│       │   │       ├── twap.py           # TWAP rate smoother
│       │   │       └── validator.py      # Rate sanity checks
│       │   ├── models/
│       │   │   ├── account.py
│       │   │   ├── allocation.py
│       │   │   ├── rebalance_log.py
│       │   │   └── protocol.py
│       │   └── workers/
│       │       └── scheduler.py          # APScheduler cron (30-min checks)
│       ├── tests/
│       │   ├── unit/
│       │   │   ├── test_milp_solver.py
│       │   │   └── test_rate_fetcher.py
│       │   └── integration/
│       ├── main.py
│       ├── requirements.txt
│       └── Dockerfile
│
├── packages/
│   └── shared-types/                 # Shared TS types (npm workspace)
│       ├── src/
│       │   ├── api.ts                # API request/response types
│       │   ├── portfolio.ts          # Portfolio domain types
│       │   └── index.ts
│       └── package.json
│
├── .github/
│   ├── copilot-instructions.md       # THIS FILE
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
├── turbo.json                        # Turborepo config
├── pnpm-workspace.yaml
└── package.json
```

---

## 🛠️ Tech Stack — Exact Versions

### Frontend
| Tool | Version | Purpose |
|---|---|---|
| Next.js | 15.x (App Router) | React framework |
| React | 19.x | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Styling |
| Framer Motion | 11.x | Animations |
| Privy | latest | Auth + embedded wallets |
| @zerodev/sdk | latest v5 | Smart account SDK |
| permissionless | latest | ERC-4337 utilities |
| viem | 2.x | Ethereum interactions |
| wagmi | 2.x | React hooks for Web3 |
| Recharts | 2.x | Charts/graphs |
| Zustand | 5.x | State management |
| shadcn/ui | latest | UI component library |
| @tanstack/react-query | 5.x | Server state management |

### Backend
| Tool | Version | Purpose |
|---|---|---|
| Python | 3.12.x | Runtime |
| FastAPI | 0.115.x | HTTP framework |
| uvicorn | 0.32.x | ASGI server |
| PuLP | 2.9.x | MILP solver |
| web3.py | 7.x | Ethereum/Avalanche RPC |
| supabase-py | 2.x | Database client |
| APScheduler | 3.10.x | Cron scheduling |
| cryptography | 43.x | AES-256 session key encryption |
| pydantic | 2.x | Data validation |
| httpx | 0.28.x | Async HTTP client |
| pytest | 8.x | Testing |
| python-jose | 3.x | JWT handling |

### Infrastructure
| Service | Purpose |
|---|---|
| Vercel | Frontend hosting |
| Railway | Backend hosting |
| Supabase | PostgreSQL database + Row Level Security |
| Pimlico | ERC-4337 bundler + Paymaster on Avalanche |
| ZeroDev Kernel v3.1 | Smart account contracts |

---

## 🎨 Design System — SnowMind Brand

### Visual Identity
SnowMind's theme is the **"Neural Snowflake"** — the crystalline intelligence of Avalanche's AI-powered yield. Every snowflake is unique and perfectly structured; every SnowMind allocation is mathematically optimal.

### Color Palette (CSS Variables)
```css
:root {
  --void:        #050A14;   /* Deep space background */
  --glacier:     #00C4FF;   /* Primary accent — glacier blue */
  --arctic:      #E8F4FF;   /* Primary text on dark */
  --frost:       #7C3AED;   /* Secondary accent — frost purple */
  --mint:        #00FF88;   /* Positive yield / success */
  --crimson:     #FF4444;   /* Risk / warning */
  --ice-20:      rgba(232, 244, 255, 0.08);  /* Card backgrounds */
  --ice-10:      rgba(0, 196, 255, 0.06);    /* Subtle highlights */
  --border-frost: rgba(0, 196, 255, 0.15);   /* Borders */
}
```

### Typography
- **Display font**: `Clash Display` (headings, hero text) — from `fonts.bunny.net`
- **Body font**: `DM Sans` (all body text, UI) — from Google Fonts
- **Mono font**: `JetBrains Mono` (addresses, numbers, code)

### Motion Principles
- **Background**: Floating snow particles (canvas-based, 60fps, subtle upward drift)
- **Cards**: Glassmorphism with `backdrop-filter: blur(24px)` and frost border
- **Data**: Numbers animate with `CountUp` effect when in view
- **Hover states**: Cards lift with `translateY(-4px)` and glow border intensifies
- **Page transitions**: Fade + subtle slide, not jarring cuts
- **Loading**: Snowflake spinner (rotating SVG crystal)

### Component Patterns
```tsx
// CrystalCard — the signature SnowMind card style
<div className="crystal-card">
  {/* backdrop-blur, glacier border, subtle inner glow */}
</div>

// GlacierButton — primary CTA
<button className="glacier-btn">
  {/* gradient glacier-to-frost, hover glow */}
</button>

// NeuralSnowflake — animated hero element
<NeuralSnowflake protocols={4} /> // Arms represent protocols
```

---

## 🧠 Core Business Logic — Always Keep in Mind

### The MILP Optimization Problem
```
MAXIMIZE:  Σ(allocation_i × yield_i) - λ × Σ(allocation_i × risk_score_i)

SUBJECT TO:
  Σ allocation_i = total_deposit        // All funds allocated
  0 ≤ allocation_i ≤ 0.60 × total      // Max 60% per protocol
  allocation_i ≥ MIN_THRESHOLD or = 0   // Min $500 per protocol or zero
  active_protocols ≥ 2                  // Diversification requirement
  allocation_i ∈ {0} ∪ [MIN, MAX]      // Binary choice: in or out
```

### Rebalancing Decision Gate
```python
# Only rebalance if ALL conditions are met:
1. |proposed_allocation_i - current_allocation_i| > 5% for any protocol
2. cost_adjusted_apr_improvement > 0  # Net positive after gas
3. time_since_last_rebalance > 6 hours
4. rate_twap_confirmation >= 2 consecutive reads  # Anti-flash-loan
5. no_rate_anomaly  # Rate < 25% APY, cross-validated with DefiLlama
```

### Session Key Scoping (Security Critical)
```json
{
  "allowedContracts": ["BENQI_POOL", "AAVE_V3_POOL"],
  "allowedFunctions": ["mint(uint256)", "redeem(uint256)", "supply(...)", "withdraw(...)"],
  "maxTransactionValue": "user_defined_cap",
  "expirationTimestamp": "now + 30_days",
  "rateLimit": "max_10_per_day"
}
```

### Protocol APY Sources
- **Benqi**: `exchangeRateStored()` + `supplyRatePerTimestamp()` on qiToken contract
- **Aave V3**: `Pool.getReserveData(asset).currentLiquidityRate` (RAY units → divide by 1e27)
- **Risk cross-validation**: Compare with DefiLlama API. If divergence > 2%, halt rebalancing.

---

## 📋 Coding Standards

### TypeScript (Frontend)
```typescript
// ✅ Always use explicit types for API responses
interface PortfolioResponse {
  totalDeposited: string; // BigInt as string (wei)
  totalYield: string;
  allocations: ProtocolAllocation[];
  lastRebalance: string | null; // ISO timestamp
}

// ✅ Use Zod for runtime validation on API boundaries
import { z } from 'zod';
const portfolioSchema = z.object({ ... });

// ✅ Use React Query for all server state
const { data, isLoading } = useQuery({
  queryKey: ['portfolio', address],
  queryFn: () => api.getPortfolio(address),
});

// ✅ Never store private keys or session keys client-side
// ✅ Format all token amounts with formatUnits(amount, decimals)
// ✅ Use viem's parseUnits/formatUnits, never manual math
```

### Python (Backend)
```python
# ✅ All routes use Pydantic models for request/response
class OptimizeRequest(BaseModel):
    account_address: str
    total_amount_usdc: Decimal
    risk_tolerance: Literal["conservative", "moderate", "aggressive"] = "moderate"

# ✅ All database operations go through service layer, never in routes
# ✅ All session keys encrypted with AES-256-GCM before storage
# ✅ NEVER log session keys, private keys, or JWT tokens
# ✅ Always use TWAP rates, never spot reads for optimizer input
# ✅ Validate all protocol rates: if rate > 25% APY, reject and alert

# ✅ Use async/await throughout FastAPI
@router.post("/optimize")
async def run_optimizer(req: OptimizeRequest, db: AsyncSession = Depends(get_db)):
    result = await optimizer_service.solve(req)
    return OptimizeResponse(**result)
```

### Security Rules (Non-Negotiable)
1. **Session keys** are AES-256-GCM encrypted at rest in Supabase. Decrypted only in-memory when needed.
2. **Never expose** rebalance trigger as a public endpoint. Only internal cron/event triggers.
3. **Rate limiting**: 100 req/min per IP, 1000 req/hour per authenticated user.
4. **HTTPS everywhere**: All communication TLS 1.3.
5. **Secrets in Railway/Vercel env vars** — never in code or `.env` files committed to git.
6. **Sanity bounds**: Any protocol rate > 25% APY triggers an alert and halts auto-rebalancing.
7. **MILP hard constraint**: No protocol can receive more than 60% of total allocation.

### System Design Principles Applied
- **Single Responsibility**: Each service file does one thing (rate_fetcher only fetches, milp_solver only solves)
- **Dependency Injection**: FastAPI `Depends()` for all service dependencies
- **Idempotency**: Rebalance operations are idempotent — running twice produces same state
- **Circuit Breaker**: If a protocol adapter fails 3x consecutively, exclude it from optimizer
- **Graceful Degradation**: Backend down → funds stay safe in current protocols, earning yield
- **Event-Driven (post-MVP)**: Move from cron polling to on-chain event listeners
- **Horizontal Scalability**: Stateless optimizer service — all state in Supabase

---

## 🔗 Environment Variables Reference

### Frontend (.env.local)
```bash
NEXT_PUBLIC_PRIVY_APP_ID=
NEXT_PUBLIC_ZERODEV_PROJECT_ID=
NEXT_PUBLIC_AVALANCHE_RPC_URL=
NEXT_PUBLIC_BACKEND_URL=
NEXT_PUBLIC_CHAIN_ID=43114  # Avalanche C-Chain mainnet (43113 for Fuji)
```

### Backend (.env / Railway)
```bash
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
PIMLICO_API_KEY=
ZERODEV_PROJECT_ID=
AVALANCHE_RPC_URL=
SESSION_KEY_ENCRYPTION_KEY=  # 32-byte AES key, hex encoded
DEFILLAMA_BASE_URL=https://yields.llama.fi
JWT_SECRET=
BACKEND_API_KEY=             # For frontend→backend auth
REBALANCE_CHECK_INTERVAL=1800  # 30 min in seconds
MAX_PROTOCOL_ALLOCATION=0.60
MIN_REBALANCE_THRESHOLD=0.05
MIN_BALANCE_USD=5000
```

---

## 🧪 Testing Requirements

Every service must have unit tests:
- `test_milp_solver.py`: Test allocation math with known inputs/outputs
- `test_rate_fetcher.py`: Test TWAP calculation, anomaly detection
- `test_rebalancer.py`: Test the 5-condition decision gate
- `test_protocol_adapters.py`: Test Benqi and Aave adapters against Fuji testnet

Frontend:
- Component tests with React Testing Library
- E2E tests with Playwright for critical user flows (connect wallet → deposit → view dashboard)

---

## ⛔ What NOT to Build

- **No custodial key storage** — we never hold user master keys
- **No public rebalance endpoint** — cron-only trigger
- **No Ethereum mainnet** — Avalanche C-Chain only (MVP)
- **No custom smart account contracts** — use audited Kernel v3.1
- **No spot-rate rebalancing** — always use TWAP-confirmed rates
- **No RL/ML in MVP** — pure MILP for MVP, RL is post-MVP
- **No cross-chain in MVP** — Avalanche single-chain first
# SnowMind Frontend

Next.js 16 frontend for the SnowMind yield optimizer, deployed on Vercel.

## Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Auth**: Privy (social login + wallet connection)
- **Smart Accounts**: ZeroDev SDK (Kernel v3.1, ERC-4337)
- **State**: Zustand + React Query
- **Animations**: Framer Motion

## Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/onboarding` | 4-step setup: account → strategy → deposit → activate |
| `/dashboard` | Portfolio overview, allocations, deposit/withdraw panels |

## Domain Split

- `https://www.snowmind.xyz` serves marketing pages (`/`, `/how-it-works`)
- `https://app.snowmind.xyz` serves product routes (`/onboarding`, `/dashboard`, `/portfolio`, `/settings`, `/withdraw`)
- `https://docs.snowmind.xyz` serves documentation (separate docs app)
- `https://snowmind.xyz` should redirect to `https://www.snowmind.xyz`

## Key Files

| File | Purpose |
|------|---------|
| `lib/constants.ts` | All mainnet contract addresses, chain config, protocol metadata |
| `lib/zerodev.ts` | Smart account creation, session key granting, call policies |
| `lib/api-client.ts` | Typed API client for backend communication |
| `components/dashboard/DepositPanel.tsx` | USDC deposit flow ($100 minimum) |
| `components/dashboard/EmergencyPanel.tsx` | Emergency withdraw from all protocols |
| `hooks/useSmartAccount.ts` | Smart account setup hook |
| `hooks/useProtocolRates.ts` | Live protocol APY data |
| `stores/portfolio.store.ts` | Zustand store for portfolio state |

## Development

```bash
# From repo root
pnpm install
pnpm dev        # starts on http://localhost:3000
```

## Environment Variables

See `apps/web/.env.example` for required variables:
- `NEXT_PUBLIC_PRIVY_APP_ID` — Privy application ID
- `NEXT_PUBLIC_ZERODEV_PROJECT_ID` — ZeroDev project ID
- `BACKEND_URL` — Server-side rewrite target for `/api/*` (primary production backend URL)
- `NEXT_PUBLIC_BACKEND_URL` — Optional fallback backend origin (not required for browser requests)
- `NEXT_PUBLIC_BACKEND_FALLBACK_URLS` — Optional comma-separated fallback API origins
- `NEXT_PUBLIC_PIMLICO_API_KEY` — Pimlico bundler key

## Deployment

Deployed automatically to Vercel on push to `main`. Security headers (CSP, X-Frame-Options, etc.) are configured in `vercel.json`.

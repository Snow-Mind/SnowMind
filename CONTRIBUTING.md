# Contributing to SnowMind

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9 --activate`)
- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (Python package manager)

### Local Development

```bash
# Clone the repo
git clone https://github.com/your-org/snowmind
cd snowmind

# Install frontend dependencies
pnpm install

# Install backend dependencies
cd apps/backend
uv sync
cd ../..

# Copy environment files
cp apps/web/.env.example apps/web/.env.local
cp apps/backend/.env.example apps/backend/.env
# Fill in your API keys

# Start frontend (port 3000)
pnpm dev

# Start backend (port 8000) — separate terminal
cd apps/backend
uv run uvicorn main:app --reload
```

## Project Structure

| Directory | Purpose |
|---|---|
| `apps/web/` | Next.js 15 frontend (Vercel) |
| `apps/backend/` | FastAPI backend (Railway) |
| `packages/shared-types/` | Shared TypeScript types |
| `contracts/` | Solidity smart contracts (Foundry) |
| `docs/` | Architecture, deployment, demo docs |

## Adding a New Protocol Adapter

1. **Create the adapter** in `apps/backend/app/services/protocols/`:

```python
# apps/backend/app/services/protocols/new_protocol.py
from app.services.protocols.base import ProtocolAdapter

class NewProtocolAdapter(ProtocolAdapter):
    async def get_supply_rate(self, asset: str) -> float:
        # Fetch current supply APY from on-chain
        ...

    async def supply(self, asset: str, amount: int) -> str:
        # Build supply calldata
        ...

    async def withdraw(self, asset: str, amount: int) -> str:
        # Build withdraw calldata
        ...
```

2. **Register** the adapter in the protocol registry
3. **Add contract addresses** to `apps/backend/app/core/config.py`
4. **Add risk score** to the risk scorer
5. **Add session key selectors** to `apps/web/lib/constants.ts` (`SESSION_KEY_SELECTORS`)
6. **Add protocol config** to `PROTOCOL_CONFIG` in `apps/web/lib/constants.ts`
7. **Update** the `ALLOWED_CONTRACTS` in session key scoping

## Testing

### Backend

```bash
cd apps/backend

# Run all tests
uv run pytest tests/ -v

# Run with coverage
uv run pytest tests/ -v --cov=app --cov-report=term-missing

# Run specific test file
uv run pytest tests/unit/test_milp_solver.py -v
```

### Frontend

```bash
# Lint
pnpm lint --filter=@snowmind/web

# Build (type-check)
pnpm build --filter=@snowmind/web
```

## Code Standards

- **Frontend**: TypeScript strict mode, ESLint, Prettier. Use React Query for server state, Zustand for client state.
- **Backend**: Python 3.12, type hints everywhere, Pydantic models for all request/response schemas, async/await throughout.
- **Commits**: Use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
- **PRs**: Include a description of what changed and why. Link to any relevant issues.

## Security

- Never commit `.env` files or API keys
- Never log session keys, private keys, or JWT tokens
- All protocol rates must be TWAP-smoothed before use in the optimizer
- See [SECURITY.md](SECURITY.md) for the full threat model

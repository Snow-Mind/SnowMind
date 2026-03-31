# Dependency Security Status

Last updated: 2026-04-01

## Workspace JavaScript audit

Command run:
- pnpm audit --prod

Result:
- High vulnerabilities: 0
- Moderate vulnerabilities: 0
- Low vulnerabilities: 0

Notes:
- No known production JS vulnerabilities remain after dependency remediation.
- Applied mitigations:
	- Upgraded Next.js to 16.1.7 in web and docs apps.
	- Updated eslint-config-next to 16.1.7 in web and docs apps.
	- Added pnpm overrides for transitive fixes in path-to-regexp, socket.io-parser, h3, hono, bn.js, and picomatch.

## Backend Python currency check

Command run:
- uv pip list --outdated

Result:
- Multiple packages are outdated, including core framework and web3 stack packages.

Upgrade policy recommendation:
1. Security-first patch updates in a staging branch.
2. Integration and fork tests before production rollout.
3. Major-version upgrades (FastAPI, Pydantic, Supabase SDK, Web3) in planned release windows only.

## Runtime stance

- Current codebase is hardened for production operation with improved observability, caching, and audit automation.
- Dependency modernization should continue as a controlled program, not a single risky bulk upgrade.
- Backend Python package upgrades remain the primary open dependency-maintenance track.

# SnowMind Deployment (Mainnet)

This document is intentionally short and mainnet-only.

Canonical detailed runbook: root [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md).

## Mainnet Constants

- Chain: Avalanche C-Chain (43114)
- Explorer: https://snowtrace.io
- Native USDC: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
- Aave V3 Pool: 0x794a61358D6845594F94dc1DB02A252b5b4814aD
- Benqi qiUSDCn: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C
- Spark spUSDC: 0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d
- EntryPoint v0.7: 0x0000000071727De22E5E9d8BAf0edAc6f37da032

## Required Environments

1. Backend (Railway): set production vars from [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md).
2. Frontend (Vercel): set production vars from [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md).
3. Execution service: deploy dedicated apps/execution service and set INTERNAL_SERVICE_KEY.

## Contract Deployment

Deploy only SnowMindRegistry on mainnet:

```bash
cd contracts
forge script script/DeployMainnet.s.sol:DeployMainnet \
	--rpc-url https://api.avax.network/ext/bc/C/rpc \
	--broadcast \
	--verify \
	--etherscan-api-key $SNOWTRACE_API_KEY
```

Then transfer ownership to Safe via two-step flow:

1. proposeOwnership(newSafe)
2. Safe executes acceptOwnership()

## Security Notes

- Session key TTL is 7 days.
- Use KMS_KEY_ID for session key encryption in production.
- Keep SESSION_KEY_ENCRYPTION_KEY empty in production (local fallback only).
- Do not run archived legacy scripts or non-mainnet addresses in production.

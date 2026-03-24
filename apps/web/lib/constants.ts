import { avalanche } from 'viem/chains'

// ── Mainnet-only chain configuration ────────────────────────────────────────
export const CHAIN = avalanche
export const CHAIN_ID = 43114

export const BACKEND_URL =
  (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export const ZERODEV_PROJECT_ID =
  process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? "";

export const AVALANCHE_RPC_URL =
  process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL ?? "https://api.avax.network/ext/bc/C/rpc";

// ── Mainnet contract addresses ──────────────────────────────────────────────
export const CONTRACTS = {
  REGISTRY:    (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? '') as `0x${string}`,

  // Aave V3 on Avalanche mainnet
  AAVE_POOL:   (process.env.NEXT_PUBLIC_AAVE_POOL_ADDRESS ?? '0x794a61358D6845594F94dc1DB02A252b5b4814aD') as `0x${string}`,
  // Aave V3 aUSDC (aAvaUSDC) token — 1:1 with USDC balance
  AAVE_AUSDC:  '0x625E7708f30cA75bfd92586e17077590C60eb4cD' as `0x${string}`,

  // Benqi qiUSDCn on Avalanche mainnet
  BENQI_QIUSDC: (process.env.NEXT_PUBLIC_BENQI_POOL_ADDRESS ?? '0xB715808a78F6041E46d61Cb123C9B4A27056AE9C') as `0x${string}`,
  BENQI_POOL: (process.env.NEXT_PUBLIC_BENQI_POOL_ADDRESS ?? '0xB715808a78F6041E46d61Cb123C9B4A27056AE9C') as `0x${string}`,

  // Spark spUSDC savings vault on Avalanche mainnet
  SPARK_SPUSDC: (process.env.NEXT_PUBLIC_SPARK_VAULT_ADDRESS ?? '0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d') as `0x${string}`,
  SPARK_VAULT: (process.env.NEXT_PUBLIC_SPARK_VAULT_ADDRESS ?? '0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d') as `0x${string}`,
  EULER_VAULT: (process.env.NEXT_PUBLIC_EULER_VAULT_ADDRESS ?? '0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e') as `0x${string}`,

  // Silo V2 USDC lending vaults on Avalanche mainnet (bUSDC ERC-4626 vaults, NOT SiloConfig)
  SILO_SAVUSD_VAULT: (process.env.NEXT_PUBLIC_SILO_SAVUSD_VAULT_ADDRESS ?? '0x606fe9a70338e798a292CA22C1F28C829F24048E') as `0x${string}`,
  SILO_SUSDP_VAULT: (process.env.NEXT_PUBLIC_SILO_SUSDP_VAULT_ADDRESS ?? '0x8ad697a333569ca6f04c8c063e9807747ef169c1') as `0x${string}`,

  // Native USDC on Avalanche mainnet (Circle-issued)
  USDC:        (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E') as `0x${string}`,

  // ZeroDev / ERC-4337
  ENTRYPOINT_V07: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as `0x${string}`,

  // SnowMind treasury (Gnosis Safe multisig) — fee collection target
  TREASURY: (process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? '') as `0x${string}`,
} as const

const explorerBase = 'https://snowtrace.io'
export const EXPLORER = {
  base: explorerBase,
  tx: (hash: string) => `${explorerBase}/tx/${hash}`,
  address: (addr: string) => `${explorerBase}/address/${addr}`,
  contract: (addr: string) => `${explorerBase}/address/${addr}#code`,
}

const pimlicoChain = 'avalanche'
export const PIMLICO = {
  rpc: `https://api.pimlico.io/v2/${pimlicoChain}/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`,
  bundlerRpc: `https://api.pimlico.io/v1/${pimlicoChain}/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`,
}

// ── Protocol metadata — drives ALL UI rendering ─────────────────────────────
// Only 3 protocols for mainnet beta. Add new protocols by adding entries here.
export const PROTOCOL_CONFIG = {
  aave_v3: {
    id: 'aave_v3' as const,
    name: 'Aave V3',
    shortName: 'Aave',
    category: 'Lending',
    asset: 'USDC',
    contractAddress: CONTRACTS.AAVE_POOL,
    riskScore: 10,     // Safety 3 + Liquidity 3 + Collateral 2 + Yield 2 + Architecture 1 = 10/10
    color: '#8381D9',
    bgColor: 'rgba(131, 129, 217, 0.12)',
    logoPath: '/protocols/aave-official.svg',
    isActive: true,
    defaultEnabled: true,
    description: 'Battle-tested lending protocol with $10B+ TVL globally',
    auditBadge: 'Audited',
    explorerUrl: EXPLORER.address(CONTRACTS.AAVE_POOL),
    vaultUrl: 'https://app.aave.com/reserve-overview/?underlyingAsset=0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e&marketName=proto_avalanche_v3',
  },
  aave: {
    id: 'aave' as const,
    name: 'Aave V3',
    shortName: 'Aave',
    category: 'Lending',
    asset: 'USDC',
    contractAddress: CONTRACTS.AAVE_POOL,
    riskScore: 10,     // Safety 3 + Liquidity 3 + Collateral 2 + Yield 2 + Architecture 1 = 10/10
    color: '#8381D9', // Aave brand purple
    bgColor: 'rgba(131, 129, 217, 0.12)',
    logoPath: '/protocols/aave-official.svg',
    isActive: true,
    defaultEnabled: true,
    description: 'Battle-tested lending protocol with $10B+ TVL globally',
    auditBadge: 'Audited',
    explorerUrl: EXPLORER.address(CONTRACTS.AAVE_POOL),
    vaultUrl: 'https://app.aave.com/reserve-overview/?underlyingAsset=0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e&marketName=proto_avalanche_v3',
  },
  benqi: {
    id: 'benqi' as const,
    name: 'Benqi',
    shortName: 'Benqi',
    category: 'Lending',
    asset: 'USDC',
    contractAddress: CONTRACTS.BENQI_QIUSDC,
    riskScore: 10,    // Safety 3 + Liquidity 3 + Collateral 2 + Yield 2 + Architecture 1 = 10/10
    color: '#2A72FF', // Benqi brand blue
    bgColor: 'rgba(42, 114, 255, 0.12)',
    logoPath: '/protocols/benqi-official.svg',
    isActive: true,
    defaultEnabled: true,
    description: 'Native Avalanche lending protocol — the original Avalanche DeFi pillar',
    auditBadge: 'Audited',
    explorerUrl: EXPLORER.address(CONTRACTS.BENQI_QIUSDC),
    vaultUrl: 'https://app.benqi.fi/lending',
  },
  spark: {
    id: 'spark' as const,
    name: 'Spark Savings',
    shortName: 'Spark',
    category: 'Savings',
    asset: 'USDC',
    contractAddress: CONTRACTS.SPARK_SPUSDC,
    riskScore: 9,     // Safety 3 + Liquidity 3 + Collateral 2 + Yield 2 + Architecture 0 = 9/10
    color: '#FFB347', // Spark brand orange
    bgColor: 'rgba(255, 179, 71, 0.12)',
    logoPath: '/protocols/spark-official.svg',
    isActive: true,
    defaultEnabled: true,
    description: 'MakerDAO-backed savings protocol (ERC-4626) on Avalanche',
    auditBadge: 'Audited',
    explorerUrl: CONTRACTS.SPARK_SPUSDC ? EXPLORER.address(CONTRACTS.SPARK_SPUSDC) : '',
    vaultUrl: 'https://app.spark.fi/savings/avalanche/spusdc',
  },
  euler_v2: {
    id: 'euler_v2' as const,
    name: 'Euler (9Summits)',
    shortName: 'Euler (9Summits)',
    category: 'Lending',
    asset: 'USDC',
    contractAddress: CONTRACTS.EULER_VAULT,
    riskScore: 6,     // Safety 2 + Liquidity 2 + Collateral 1 + Yield 1 + Architecture 0 = 6/10
    color: '#4A6CF6',
    bgColor: 'rgba(74, 108, 246, 0.12)',
    logoPath: '/protocols/euler-official.svg',
    isActive: true,
    defaultEnabled: true,
    description: 'High-yield isolated vault; optimizer still enforces utilization and safety checks',
    auditBadge: 'Audited',
    explorerUrl: CONTRACTS.EULER_VAULT ? EXPLORER.address(CONTRACTS.EULER_VAULT) : '',
    vaultUrl: 'https://app.euler.finance/vault/0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e?network=avalanche',
  },
  silo_savusd_usdc: {
    id: 'silo_savusd_usdc' as const,
    name: 'Silo (savUSD/USDC)',
    shortName: 'Silo',
    category: 'Lending',
    asset: 'USDC',
    contractAddress: CONTRACTS.SILO_SAVUSD_VAULT,
    riskScore: 8,     // Safety 3 + Liquidity 2 + Collateral 1 + Yield 1 + Architecture 1 = 8/10
    color: '#22C55E',
    bgColor: 'rgba(34, 197, 94, 0.12)',
    logoPath: '/protocols/silo-official.svg',
    isActive: true,
    defaultEnabled: true,
    description: 'Isolated lending market — savUSD/USDC on Silo V2',
    auditBadge: 'Audited',
    explorerUrl: EXPLORER.address(CONTRACTS.SILO_SAVUSD_VAULT),
    vaultUrl: 'https://app.silo.finance/markets/avalanche/142?action=deposit',
  },
  silo_susdp_usdc: {
    id: 'silo_susdp_usdc' as const,
    name: 'Silo (sUSDp/USDC)',
    shortName: 'Silo',
    category: 'Lending',
    asset: 'USDC',
    contractAddress: CONTRACTS.SILO_SUSDP_VAULT,
    riskScore: 6,     // Safety 2 + Liquidity 1 + Collateral 1 + Yield 1 + Architecture 1 = 6/10
    color: '#16A34A',
    bgColor: 'rgba(22, 163, 74, 0.12)',
    logoPath: '/protocols/silo-official.svg',
    isActive: true,
    defaultEnabled: true,
    description: 'Isolated lending market — sUSDp/USDC on Silo V2',
    auditBadge: 'Audited',
    explorerUrl: EXPLORER.address(CONTRACTS.SILO_SUSDP_VAULT),
    vaultUrl: 'https://app.silo.finance/markets/avalanche/susdp-usdc-162?action=deposit',
  },
} as const

// Idle USDC display config (not a real protocol, used for dashboard)
export const IDLE_CONFIG = {
  id: 'idle' as const,
  name: 'Idle USDC',
  shortName: 'Idle',
  color: '#64748B',
  bgColor: 'rgba(100, 116, 139, 0.12)',
  riskScore: 0,
} as const

export type ProtocolId = keyof typeof PROTOCOL_CONFIG

// Protocol IDs used by optimizer/runtime paths (keep aave alias for compatibility)
export const ACTIVE_PROTOCOLS: ProtocolId[] = ['aave_v3', 'aave', 'benqi', 'spark', 'euler_v2', 'silo_savusd_usdc', 'silo_susdp_usdc']

// Session key on-chain call policy — function selectors per protocol
export const SESSION_KEY_SELECTORS = {
  aave_v3: {
    supply:   '0x617ba037',
    withdraw: '0x69328dec',
  },
  aave: {
    supply:   '0x617ba037',  // supply(address,uint256,address,uint16)
    withdraw: '0x69328dec',  // withdraw(address,uint256,address)
  },
  benqi: {
    mint:   '0xa0712d68',  // mint(uint256)
    redeem: '0xdb006a75',  // redeem(uint256)
  },
  spark: {
    deposit:  '0x6e553f65',  // deposit(uint256,address) — ERC-4626
    withdraw: '0xb460af94',  // withdraw(uint256,address,address) — ERC-4626
    redeem:   '0xba087652',  // redeem(uint256,address,address) — ERC-4626
  },
  euler_v2: {
    deposit:  '0x6e553f65',
    withdraw: '0xb460af94',  // withdraw(uint256,address,address) — ERC-4626
    redeem:   '0xba087652',
  },
  silo_savusd_usdc: {
    deposit:  '0x6e553f65',  // deposit(uint256,address) — ERC-4626
    withdraw: '0xb460af94',  // withdraw(uint256,address,address) — ERC-4626
    redeem:   '0xba087652',  // redeem(uint256,address,address) — ERC-4626
  },
  silo_susdp_usdc: {
    deposit:  '0x6e553f65',  // deposit(uint256,address) — ERC-4626
    withdraw: '0xb460af94',  // withdraw(uint256,address,address) — ERC-4626
    redeem:   '0xba087652',  // redeem(uint256,address,address) — ERC-4626
  },
} as const

// Agent fee configuration
export const FEE_CONFIG = {
  rate: 0.10,            // 10% of profit
  label: 'Agent Fee',
  description: '10% of yield earned — only charged when you withdraw',
} as const

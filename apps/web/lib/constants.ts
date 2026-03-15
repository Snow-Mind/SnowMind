import { avalanche, avalancheFuji } from 'viem/chains'

// ── Chain configuration (env-driven) ────────────────────────────────────────
const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '43114')
export const CHAIN = chainId === 43113 ? avalancheFuji : avalanche
export const CHAIN_ID = chainId

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export const ZERODEV_PROJECT_ID =
  process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? "";

export const AVALANCHE_RPC_URL =
  process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL ?? "https://api.avax.network/ext/bc/C/rpc";

export const IS_TESTNET = chainId === 43113

// Mainnet contract addresses (override via env for dev/staging on Fuji)
export const CONTRACTS = {
  REGISTRY:    (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? '') as `0x${string}`,

  // Aave V3 on Avalanche mainnet
  AAVE_POOL:   (process.env.NEXT_PUBLIC_AAVE_POOL_ADDRESS ?? '0x794a61358D6845594F94dc1DB02A252b5b4814aD') as `0x${string}`,

  // Benqi qiUSDCn on Avalanche mainnet
  BENQI_POOL:  (process.env.NEXT_PUBLIC_BENQI_POOL_ADDRESS ?? '0xB715808a78F6041E46d61Cb123C9B4A27056AE9C') as `0x${string}`,
  // Euler V2 USDC vault on Avalanche mainnet
  EULER_VAULT: (process.env.NEXT_PUBLIC_EULER_VAULT_ADDRESS ?? '0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e') as `0x${string}`,
  // Spark spUSDC savings vault on Avalanche mainnet
  SPARK_VAULT: (process.env.NEXT_PUBLIC_SPARK_VAULT_ADDRESS ?? '0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d') as `0x${string}`,

  // Native USDC on Avalanche mainnet (Circle-issued)
  USDC:        (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E') as `0x${string}`,

  // ZeroDev / ERC-4337
  ENTRYPOINT_V07: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as `0x${string}`,

  // SnowMind treasury (Gnosis Safe multisig) — fee collection target
  TREASURY: (process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? '') as `0x${string}`,
} as const

const explorerBase = IS_TESTNET ? 'https://testnet.snowtrace.io' : 'https://snowtrace.io'
export const EXPLORER = {
  base: explorerBase,
  tx: (hash: string) => `${explorerBase}/tx/${hash}`,
  address: (addr: string) => `${explorerBase}/address/${addr}`,
  contract: (addr: string) => `${explorerBase}/address/${addr}#code`,
}

const pimlicoChain = IS_TESTNET ? 'avalanche-fuji' : 'avalanche'
export const PIMLICO = {
  rpc: `https://api.pimlico.io/v2/${pimlicoChain}/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`,
  bundlerRpc: `https://api.pimlico.io/v1/${pimlicoChain}/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`,
}

// Protocol metadata — drives ALL UI rendering. Add new protocols here only.
export const PROTOCOL_CONFIG = {
  aave_v3: {
    id: 'aave_v3' as const,
    name: 'Aave V3',
    shortName: 'Aave',
    contractAddress: CONTRACTS.AAVE_POOL,
    usdcAddress: CONTRACTS.USDC,
    riskScore: 2.0,   // From document: Aave = 2 (safest)
    color: '#8381D9', // Aave brand purple
    bgColor: 'rgba(131, 129, 217, 0.12)',
    logoPath: '/protocols/aave-official.svg',
    isActive: true,
    isComingSoon: false,
    minAllocation: 500,        // $500 minimum position
    maxAllocationPct: 0.60,    // 60% cap (document: "no more than 60% per protocol")
    description: 'Battle-tested lending protocol with $10B+ TVL globally',
    auditBadge: 'Audited',
    explorerUrl: EXPLORER.address(CONTRACTS.AAVE_POOL),
    vaultUrl: 'https://app.aave.com/reserve-overview/?underlyingAsset=0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e&marketName=proto_avalanche_v3',
  },
  benqi: {
    id: 'benqi' as const,
    name: 'Benqi',
    shortName: 'Benqi',
    contractAddress: CONTRACTS.BENQI_POOL,
    usdcAddress: CONTRACTS.USDC,
    riskScore: 3.0,   // From document: Benqi = 3
    color: '#2A72FF', // Benqi brand blue (higher contrast for charts)
    bgColor: 'rgba(42, 114, 255, 0.12)',
    logoPath: '/protocols/benqi-official.svg',
    isActive: true,
    isComingSoon: false,
    minAllocation: 500,
    maxAllocationPct: 0.60,
    description: 'Native Avalanche lending protocol — the original Avalanche DeFi pillar',
    auditBadge: 'Audited',
    explorerUrl: EXPLORER.address(CONTRACTS.BENQI_POOL),
    vaultUrl: 'https://app.benqi.fi/lending',
  },
  euler_v2: {
    id: 'euler_v2' as const,
    name: 'Euler V2',
    shortName: 'Euler',
    contractAddress: CONTRACTS.EULER_VAULT,
    usdcAddress: CONTRACTS.USDC,
    riskScore: 5.0,   // From document: Euler V2 = 5 (newer, add with caution)
    color: '#4A6CF6', // Euler brand blue
    bgColor: 'rgba(74, 108, 246, 0.12)',
    logoPath: '/protocols/euler-official.svg',
    isActive: true,
    isComingSoon: false,
    minAllocation: 500,
    maxAllocationPct: 0.20,  // Lower cap until proven (document: "start with 20% cap")
    description: 'Next-gen modular lending (ERC-4626) on Avalanche.',
    auditBadge: 'Audited (Ethereum)',
    explorerUrl: CONTRACTS.EULER_VAULT ? EXPLORER.address(CONTRACTS.EULER_VAULT) : '',
    vaultUrl: 'https://app.euler.finance/vault/0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e?network=avalanche',
  },
  spark: {
    id: 'spark' as const,
    name: 'Spark',
    shortName: 'Spark',
    contractAddress: CONTRACTS.SPARK_VAULT,
    usdcAddress: CONTRACTS.USDC,
    riskScore: 3.0,
    color: '#FFB347', // Spark brand orange
    bgColor: 'rgba(255, 179, 71, 0.12)',
    logoPath: '/protocols/spark-official.svg',
    isActive: true,
    isComingSoon: false,
    minAllocation: 500,
    maxAllocationPct: 0.40,
    description: 'MakerDAO-backed savings protocol (ERC-4626) on Avalanche.',
    auditBadge: 'Audited',
    explorerUrl: CONTRACTS.SPARK_VAULT ? EXPLORER.address(CONTRACTS.SPARK_VAULT) : '',
    vaultUrl: 'https://app.spark.fi/savings/avalanche/spusdc',
  },
} as const

// Idle USDC display config (not a real protocol, used for dashboard)
export const IDLE_CONFIG = {
  id: 'idle' as const,
  name: 'Idle USDC',
  shortName: 'Idle',
  color: '#64748B',  // slate gray
  bgColor: 'rgba(100, 116, 139, 0.12)',
  riskScore: 0,
} as const

export type ProtocolId = keyof typeof PROTOCOL_CONFIG

// Only protocols the waterfall allocator considers (all 4 active on mainnet)
export const ACTIVE_PROTOCOLS: ProtocolId[] = ['aave_v3', 'benqi', 'euler_v2', 'spark']

// Document: Session key allowedFunctions per protocol
export const SESSION_KEY_SELECTORS = {
  aave_v3: {
    supply:   '0x617ba037',  // supply(address,uint256,address,uint16)
    withdraw: '0x69328dec',  // withdraw(address,uint256,address)
  },
  benqi: {
    mint:   '0xa0712d68',  // mint(uint256)
    redeem: '0xdb006a75',  // redeem(uint256)
  },
  euler_v2: {
    deposit: '0x6e553f65',  // deposit(uint256,address)  — ERC-4626
    redeem:  '0xba087652',  // redeem(uint256,address,address) — ERC-4626
  },
  spark: {
    deposit: '0x6e553f65',  // deposit(uint256,address)  — ERC-4626
    redeem:  '0xba087652',  // redeem(uint256,address,address) — ERC-4626
  },
} as const

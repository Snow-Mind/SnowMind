import { avalancheFuji } from 'viem/chains'

export const CHAIN = avalancheFuji  // testnet for MVP; switch to avalanche for mainnet
export const CHAIN_ID = 43113

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export const ZERODEV_PROJECT_ID =
  process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? "";

export const AVALANCHE_RPC_URL =
  process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc";

export const IS_TESTNET = process.env.NEXT_PUBLIC_CHAIN_ID === '43113' || CHAIN_ID === 43113

// Fuji Testnet Addresses (verify at docs.aave.com before use)
export const CONTRACTS = {
  // Our deployed contracts (Fuji 43113)
  REGISTRY:    (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? '0xf842428ad92689741cafb0029f4d76361b2d02d4') as `0x${string}`,

  // Aave V3 on Fuji
  AAVE_POOL:   '0x1775ECC8362dB6CaB0c7A9C0957cF656A5276c29' as `0x${string}`,
  AAVE_FAUCET: '0xA70D8aD6d26931d0188c642A66de3B6202cDc5FA' as `0x${string}`,

  // MockBenqi on Fuji (real Benqi is mainnet-only)
  BENQI_POOL:  (process.env.NEXT_PUBLIC_BENQI_POOL_ADDRESS ?? '0x6ac240d13b85a698ee407617e51f9baab9e395a9') as `0x${string}`,
  // MockEuler, shown as coming soon
  EULER_VAULT: (process.env.NEXT_PUBLIC_EULER_VAULT_ADDRESS ?? '0x372193056e6c57040548ce833ee406509a457632') as `0x${string}`,

  // Test tokens
  USDC:        '0x5425890298aed601595a70AB815c96711a31Bc65' as `0x${string}`,

  // ZeroDev / ERC-4337
  ENTRYPOINT_V07: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as `0x${string}`,
} as const

export const EXPLORER = {
  base: 'https://testnet.snowtrace.io',
  tx: (hash: string) => `https://testnet.snowtrace.io/tx/${hash}`,
  address: (addr: string) => `https://testnet.snowtrace.io/address/${addr}`,
  contract: (addr: string) => `https://testnet.snowtrace.io/address/${addr}#code`,
}

export const PIMLICO = {
  rpc: `https://api.pimlico.io/v2/avalanche-fuji/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`,
  bundlerRpc: `https://api.pimlico.io/v1/avalanche-fuji/rpc?apikey=${process.env.NEXT_PUBLIC_PIMLICO_API_KEY}`,
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
    logoPath: '/protocols/aave-brand.svg',
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
    color: '#00C4FF', // Benqi brand cyan
    bgColor: 'rgba(0, 196, 255, 0.12)',
    logoPath: '/protocols/benqi-brand.svg',
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
    logoPath: '/protocols/euler-brand.svg',
    logoPath: '/protocols/euler.svg',
    isActive: false,  // Not in optimizer yet
    isComingSoon: true,
    minAllocation: 500,
    maxAllocationPct: 0.20,  // Lower cap until proven (document: "start with 20% cap")
    description: 'Next-gen modular lending (ERC-4626). Live on Ethereum, coming to Avalanche.',
    auditBadge: 'Audited (Ethereum)',
    explorerUrl: EXPLORER.address(CONTRACTS.EULER_VAULT),
    vaultUrl: 'https://app.euler.finance/vault/0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9',
  },
  spark: {
    id: 'spark' as const,
    name: 'Spark',
    shortName: 'Spark',
    contractAddress: '0x0000000000000000000000000000000000000000' as `0x${string}`, // placeholder
    usdcAddress: CONTRACTS.USDC,
    riskScore: 3.0,
    color: '#FFB347', // Spark brand orange
    bgColor: 'rgba(255, 179, 71, 0.12)',
    logoPath: '/protocols/spark-brand.svg',
    isActive: false,
    isComingSoon: true,
    minAllocation: 500,
    maxAllocationPct: 0.60,
    description: 'MakerDAO-backed lending protocol with competitive rates.',
    auditBadge: 'Audited',
    explorerUrl: '',
    vaultUrl: 'https://app.spark.fi/markets/',
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

// Only protocols the MILP optimizer considers for MVP
export const ACTIVE_PROTOCOLS: ProtocolId[] = ['aave_v3', 'benqi']

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
    supply:   '0x00000000',  // placeholder — coming soon
    withdraw: '0x00000000',  // placeholder — coming soon
  },
} as const

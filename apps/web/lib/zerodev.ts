// apps/web/lib/zerodev.ts
// Correct ZeroDev Kernel v3.1 integration per kernel architecture document.

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk"
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants"
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator"
import {
  toPermissionValidator,
  serializePermissionAccount,
} from "@zerodev/permissions"
import { toECDSASigner } from "@zerodev/permissions/signers"
import {
  toCallPolicy,
  toGasPolicy,
  toRateLimitPolicy,
  toTimestampPolicy,
  ParamCondition,
  CallPolicyVersion,
} from "@zerodev/permissions/policies"
import {
  createPublicClient,
  http,
  encodeFunctionData,
  maxUint256,
  parseUnits,
  type PublicClient,
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { CHAIN, EXPLORER } from "./constants"

const ENTRYPOINT = getEntryPoint("0.7")
const ZERODEV_PROJECT_ID = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? ""
const BUNDLER_URL = `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/${CHAIN.id}`
const PAYMASTER_URL = `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/${CHAIN.id}`

// ── Minimal ABIs — ABI-based call policies (not raw hex selectors) ────────────

const ERC20_ABI = [
  {
    name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const

// ERC-20 transfer — used ONLY for fee collection to treasury (scoped by call policy)
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const

export const AAVE_POOL_ABI = [
  {
    name: "supply", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "asset",         type: "address" },
      { name: "amount",        type: "uint256" },
      { name: "onBehalfOf",    type: "address" },
      { name: "referralCode",  type: "uint16"  },
    ],
    outputs: [],
  },
  {
    name: "withdraw", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "asset",  type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to",     type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const

export const BENQI_ABI = [
  {
    name: "mint", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "mintAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "redeem", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "redeemTokens", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const

// ERC-4626 vault ABI — shared by Euler V2 and Spark
export const ERC4626_VAULT_ABI = [
  {
    name: "deposit", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "assets",   type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "redeem", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "shares",   type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner",    type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const

// ── getPublicClient ───────────────────────────────────────────────────────────

function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: CHAIN,
    transport: http(process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL),
  })
}

// ── 1. Create smart account (sudo — user is the owner) ───────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createSmartAccount(walletClient: any) {
  const publicClient = getPublicClient()

  // Sudo validator: user's wallet is the owner (full control)
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: walletClient,
    entryPoint: ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,           // ← constant, NOT string "0.3.1"
  })

  // index: 0n is REQUIRED for deterministic address
  // Kernel doc: "same owner + same index = same address, always"
  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: ecdsaValidator },
    entryPoint: ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,
    index: 0n,                            // ← CRITICAL: BigInt 0, not 0
  })

  const paymasterClient = createZeroDevPaymasterClient({
    chain: CHAIN,
    transport: http(PAYMASTER_URL),
  })

  const kernelClient = createKernelAccountClient({
    account: kernelAccount,
    chain: CHAIN,
    bundlerTransport: http(BUNDLER_URL),
    paymaster: {
      getPaymasterData(userOperation) {
        return paymasterClient.sponsorUserOperation({ userOperation })
      },
    },
  })

  return {
    kernelAccount,
    kernelClient,
    smartAccountAddress: kernelAccount.address as `0x${string}`,
  }
}

// ── 2. Approve all protocols in ONE batched UserOp ───────────────────────────

export async function approveAllProtocols(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelClient: any,
  contracts: { USDC: `0x${string}`; AAVE_POOL: `0x${string}`; BENQI_POOL: `0x${string}`; EULER_VAULT: `0x${string}`; SPARK_VAULT: `0x${string}` }
): Promise<{ txHash: string; explorerUrl: string }> {

  const approvalCalls = [
    contracts.AAVE_POOL,
    contracts.BENQI_POOL,
    contracts.EULER_VAULT,
    contracts.SPARK_VAULT,
  ]
    .filter(addr => addr !== '0x0000000000000000000000000000000000000000')
    .map(spender => ({
      to: contracts.USDC,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, maxUint256],
      }),
    }))

  // Correct API: sendTransaction with calls array (NOT sendUserOperation)
  const txHash = await kernelClient.sendTransaction({ calls: approvalCalls })

  return { txHash, explorerUrl: EXPLORER.tx(txHash) }
}

// ── 3. Grant session key and serialize ───────────────────────────────────────
// Kernel doc: "serializePermissionAccount is the correct pattern"
// Returns serialized string — NOT a private key. Backend stores and uses this.

export async function grantAndSerializeSessionKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelAccount: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelClient: any,
  contracts: {
    AAVE_POOL:    `0x${string}`
    BENQI_POOL:   `0x${string}`
    EULER_VAULT:  `0x${string}`
    SPARK_VAULT:  `0x${string}`
    USDC:         `0x${string}`
    TREASURY:     `0x${string}`
  },
  config: {
    maxAmountUSDC:  number   // max USDC per single tx e.g. 10000
    durationDays:   number   // session key lifetime e.g. 30
    maxOpsPerDay:   number   // rate limit e.g. 20
    userEOA:        `0x${string}`  // user's EOA address for withdrawal transfers
  }
): Promise<{
  serializedPermission: string   // Send to backend — store encrypted in DB
  sessionKeyAddress:    string
  expiresAt:            number   // Unix timestamp
}> {
  const publicClient = getPublicClient()
  const maxAmount    = parseUnits(config.maxAmountUSDC.toString(), 6)
  const expiresAt    = Math.floor(Date.now() / 1000) + config.durationDays * 86400

  // Generate ephemeral session key
  const sessionPrivateKey  = generatePrivateKey()
  const sessionKeyAccount  = privateKeyToAccount(sessionPrivateKey)

  // toECDSASigner — correct import for permission validators
  const sessionKeySigner   = await toECDSASigner({ signer: sessionKeyAccount })

  // ── Call Policy: ABI-based, type-safe (not raw hex selectors) ─────────────
  // Build permissions array — Spark entries added conditionally
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`
  const hasSparkVault = contracts.SPARK_VAULT !== ZERO_ADDR

  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_4,
    permissions: [

      // USDC approve — allow session key to set approvals for protocol contracts
      {
        target: contracts.USDC,
        valueLimit: 0n,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [
          { condition: ParamCondition.EQUAL, value: contracts.AAVE_POOL },
          null,   // amount — any (maxUint256 for efficiency)
        ],
      },
      {
        target: contracts.USDC,
        valueLimit: 0n,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [
          { condition: ParamCondition.EQUAL, value: contracts.BENQI_POOL },
          null,
        ],
      },
      {
        target: contracts.USDC,
        valueLimit: 0n,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [
          { condition: ParamCondition.EQUAL, value: contracts.EULER_VAULT },
          null,
        ],
      },
      // Spark USDC approve (uses Euler vault as fallback target when unconfigured — never reached)
      {
        target: contracts.USDC,
        valueLimit: 0n,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [
          { condition: ParamCondition.EQUAL, value: hasSparkVault ? contracts.SPARK_VAULT : contracts.EULER_VAULT },
          null,
        ],
      },

      // AAVE V3 — supply (USDC only, amount capped)
      {
        target: contracts.AAVE_POOL,
        valueLimit: 0n,
        abi: AAVE_POOL_ABI,
        functionName: "supply",
        args: [
          { condition: ParamCondition.EQUAL,              value: contracts.USDC },
          { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
          null,   // onBehalfOf — any
          null,   // referralCode — any
        ],
      },

      // AAVE V3 — withdraw (USDC only)
      {
        target: contracts.AAVE_POOL,
        valueLimit: 0n,
        abi: AAVE_POOL_ABI,
        functionName: "withdraw",
        args: [
          { condition: ParamCondition.EQUAL, value: contracts.USDC },
          null,   // amount — including MAX_UINT for full exit
          null,   // to — any
        ],
      },

      // BENQI — mint (supply)
      {
        target: contracts.BENQI_POOL,
        valueLimit: 0n,
        abi: BENQI_ABI,
        functionName: "mint",
        args: [
          { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
        ],
      },

      // BENQI — redeem (withdraw qiTokens)
      {
        target: contracts.BENQI_POOL,
        valueLimit: 0n,
        abi: BENQI_ABI,
        functionName: "redeem",
        args: [null],   // qiToken amounts differ from USDC, no cap here
      },

      // EULER V2 — deposit (ERC-4626)
      {
        target: contracts.EULER_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [
          { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
          null,   // receiver — any
        ],
      },

      // EULER V2 — redeem (ERC-4626)
      {
        target: contracts.EULER_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [null, null, null],   // shares, receiver, owner — any
      },

      // SPARK — deposit (ERC-4626, same interface as Euler)
      {
        target: hasSparkVault ? contracts.SPARK_VAULT : contracts.EULER_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [
          { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
          null,
        ],
      },

      // SPARK — redeem (ERC-4626)
      {
        target: hasSparkVault ? contracts.SPARK_VAULT : contracts.EULER_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [null, null, null],
      },

      // USDC.transfer — fee collection to SnowMind treasury ONLY
      // On-chain enforced: recipient MUST be treasury, amount capped at maxAmount
      ...(contracts.TREASURY !== ZERO_ADDR ? [{
        target: contracts.USDC,
        valueLimit: 0n,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer" as const,
        args: [
          { condition: ParamCondition.EQUAL as const, value: contracts.TREASURY },
          { condition: ParamCondition.LESS_THAN_OR_EQUAL as const, value: maxAmount },
        ] as const,
      }] : []),

      // USDC.transfer — withdrawal to user's own EOA (uncapped, it's their money)
      // Two separate entries because ZeroDev doesn't support OR-conditions on args
      ...(config.userEOA !== ZERO_ADDR ? [{
        target: contracts.USDC,
        valueLimit: 0n,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer" as const,
        args: [
          { condition: ParamCondition.EQUAL as const, value: config.userEOA },
          null,   // amount — uncapped for user's own withdrawal
        ] as const,
      }] : []),
    ],
  })

  // Gas policy: total gas cap prevents runaway spending
  // Kernel doc: "Prevents a runaway agent from burning unlimited gas"
  const gasPolicy = toGasPolicy({ allowed: parseUnits("0.5", 18) })

  // Rate limit: max rebalances per day
  const rateLimitPolicy = toRateLimitPolicy({
    count:    config.maxOpsPerDay,
    interval: 86400,
  })

  // Timestamp: auto-expire
  const timestampPolicy = toTimestampPolicy({ validUntil: expiresAt })

  // Compose all policies — ALL must pass for every UserOp
  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint:    ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,
    signer:        sessionKeySigner,
    policies:      [callPolicy, gasPolicy, rateLimitPolicy, timestampPolicy],
  })

  // Create permission account using the user's kernel account as base
  const paymasterClient = createZeroDevPaymasterClient({
    chain: CHAIN, transport: http(PAYMASTER_URL),
  })

  const permissionAccount = await createKernelAccount(publicClient, {
    plugins: {
      sudo:    kernelAccount.kernelPluginManager?.sudoValidator,
      regular: permissionPlugin,
    },
    entryPoint:    ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,
    index: 0n,
  })

  const permissionClient = createKernelAccountClient({
    account: permissionAccount,
    chain: CHAIN,
    bundlerTransport: http(BUNDLER_URL),
    paymaster: {
      getPaymasterData(userOperation) {
        return paymasterClient.sponsorUserOperation({ userOperation })
      },
    },
  })

  const sudoValidator = kernelAccount.kernelPluginManager?.sudoValidator
  if (!sudoValidator) {
    throw new Error("Missing sudo validator on kernel account; cannot approve permission plugin")
  }

  // Explicitly produce the plugin enable signature from the sudo context.
  // This avoids kernel-side EnableNotApproved reverts during validateUserOp.
  const enableSignature = await permissionAccount.kernelPluginManager.getPluginEnableSignature(
    permissionAccount.address,
    permissionPlugin,
  )

  // CRITICAL: Serialize WITH the ephemeral session private key embedded so the
  // backend execution service can reconstruct the signer via deserializePermissionAccount.
  // The key is ephemeral, policy-constrained, and time-limited.
  const serializedPermission = await serializePermissionAccount(
    permissionClient.account,
    sessionPrivateKey,
    enableSignature,
    undefined,
    permissionPlugin,
    true,
  )

  return {
    serializedPermission,
    sessionKeyAddress: sessionKeyAccount.address,
    expiresAt,
  }
}

// ── 4. Immediate initial deployment (sudo path) ─────────────────────────────

export async function deployInitialToProtocol(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelClient: any,
  smartAccountAddress: `0x${string}`,
  contracts: {
    AAVE_POOL: `0x${string}`
    BENQI_POOL: `0x${string}`
    EULER_VAULT: `0x${string}`
    SPARK_VAULT: `0x${string}`
    USDC: `0x${string}`
  },
  protocolId: "aave_v3" | "benqi" | "euler_v2" | "spark",
  amountUsdc: number,
): Promise<{ txHash: string; explorerUrl: string }> {
  const amount = parseUnits(amountUsdc.toFixed(6), 6)

  const calls = [] as Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }>

  // Defensive idempotent approve before deposit, in case allowance changed.
  const spender =
    protocolId === "aave_v3" ? contracts.AAVE_POOL
      : protocolId === "benqi" ? contracts.BENQI_POOL
      : protocolId === "euler_v2" ? contracts.EULER_VAULT
      : contracts.SPARK_VAULT

  calls.push({
    to: contracts.USDC,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, maxUint256],
    }),
  })

  if (protocolId === "aave_v3") {
    calls.push({
      to: contracts.AAVE_POOL,
      value: 0n,
      data: encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: "supply",
        args: [contracts.USDC, amount, smartAccountAddress, 0],
      }),
    })
  } else if (protocolId === "benqi") {
    calls.push({
      to: contracts.BENQI_POOL,
      value: 0n,
      data: encodeFunctionData({
        abi: BENQI_ABI,
        functionName: "mint",
        args: [amount],
      }),
    })
  } else if (protocolId === "euler_v2") {
    calls.push({
      to: contracts.EULER_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [amount, smartAccountAddress],
      }),
    })
  } else {
    calls.push({
      to: contracts.SPARK_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [amount, smartAccountAddress],
      }),
    })
  }

  const txHash = await kernelClient.sendTransaction({ calls })
  return { txHash, explorerUrl: EXPLORER.tx(txHash) }
}

// ── 5. Revoke session key (user-initiated) ───────────────────────────────────

export async function revokeSessionKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelClient: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  permissionPlugin: any
): Promise<{ txHash: string; explorerUrl: string }> {
  const txHash = await kernelClient.uninstallPlugin({ plugin: permissionPlugin })
  return { txHash, explorerUrl: EXPLORER.tx(txHash) }
}

// ── 6. Emergency: withdraw all from specific protocol (user-signed, no session key)

export async function emergencyWithdrawAll(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelClient: any,
  smartAccountAddress: `0x${string}`,
  contracts: { AAVE_POOL: `0x${string}`; BENQI_POOL: `0x${string}`; EULER_VAULT: `0x${string}`; SPARK_VAULT: `0x${string}`; USDC: `0x${string}` },
  benqiQiTokenBalance: bigint,   // fetch this from on-chain before calling
  eulerShareBalance: bigint,     // ERC-4626 shares
  sparkShareBalance: bigint,     // ERC-4626 shares
): Promise<{ txHash: string; explorerUrl: string }> {
  const calls = [
    // Withdraw all from Aave (MAX_UINT = full balance)
    {
      to: contracts.AAVE_POOL,
      value: 0n,
      data: encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: "withdraw",
        args: [contracts.USDC, maxUint256, smartAccountAddress],
      }),
    },
    // Redeem all from Benqi (exact qiToken balance)
    ...(benqiQiTokenBalance > 0n ? [{
      to: contracts.BENQI_POOL,
      value: 0n,
      data: encodeFunctionData({
        abi: BENQI_ABI,
        functionName: "redeem",
        args: [benqiQiTokenBalance],
      }),
    }] : []),
    // Redeem all from Euler V2 (ERC-4626)
    ...(eulerShareBalance > 0n ? [{
      to: contracts.EULER_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [eulerShareBalance, smartAccountAddress, smartAccountAddress],
      }),
    }] : []),
    // Redeem all from Spark (ERC-4626)
    ...(sparkShareBalance > 0n && contracts.SPARK_VAULT !== '0x0000000000000000000000000000000000000000' ? [{
      to: contracts.SPARK_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [sparkShareBalance, smartAccountAddress, smartAccountAddress],
      }),
    }] : []),
  ]

  const txHash = await kernelClient.sendTransaction({ calls })
  return { txHash, explorerUrl: EXPLORER.tx(txHash) }
}

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
import { avalancheFuji } from "viem/chains"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

const CHAIN = avalancheFuji
const ENTRYPOINT = getEntryPoint("0.7")
const ZERODEV_PROJECT_ID = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? ""
const BUNDLER_URL = `https://rpc.zerodev.app/api/v2/bundler/${ZERODEV_PROJECT_ID}`
const PAYMASTER_URL = `https://rpc.zerodev.app/api/v2/paymaster/${ZERODEV_PROJECT_ID}`

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
  contracts: { USDC: `0x${string}`; AAVE_POOL: `0x${string}`; BENQI_POOL: `0x${string}`; EULER_VAULT: `0x${string}` }
): Promise<{ txHash: string; explorerUrl: string }> {

  // Correct API: sendTransaction with calls array (NOT sendUserOperation)
  const txHash = await kernelClient.sendTransaction({
    calls: [
      {
        to: contracts.USDC,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [contracts.AAVE_POOL, maxUint256],
        }),
      },
      {
        to: contracts.USDC,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [contracts.BENQI_POOL, maxUint256],
        }),
      },
      {
        to: contracts.USDC,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [contracts.EULER_VAULT, maxUint256],
        }),
      },
    ],
  })

  return { txHash, explorerUrl: `https://testnet.snowtrace.io/tx/${txHash}` }
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
    USDC:         `0x${string}`
  },
  config: {
    maxAmountUSDC:  number   // max USDC per single tx e.g. 10000
    durationDays:   number   // session key lifetime e.g. 30
    maxOpsPerDay:   number   // rate limit e.g. 20
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

  // CRITICAL: Serialize — this is what we send to backend, not the private key
  // Kernel doc: "The serialization step is crucial."
  const serializedPermission = await serializePermissionAccount(permissionClient.account)

  return {
    serializedPermission,
    sessionKeyAddress: sessionKeyAccount.address,
    expiresAt,
  }
}

// ── 4. Revoke session key (user-initiated) ───────────────────────────────────

export async function revokeSessionKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelClient: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  permissionPlugin: any
): Promise<{ txHash: string; explorerUrl: string }> {
  const txHash = await kernelClient.uninstallPlugin({ plugin: permissionPlugin })
  return { txHash, explorerUrl: `https://testnet.snowtrace.io/tx/${txHash}` }
}

// ── 5. Emergency: withdraw all from specific protocol (user-signed, no session key)

export async function emergencyWithdrawAll(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelClient: any,
  smartAccountAddress: `0x${string}`,
  contracts: { AAVE_POOL: `0x${string}`; BENQI_POOL: `0x${string}`; USDC: `0x${string}` },
  benqiQiTokenBalance: bigint,   // fetch this from on-chain before calling
): Promise<{ txHash: string; explorerUrl: string }> {
  const txHash = await kernelClient.sendTransaction({
    calls: [
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
    ],
  })
  return { txHash, explorerUrl: `https://testnet.snowtrace.io/tx/${txHash}` }
}

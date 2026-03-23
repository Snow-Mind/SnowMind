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
  ParamCondition,
  CallPolicyVersion,
} from "@zerodev/permissions/policies"
import {
  createPublicClient,
  http,
  encodeFunctionData,
  maxUint256,
  parseUnits,
  keccak256,
  hashTypedData,
  recoverTypedDataAddress,
  recoverMessageAddress,
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

// ERC-4626 vault ABI — used by Spark
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
    name: "withdraw", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "assets",   type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner",    type: "address" },
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

// SnowMindRegistry ABI — logRebalance (on-chain audit trail for rebalance ops)
const REGISTRY_ABI = [
  {
    name: "logRebalance", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "fromProtocol", type: "address" },
      { name: "toProtocol",   type: "address" },
      { name: "amount",       type: "uint256" },
    ],
    outputs: [],
  },
] as const

type CallPolicyPermission = NonNullable<Parameters<typeof toCallPolicy>[0]["permissions"]>[number]
type WalletClientLike = Parameters<typeof signerToEcdsaValidator>[1]["signer"]
type KernelAccountLike = Awaited<ReturnType<typeof createKernelAccount>>
type KernelClientLike = ReturnType<typeof createKernelAccountClient>
type PermissionPluginLike = Awaited<ReturnType<typeof toPermissionValidator>>

// ── getPublicClient ───────────────────────────────────────────────────────────

function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: CHAIN,
    transport: http(process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL),
  })
}

// ── 1. Create smart account (sudo — user is the owner) ───────────────────────

// Accept either:
// - A Privy ConnectedWallet (has getEthereumProvider) — PREFERRED, uses raw EIP-1193 provider
// - A WalletClientLike (viem Account/WalletClient) — fallback for non-Privy wallets
type PrivyWalletLike = { getEthereumProvider: () => Promise<unknown>; address: string }

export async function createSmartAccount(walletClient: WalletClientLike | PrivyWalletLike) {
  const publicClient = getPublicClient()

  // Fix for EnableNotApproved: Privy's toViemAccount() returns a "local" type
  // account, causing the ZeroDev SDK to call account.signTypedData() directly
  // (bypassing viem's JSON serialization). Privy then passes the raw typed data
  // object — including BigInt values — to eth_signTypedData_v4 via iframe RPC.
  // The BigInt values don't survive iframe serialization correctly, causing the
  // wallet to sign a DIFFERENT EIP-712 hash → EnableNotApproved on-chain.
  //
  // Fix: Use the raw EIP-1193 provider instead. The SDK's toSigner() creates a
  // WalletClient from it, and viem's signTypedData action JSON-stringifies the
  // typed data with proper BigInt→string conversion before sending to the provider.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let signer: any = walletClient
  if ('getEthereumProvider' in walletClient && typeof walletClient.getEthereumProvider === 'function') {
    signer = await walletClient.getEthereumProvider()
  }

  // Sudo validator: user's wallet is the owner (full control)
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer,
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

  // Address derivation is local and always succeeds.
  // Bundler/paymaster client creation calls ZeroDev RPC — may fail (400, credits, rate limit).
  // We separate them so the address is available even if bundler is down.
  let kernelClient
  try {
    // Sudo accounts use the paymaster client directly — the SDK extracts both
    // getPaymasterStubData and getPaymasterData internally.
    kernelClient = createKernelAccountClient({
      account: kernelAccount,
      chain: CHAIN,
      bundlerTransport: http(BUNDLER_URL),
      paymaster: createZeroDevPaymasterClient({
        chain: CHAIN,
        transport: http(PAYMASTER_URL),
      }),
    })
  } catch (err) {
    console.error("[ZeroDev] Failed to create bundler/paymaster client:", err)
    throw new Error(
      `Smart account address derived (${kernelAccount.address}) but ZeroDev bundler is unavailable. ` +
      `Check your ZeroDev project credits and configuration. ` +
      `Original error: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  return {
    kernelAccount,
    kernelClient,
    smartAccountAddress: kernelAccount.address as `0x${string}`,
  }
}

// ── 2. Approve all protocols in ONE batched UserOp ───────────────────────────
// maxAmountUSDC caps the ERC-20 allowance to match the session key call policy limit.
// Never use maxUint256 — a compromised protocol could drain unbounded funds.
// Default of 50,000 matches the platform beta deposit cap.

export async function approveAllProtocols(
  kernelClient: KernelClientLike,
  contracts: { USDC: `0x${string}`; AAVE_POOL: `0x${string}`; BENQI_POOL: `0x${string}`; SPARK_VAULT: `0x${string}`; EULER_VAULT: `0x${string}`; SILO_SAVUSD_VAULT: `0x${string}`; SILO_SUSDP_VAULT: `0x${string}` },
  maxAmountUSDC: number = 50_000,
): Promise<{ txHash: string; explorerUrl: string }> {

  const approvalAmount = parseUnits(maxAmountUSDC.toString(), 6)

  const approvalCalls = [
    contracts.AAVE_POOL,
    contracts.BENQI_POOL,
    contracts.SPARK_VAULT,
    contracts.EULER_VAULT,
    contracts.SILO_SAVUSD_VAULT,
    contracts.SILO_SUSDP_VAULT,
  ]
    .filter(addr => addr !== '0x0000000000000000000000000000000000000000')
    .map(spender => ({
      to: contracts.USDC,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, approvalAmount],
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
  kernelAccount: KernelAccountLike,
  _kernelClient: KernelClientLike,
  contracts: {
    AAVE_POOL:    `0x${string}`
    BENQI_POOL:   `0x${string}`
    SPARK_VAULT:  `0x${string}`
    EULER_VAULT:  `0x${string}`
    SILO_SAVUSD_VAULT: `0x${string}`
    SILO_SUSDP_VAULT:  `0x${string}`
    USDC:         `0x${string}`
    TREASURY:     `0x${string}`
    REGISTRY?:    `0x${string}`
  },
  config: {
    maxAmountUSDC:  number   // max USDC per single tx e.g. 10000
    durationDays:   number   // deprecated: session key no longer expires (kept for API compat)
    maxOpsPerDay:   number   // rate limit e.g. 20
    userEOA:        `0x${string}`  // user's EOA address for withdrawal transfers
  }
): Promise<{
  serializedPermission: string   // Send to backend — store encrypted in DB
  sessionPrivateKey:    string   // Hex private key — store encrypted alongside approval
  sessionKeyAddress:    string
  expiresAt:            number   // Unix timestamp
}> {
  const publicClient = getPublicClient()
  const maxAmount    = parseUnits(config.maxAmountUSDC.toString(), 6)
  // Session key never expires on-chain. Store a far-future date in DB for
  // backward compatibility with the expires_at NOT NULL column.
  // 4102444800 = 2100-01-01T00:00:00Z
  const expiresAt    = 4102444800

  // Generate ephemeral session key
  const sessionPrivateKey  = generatePrivateKey()
  const sessionKeyAccount  = privateKeyToAccount(sessionPrivateKey)

  // toECDSASigner — correct import for permission validators
  const sessionKeySigner   = await toECDSASigner({ signer: sessionKeyAccount })

  // ── Call Policy: ABI-based, type-safe (not raw hex selectors) ─────────────
  // Build permissions array — Spark entries added conditionally
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

  // Guard: TREASURY must be a valid 42-char hex address (not empty string '')
  const hasTreasury = contracts.TREASURY && contracts.TREASURY.length >= 42 && contracts.TREASURY !== ZERO_ADDR
  const treasuryTransferPermissions: CallPolicyPermission[] =
    hasTreasury
      ? [
          {
            target: contracts.USDC,
            valueLimit: 0n,
            abi: ERC20_TRANSFER_ABI,
            functionName: "transfer",
            args: [
              { condition: ParamCondition.EQUAL, value: contracts.TREASURY },
              { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
            ],
          },
        ]
      : []

  const hasUserEOA = config.userEOA && config.userEOA.length >= 42 && config.userEOA !== ZERO_ADDR
  const userTransferPermissions: CallPolicyPermission[] =
    hasUserEOA
      ? [
          {
            target: contracts.USDC,
            valueLimit: 0n,
            abi: ERC20_TRANSFER_ABI,
            functionName: "transfer",
            args: [
              { condition: ParamCondition.EQUAL, value: config.userEOA },
              null,
            ],
          },
        ]
      : []

  const permissions: CallPolicyPermission[] = [

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
          { condition: ParamCondition.EQUAL, value: contracts.SPARK_VAULT },
          null,
        ],
      },
      // Euler USDC approve
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
      // Silo savUSD/USDC USDC approve
      {
        target: contracts.USDC,
        valueLimit: 0n,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [
          { condition: ParamCondition.EQUAL, value: contracts.SILO_SAVUSD_VAULT },
          null,
        ],
      },
      // Silo sUSDp/USDC USDC approve
      {
        target: contracts.USDC,
        valueLimit: 0n,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [
          { condition: ParamCondition.EQUAL, value: contracts.SILO_SUSDP_VAULT },
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

      // SPARK — deposit (ERC-4626)
      {
        target: contracts.SPARK_VAULT,
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
        target: contracts.SPARK_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [null, null, null],
      },

      // SPARK — withdraw (ERC-4626, for known USDC amount withdrawals)
      {
        target: contracts.SPARK_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "withdraw",
        args: [null, null, null],
      },

      // EULER (9Summits) — deposit (ERC-4626)
      {
        target: contracts.EULER_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [
          { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
          null,
        ],
      },

      // EULER (9Summits) — redeem (ERC-4626)
      {
        target: contracts.EULER_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [null, null, null],
      },

      // EULER (9Summits) — withdraw (ERC-4626)
      {
        target: contracts.EULER_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "withdraw",
        args: [null, null, null],
      },

      // SILO savUSD/USDC — deposit (ERC-4626)
      {
        target: contracts.SILO_SAVUSD_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [
          { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
          null,
        ],
      },

      // SILO savUSD/USDC — redeem (ERC-4626)
      {
        target: contracts.SILO_SAVUSD_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [null, null, null],
      },

      // SILO savUSD/USDC — withdraw (ERC-4626)
      {
        target: contracts.SILO_SAVUSD_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "withdraw",
        args: [null, null, null],
      },

      // SILO sUSDp/USDC — deposit (ERC-4626)
      {
        target: contracts.SILO_SUSDP_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [
          { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
          null,
        ],
      },

      // SILO sUSDp/USDC — redeem (ERC-4626)
      {
        target: contracts.SILO_SUSDP_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [null, null, null],
      },

      // SILO sUSDp/USDC — withdraw (ERC-4626)
      {
        target: contracts.SILO_SUSDP_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "withdraw",
        args: [null, null, null],
      },
    // USDC.transfer — fee collection to SnowMind treasury ONLY
    // On-chain enforced: recipient MUST be treasury, amount capped at maxAmount
    ...treasuryTransferPermissions,

    // USDC.transfer — withdrawal to user's own EOA (uncapped, it's their money)
    // Two separate entries because ZeroDev doesn't support OR-conditions on args
    ...userTransferPermissions,
  ]

  // ── Registry logRebalance permission (optional — only when REGISTRY is deployed) ──
  const hasRegistry = contracts.REGISTRY && contracts.REGISTRY.length >= 42
    && contracts.REGISTRY !== ZERO_ADDR
  if (hasRegistry) {
    permissions.push({
      target: contracts.REGISTRY as `0x${string}`,
      valueLimit: 0n,
      abi: REGISTRY_ABI,
      functionName: "logRebalance",
      args: [null, null, null],  // fromProtocol, toProtocol, amount — any
    })
  }

  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_5,
    permissions,
  })

  // Gas policy: total gas cap prevents runaway spending
  // Kernel doc: "Prevents a runaway agent from burning unlimited gas"
  const gasPolicy = toGasPolicy({ allowed: parseUnits("0.5", 18) })

  // Rate limit: max rebalances per day
  const rateLimitPolicy = toRateLimitPolicy({
    count:    config.maxOpsPerDay,
    interval: 86400,
  })

  // Session key does NOT expire on-chain (infinite lifetime).
  // The agent runs indefinitely until the user revokes or does a full withdrawal.
  // No toTimestampPolicy — only call, gas, and rate-limit policies apply.

  // Compose all policies — ALL must pass for every UserOp
  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint:    ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,
    signer:        sessionKeySigner,
    policies:      [callPolicy, gasPolicy, rateLimitPolicy],
  })

  // Validate sudo validator exists BEFORE creating the permission account
  const sudoValidator = kernelAccount.kernelPluginManager?.sudoValidator
  if (!sudoValidator) {
    throw new Error("Missing sudo validator on kernel account; cannot approve permission plugin")
  }

  // Diagnostic: log the wallet address that will sign the enable hash.
  // This MUST match the owner stored in the on-chain ECDSA validator module
  // at 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57.
  // The ECDSA validator's getEnableData() returns the signer's EOA address.
  let sudoSignerAddress = "unknown"
  try {
    if (typeof (sudoValidator as any).getEnableData === "function") {
      sudoSignerAddress = await (sudoValidator as any).getEnableData()
    }
  } catch { /* ignore */ }
  console.log("[ZeroDev] Enable signature will be signed by:", sudoSignerAddress)
  console.log("[ZeroDev] Session key address:", sessionKeyAccount.address)
  console.log("[ZeroDev] Smart account address:", kernelAccount.address)

  // KEY VERIFICATION: Test that the sudo validator's signTypedData produces
  // signatures that recover to the correct owner (validates the EIP-1193 fix).
  try {
    const testTypedData = {
      domain: { name: "Kernel", version: "0.3.1", chainId: 43114, verifyingContract: kernelAccount.address },
      types: { Test: [{ name: "value", type: "uint256" }] } as const,
      primaryType: "Test" as const,
      message: { value: 1n },
    }
    const testSig = await (sudoValidator as any).signTypedData(testTypedData)
    const testRecovered = await recoverTypedDataAddress({ ...testTypedData, signature: testSig })
    console.log("[ZeroDev] KEY TEST signTypedData recovered:", testRecovered)
    console.log("[ZeroDev] KEY TEST matches owner:", testRecovered.toLowerCase() === sudoSignerAddress.toLowerCase())
    if (testRecovered.toLowerCase() !== sudoSignerAddress.toLowerCase()) {
      console.error("[ZeroDev] KEY TEST FAILED — signTypedData still produces wrong signer!")
    }
  } catch (e) {
    console.log("[ZeroDev] KEY TEST failed:", (e as Error)?.message?.slice(0, 200))
  }

  // Diagnostic: log enableData hash so we can compare with backend-side hash
  // If these don't match, the deserialized validator produces different data
  try {
    const frontendEnableData = await (permissionPlugin as any).getEnableData(kernelAccount.address)
    const frontendPermissionId = (permissionPlugin as any).getIdentifier()
    console.log("[ZeroDev] Frontend enableData hash:", keccak256(frontendEnableData))
    console.log("[ZeroDev] Frontend enableData length:", frontendEnableData?.length)
    console.log("[ZeroDev] Frontend permissionId:", frontendPermissionId)
  } catch (e) {
    console.log("[ZeroDev] Could not log enableData hash:", (e as Error)?.message?.slice(0, 100))
  }

  // Create permission account with sudo + regular plugins.
  // The SDK's internal plugin manager spreads the permission validator's methods
  // (including getPluginSerializationParams) onto the kernelPluginManager,
  // which is required for serializePermissionAccount to work correctly.
  const permissionAccount = await createKernelAccount(publicClient, {
    plugins: {
      sudo:    sudoValidator,
      regular: permissionPlugin,
    },
    entryPoint:    ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,
    index: 0n,
  })

  // Official ZeroDev serialization pattern (matches transaction-automation example):
  // serializePermissionAccount takes ONLY the account — NO private key.
  // The private key is stored separately and passed to deserializePermissionAccount
  // as a signer argument. Embedding the key in the blob causes a hash mismatch
  // where the reconstructed signer produces different plugin serialization params
  // → enable signature hash doesn't match on-chain → EnableNotApproved.
  const serializedPermission = await serializePermissionAccount(
    permissionAccount,
  )

  // Diagnostic: log typed data hash and enable sig hash for cross-comparison with backend.
  // The SDK's kpm.getPluginsEnableTypedData() uses the EXACT same code path as signing.
  try {
    const kpm = (permissionAccount as any).kernelPluginManager
    const typedData = await kpm.getPluginsEnableTypedData(kernelAccount.address)
    const enableSig = await kpm.getPluginEnableSignature(kernelAccount.address)
    console.log("[ZeroDev] Frontend typedDataHash:", hashTypedData(typedData))
    console.log("[ZeroDev] Frontend enableSigHash:", keccak256(enableSig))
    console.log("[ZeroDev] Frontend validationId:", typedData.message.validationId)
    console.log("[ZeroDev] Frontend nonce:", typedData.message.nonce)
    console.log("[ZeroDev] Frontend selectorDataHash:", keccak256(typedData.message.selectorData))
    console.log("[ZeroDev] Frontend domain:", JSON.stringify(typedData.domain))

    // CRITICAL: Recover the actual signer from the enable signature.
    // If this does NOT match sudoSignerAddress (0x97950...), then the Privy
    // wallet's signing key does not correspond to its reported address.
    const frontendRecoveredSigner = await recoverTypedDataAddress({
      ...typedData,
      signature: enableSig,
    })
    console.log("[ZeroDev] Frontend recoveredSigner (EIP-712):", frontendRecoveredSigner)
    console.log("[ZeroDev] Frontend signerMatchesOwner:", frontendRecoveredSigner.toLowerCase() === sudoSignerAddress.toLowerCase())

    // HYPOTHESIS CHECK: If Privy's toViemAccount uses personal_sign (EIP-191)
    // instead of eth_signTypedData_v4 (EIP-712), then recovering with EIP-191
    // format should give the correct signer address.
    const tdHash = hashTypedData(typedData)
    const eip191Recovered = await recoverMessageAddress({
      message: { raw: tdHash as `0x${string}` },
      signature: enableSig,
    })
    console.log("[ZeroDev] Frontend recoveredSigner (EIP-191):", eip191Recovered)
    console.log("[ZeroDev] EIP-191 matches owner?:", eip191Recovered.toLowerCase() === sudoSignerAddress.toLowerCase())

    if (frontendRecoveredSigner.toLowerCase() !== sudoSignerAddress.toLowerCase()) {
      console.error(
        "[ZeroDev] SIGNER MISMATCH! The Privy wallet signed with key",
        frontendRecoveredSigner,
        "but sudoValidator reports address",
        sudoSignerAddress,
        "— this will cause EnableNotApproved on-chain.",
        eip191Recovered.toLowerCase() === sudoSignerAddress.toLowerCase()
          ? "*** EIP-191 MATCHES! Privy is using personal_sign instead of signTypedData ***"
          : "EIP-191 also does not match — unknown signing issue"
      )
    }
  } catch (e) {
    console.log("[ZeroDev] Could not compute typedDataHash:", (e as Error)?.message?.slice(0, 200))
  }

  return {
    serializedPermission,
    sessionPrivateKey,
    sessionKeyAddress: sessionKeyAccount.address,
    expiresAt,
  }
}

// ── 4. Immediate initial deployment (sudo path) ─────────────────────────────

export async function deployInitialToProtocol(
  kernelClient: KernelClientLike,
  smartAccountAddress: `0x${string}`,
  contracts: {
    AAVE_POOL: `0x${string}`
    BENQI_POOL: `0x${string}`
    SPARK_VAULT: `0x${string}`
    EULER_VAULT: `0x${string}`
    SILO_SAVUSD_VAULT: `0x${string}`
    SILO_SUSDP_VAULT: `0x${string}`
    USDC: `0x${string}`
  },
  protocolId: "aave_v3" | "benqi" | "spark" | "euler_v2" | "silo_savusd_usdc" | "silo_susdp_usdc",
  amountUsdc: string,
): Promise<{ txHash: string; explorerUrl: string }> {
  const amount = parseUnits(amountUsdc, 6)

  const calls = [] as Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }>

  // Defensive idempotent approve before deposit, in case allowance changed.
  const spender =
    protocolId === "aave_v3" ? contracts.AAVE_POOL
      : protocolId === "benqi" ? contracts.BENQI_POOL
      : protocolId === "spark" ? contracts.SPARK_VAULT
      : protocolId === "silo_savusd_usdc" ? contracts.SILO_SAVUSD_VAULT
      : protocolId === "silo_susdp_usdc" ? contracts.SILO_SUSDP_VAULT
      : contracts.EULER_VAULT

  calls.push({
    to: contracts.USDC,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],   // exact amount — no infinite approvals
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
  } else if (protocolId === "spark") {
    calls.push({
      to: contracts.SPARK_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [amount, smartAccountAddress],
      }),
    })
  } else if (protocolId === "silo_savusd_usdc") {
    calls.push({
      to: contracts.SILO_SAVUSD_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [amount, smartAccountAddress],
      }),
    })
  } else if (protocolId === "silo_susdp_usdc") {
    calls.push({
      to: contracts.SILO_SUSDP_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [amount, smartAccountAddress],
      }),
    })
  } else {
    calls.push({
      to: contracts.EULER_VAULT,
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
  kernelClient: KernelClientLike,
  permissionPlugin: PermissionPluginLike
): Promise<{ txHash: string; explorerUrl: string }> {
  const txHash = await kernelClient.uninstallPlugin({ plugin: permissionPlugin })
  return { txHash, explorerUrl: EXPLORER.tx(txHash) }
}

// ── 6. Emergency: withdraw all from specific protocol (user-signed, no session key)

export async function emergencyWithdrawAll(
  kernelClient: KernelClientLike,
  smartAccountAddress: `0x${string}`,
  contracts: { AAVE_POOL: `0x${string}`; BENQI_POOL: `0x${string}`; SPARK_VAULT: `0x${string}`; EULER_VAULT: `0x${string}`; SILO_SAVUSD_VAULT: `0x${string}`; SILO_SUSDP_VAULT: `0x${string}`; USDC: `0x${string}` },
  benqiQiTokenBalance: bigint,   // fetch this from on-chain before calling
  sparkShareBalance: bigint,     // ERC-4626 shares
  eulerShareBalance: bigint = 0n, // ERC-4626 shares
  siloSavusdShareBalance: bigint = 0n, // ERC-4626 shares
  siloSusdpShareBalance: bigint = 0n,  // ERC-4626 shares
  aaveATokenBalance: bigint = 0n,      // Aave aUSDC balance — skip if 0
): Promise<{ txHash: string; explorerUrl: string }> {
  const calls = [
    // Withdraw all from Aave (MAX_UINT = full balance) — ONLY if user has aTokens
    ...(aaveATokenBalance > 0n ? [{
      to: contracts.AAVE_POOL,
      value: 0n,
      data: encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: "withdraw",
        args: [contracts.USDC, maxUint256, smartAccountAddress],
      }),
    }] : []),
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
    // Redeem all from Euler (ERC-4626)
    ...(eulerShareBalance > 0n && contracts.EULER_VAULT !== '0x0000000000000000000000000000000000000000' ? [{
      to: contracts.EULER_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [eulerShareBalance, smartAccountAddress, smartAccountAddress],
      }),
    }] : []),
    // Redeem all from Silo savUSD/USDC (ERC-4626)
    ...(siloSavusdShareBalance > 0n && contracts.SILO_SAVUSD_VAULT !== '0x0000000000000000000000000000000000000000' ? [{
      to: contracts.SILO_SAVUSD_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [siloSavusdShareBalance, smartAccountAddress, smartAccountAddress],
      }),
    }] : []),
    // Redeem all from Silo sUSDp/USDC (ERC-4626)
    ...(siloSusdpShareBalance > 0n && contracts.SILO_SUSDP_VAULT !== '0x0000000000000000000000000000000000000000' ? [{
      to: contracts.SILO_SUSDP_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [siloSusdpShareBalance, smartAccountAddress, smartAccountAddress],
      }),
    }] : []),
  ]

  if (calls.length === 0) {
    throw new Error("No protocol positions to withdraw from")
  }

  const txHash = await kernelClient.sendTransaction({ calls })
  return { txHash, explorerUrl: EXPLORER.tx(txHash) }
}

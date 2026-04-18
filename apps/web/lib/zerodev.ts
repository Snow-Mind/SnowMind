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
  keccak256,
  concat,
  pad,
  toHex,
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

// Permit2 ABI — Euler V2 (EVK) uses Permit2 for token transfers instead of
// standard ERC-20 transferFrom.  approve(token, spender, amount, expiration)
// sets a per-spender allowance with an expiry timestamp.
export const PERMIT2_APPROVE_ABI = [
  {
    name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "token",      type: "address" },
      { name: "spender",    type: "address" },
      { name: "amount",     type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const

const FOLKS_MESSAGE_PARAMS_COMPONENTS = [
  { name: "adapterId", type: "uint16" },
  { name: "returnAdapterId", type: "uint16" },
  { name: "receiverValue", type: "uint256" },
  { name: "gasLimit", type: "uint256" },
  { name: "returnGasLimit", type: "uint256" },
] as const

const FOLKS_MESSAGE_RECEIVED_COMPONENTS = [
  { name: "messageId", type: "bytes32" },
  { name: "sourceChainId", type: "uint16" },
  { name: "sourceAddress", type: "bytes32" },
  { name: "handler", type: "bytes32" },
  { name: "payload", type: "bytes" },
  { name: "returnAdapterId", type: "uint16" },
  { name: "returnGasLimit", type: "uint256" },
] as const

export const FOLKS_SPOKE_COMMON_ABI = [
  {
    name: "createAccount", type: "function", stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: FOLKS_MESSAGE_PARAMS_COMPONENTS },
      { name: "accountId", type: "bytes32" },
      { name: "nonce", type: "bytes4" },
      { name: "refAccountId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "withdraw", type: "function", stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: FOLKS_MESSAGE_PARAMS_COMPONENTS },
      { name: "accountId", type: "bytes32" },
      { name: "loanId", type: "bytes32" },
      { name: "poolId", type: "uint8" },
      { name: "chainId", type: "uint16" },
      { name: "amount", type: "uint256" },
      { name: "isFAmount", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "retryMessage",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "adapterId", type: "uint16" },
      { name: "messageId", type: "bytes32" },
      { name: "message", type: "tuple", components: FOLKS_MESSAGE_RECEIVED_COMPONENTS },
      { name: "extraArgs", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "reverseMessage",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "adapterId", type: "uint16" },
      { name: "messageId", type: "bytes32" },
      { name: "message", type: "tuple", components: FOLKS_MESSAGE_RECEIVED_COMPONENTS },
      { name: "extraArgs", type: "bytes" },
    ],
    outputs: [],
  },
] as const

export const FOLKS_SPOKE_USDC_ABI = [
  {
    name: "createLoanAndDeposit", type: "function", stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: FOLKS_MESSAGE_PARAMS_COMPONENTS },
      { name: "accountId", type: "bytes32" },
      { name: "nonce", type: "bytes4" },
      { name: "amount", type: "uint256" },
      { name: "loanTypeId", type: "uint16" },
      { name: "loanName", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "deposit", type: "function", stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: FOLKS_MESSAGE_PARAMS_COMPONENTS },
      { name: "accountId", type: "bytes32" },
      { name: "loanId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "retryMessage",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "adapterId", type: "uint16" },
      { name: "messageId", type: "bytes32" },
      { name: "message", type: "tuple", components: FOLKS_MESSAGE_RECEIVED_COMPONENTS },
      { name: "extraArgs", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "reverseMessage",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "adapterId", type: "uint16" },
      { name: "messageId", type: "bytes32" },
      { name: "message", type: "tuple", components: FOLKS_MESSAGE_RECEIVED_COMPONENTS },
      { name: "extraArgs", type: "bytes" },
    ],
    outputs: [],
  },
] as const

const FOLKS_DEFAULT_MESSAGE_PARAMS = {
  adapterId: 1,
  returnAdapterId: 1,
  receiverValue: 0n,
  gasLimit: 0n,
  returnGasLimit: 0n,
} as const
const FOLKS_ZERO_BYTES32 = `0x${"00".repeat(32)}` as `0x${string}`
const FOLKS_DEFAULT_LOAN_NAME = pad(toHex("snowmind-usdc"), { size: 32 }) as `0x${string}`

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
type TypedDataLike = Parameters<typeof hashTypedData>[0]

interface EnableDataReader {
  getEnableData: (accountAddress: `0x${string}`) => Promise<string>
}

interface PermissionPluginDiagnostics {
  getEnableData: (accountAddress: `0x${string}`) => Promise<`0x${string}`>
  getIdentifier: () => string
}

interface KernelPluginManagerDiagnostics {
  getPluginsEnableTypedData: (accountAddress: `0x${string}`) => Promise<TypedDataLike>
  getPluginEnableSignature: (accountAddress: `0x${string}`) => Promise<`0x${string}`>
}

// ── Retry utility for transient RPC failures ──────────────────────────────────
// Retries on network errors, 429 rate limits, and 5xx server errors.
// User-rejection errors are NOT retried.
export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    maxRetries = 3,
    baseDelayMs = 1000,
    label = "RPC call",
  }: { maxRetries?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      // Never retry user rejections or wallet compatibility errors
      if (
        msg.includes("User denied") ||
        msg.includes("User rejected") ||
        msg.includes("codepoint") ||
        msg.includes("UNEXPECTED_CONTINUE")
      ) {
        throw err
      }

      if (attempt === maxRetries) {
        console.error(`[ZeroDev] ${label} failed after ${maxRetries + 1} attempts:`, msg)
        throw err
      }

      const delay = baseDelayMs * Math.pow(2, attempt)
      console.warn(
        `[ZeroDev] ${label} attempt ${attempt + 1}/${maxRetries + 1} failed: ${msg.slice(0, 120)}. Retrying in ${delay}ms…`
      )
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  // TypeScript: unreachable, but satisfies return type
  throw new Error(`${label} failed`)
}

// ── getPublicClient ───────────────────────────────────────────────────────────

function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: CHAIN,
    transport: http(process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL),
  })
}

function generatePerGrantGasNonce(): bigint {
  // Use secure randomness to avoid permission-hash collisions across re-grants.
  // Fallback to full timestamp if crypto is unavailable.
  try {
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      const random = new Uint32Array(1)
      globalThis.crypto.getRandomValues(random)
      return BigInt(random[0])
    }
  } catch {
    // no-op
  }
  return BigInt(Date.now())
}

function parsePositiveInt(rawValue: unknown, fallback: number): number {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) return fallback
  const rounded = Math.trunc(parsed)
  return rounded >= 0 ? rounded : fallback
}

function normalizeFolksNonce(rawValue: unknown, fallback: number): `0x${string}` {
  if (typeof rawValue === "string" && rawValue.trim().toLowerCase().startsWith("0x")) {
    return pad(rawValue.trim() as `0x${string}`, { size: 4 }) as `0x${string}`
  }
  const parsed = parsePositiveInt(rawValue, fallback)
  return pad(toHex(BigInt(parsed)), { size: 4 }) as `0x${string}`
}

function resolveFolksRoutingData(
  contracts: {
    FOLKS_HUB_CHAIN_ID: number
    FOLKS_USDC_POOL_ID: number
    FOLKS_USDC_LOAN_TYPE_ID: number
    FOLKS_ACCOUNT_NONCE: number
    FOLKS_LOAN_NONCE: number
  },
  smartAccountAddress: `0x${string}`,
) {
  const chainId = parsePositiveInt(contracts.FOLKS_HUB_CHAIN_ID, 100)
  const poolId = parsePositiveInt(contracts.FOLKS_USDC_POOL_ID, 1)
  const loanTypeId = parsePositiveInt(contracts.FOLKS_USDC_LOAN_TYPE_ID, 2)
  const accountNonce = normalizeFolksNonce(contracts.FOLKS_ACCOUNT_NONCE, 1)
  const loanNonce = normalizeFolksNonce(contracts.FOLKS_LOAN_NONCE, 1)

  const chainIdBytes = pad(toHex(BigInt(chainId)), { size: 2 }) as `0x${string}`
  const accountId = keccak256(concat([smartAccountAddress, chainIdBytes, accountNonce]))
  const loanId = keccak256(concat([accountId, loanNonce]))

  return {
    accountId,
    loanId,
    accountNonce,
    loanNonce,
    chainId,
    poolId,
    loanTypeId,
  }
}

// ── Wallet compatibility wrapper ──────────────────────────────────────────────
// Some wallets (e.g. Core wallet) fail on eth_signTypedData_v4 when the EIP-712
// typed data contains `bytes`-type fields with raw ABI-encoded values that aren't
// valid UTF-8. Their internal ethers.js v5 parser tries to decode these as text,
// throwing "invalid codepoint at offset N; UNEXPECTED_CONTINUE".
//
// This wrapper intercepts the call and tries alternative signing methods:
// 1. eth_signTypedData_v3 (older version, may handle bytes differently)
// 2. eth_signTypedData_v4 with typed data as object instead of JSON string
// 3. eth_signTypedData (generic, no version suffix)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createRobustProvider(provider: any): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapped: any = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: async (args: { method: string; params?: any[] }) => {
      if (args.method === 'eth_signTypedData_v4') {
        try {
          return await provider.request(args)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('codepoint') || msg.includes('UNEXPECTED_CONTINUE')) {
            console.warn('[ZeroDev] signTypedData_v4 failed with encoding error, trying fallbacks...')

            // Fallback 1: Try v3
            try {
              return await provider.request({ ...args, method: 'eth_signTypedData_v3' })
            } catch { /* continue */ }

            // Fallback 2: Try with typed data as object instead of JSON string
            try {
              const [address, data] = args.params || []
              const dataObj = typeof data === 'string' ? JSON.parse(data) : data
              return await provider.request({
                method: 'eth_signTypedData_v4',
                params: [address, dataObj],
              })
            } catch { /* continue */ }

            // Fallback 3: Try generic signTypedData (no version suffix)
            try {
              return await provider.request({ ...args, method: 'eth_signTypedData' })
            } catch { /* continue */ }

            // All fallbacks failed — throw a clear user-facing error
            throw new Error(
              'Your wallet cannot process the signing request required for activation. ' +
              'This is a known compatibility issue with some wallets (including Core wallet) ' +
              'when handling advanced typed data. Please try connecting with MetaMask or ' +
              'another EVM-compatible wallet instead.'
            )
          }
          throw err
        }
      }
      return provider.request(args)
    },
  }

  // Preserve event emitter and other methods from the original provider
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(provider))) {
    if (key !== 'request' && key !== 'constructor' && typeof provider[key] === 'function') {
      wrapped[key] = provider[key].bind(provider)
    }
  }
  // Also copy own properties (some providers attach methods directly)
  for (const key of Object.keys(provider)) {
    if (key !== 'request' && typeof provider[key] === 'function') {
      wrapped[key] = provider[key].bind(provider)
    } else if (key !== 'request') {
      wrapped[key] = provider[key]
    }
  }

  return wrapped
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
    const rawProvider = await walletClient.getEthereumProvider()
    // Wrap with fallback signing for wallets that can't handle bytes in typed data
    // (e.g. Core wallet's ethers.js v5 internal fails on non-UTF-8 byte sequences)
    signer = createRobustProvider(rawProvider)
  }

  // Sudo validator: user's wallet is the owner (full control)
  // signerToEcdsaValidator makes an RPC call — retry on transient failures.
  const ecdsaValidator = await withRetry(
    () => signerToEcdsaValidator(publicClient, {
      signer,
      entryPoint: ENTRYPOINT,
      kernelVersion: KERNEL_V3_1,           // ← constant, NOT string "0.3.1"
    }),
    { label: "signerToEcdsaValidator" },
  )

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
    kernelClient = await withRetry(
      () => Promise.resolve(createKernelAccountClient({
        account: kernelAccount,
        chain: CHAIN,
        bundlerTransport: http(BUNDLER_URL),
        paymaster: createZeroDevPaymasterClient({
          chain: CHAIN,
          transport: http(PAYMASTER_URL),
        }),
      })),
      { label: "createKernelAccountClient" },
    )
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
  contracts: { USDC: `0x${string}`; AAVE_POOL: `0x${string}`; BENQI_POOL: `0x${string}`; SPARK_VAULT: `0x${string}`; EULER_VAULT: `0x${string}`; SILO_SAVUSD_VAULT: `0x${string}`; SILO_SUSDP_VAULT: `0x${string}`; SILO_GAMI_USDC_VAULT: `0x${string}`; FOLKS_SPOKE_USDC: `0x${string}`; PERMIT2?: `0x${string}` },
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
    contracts.SILO_GAMI_USDC_VAULT,
    contracts.FOLKS_SPOKE_USDC,
    // Permit2: Euler V2 (EVK) pulls USDC via Permit2, not direct transferFrom
    ...(contracts.PERMIT2 ? [contracts.PERMIT2] : []),
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
    SILO_GAMI_USDC_VAULT: `0x${string}`
    FOLKS_SPOKE_COMMON: `0x${string}`
    FOLKS_SPOKE_USDC: `0x${string}`
    FOLKS_USDC_HUB_POOL: `0x${string}`
    FOLKS_HUB_CHAIN_ID: number
    FOLKS_USDC_POOL_ID: number
    FOLKS_USDC_LOAN_TYPE_ID: number
    FOLKS_ACCOUNT_NONCE: number
    FOLKS_LOAN_NONCE: number
    USDC:         `0x${string}`
    TREASURY:     `0x${string}`
    PERMIT2?:     `0x${string}`
    REGISTRY?:    `0x${string}`
  },
  config: {
    maxAmountUSDC:  number   // max USDC per single tx e.g. 10000
    durationDays:   number   // session key validity window (days)
    maxOpsPerDay:   number   // rate limit e.g. 20
    userEOA:        `0x${string}`  // user's EOA address for withdrawal transfers
  }
): Promise<{
  serializedPermission: string   // Send to backend — store encrypted in DB
  sessionPrivateKey:    string   // Hex private key — store encrypted alongside approval
  sessionKeyAddress:    string
  expiresAt:            number   // Unix timestamp
  permissionAccount:    KernelAccountLike  // Use to deploy via session key (no wallet popup)
}> {
  const publicClient = getPublicClient()
  const maxAmount    = parseUnits(config.maxAmountUSDC.toString(), 6)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const durationSeconds = Math.max(1, Math.floor(config.durationDays * 24 * 60 * 60))
  const expiresAt = nowSeconds + durationSeconds

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
  const hasUserEOA = config.userEOA && config.userEOA.length >= 42 && config.userEOA !== ZERO_ADDR

  // ── CRITICAL: CallPolicy V0.0.5 hashes each permission as keccak256(callType, target, selector).
  // Only ONE permission per (target, selector) is allowed per install — duplicates cause
  // "duplicate permissionHash" revert in the CallPolicy.onInstall() function.
  // Therefore we MUST consolidate multiple spender/recipient constraints into a single
  // permission using ParamCondition.ONE_OF instead of separate EQUAL rules. ──

  // Build USDC transfer recipients list (treasury + user EOA) for a single ONE_OF rule
  const transferRecipients: `0x${string}`[] = [
    ...(hasTreasury ? [contracts.TREASURY] : []),
    ...(hasUserEOA ? [config.userEOA] : []),
  ]

  const permissions: CallPolicyPermission[] = [

      // USDC approve — session key can set approvals for ALL protocol contracts.
      // CallPolicy V0.0.5 allows only ONE rule per (target, selector), so we use
      // ONE_OF to list all valid spenders in a single permission entry.
      {
        target: contracts.USDC,
        valueLimit: 0n,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [
          { condition: ParamCondition.ONE_OF, value: [
            contracts.AAVE_POOL,
            contracts.BENQI_POOL,
            contracts.SPARK_VAULT,
            contracts.EULER_VAULT,
            ...(contracts.PERMIT2 ? [contracts.PERMIT2] : []),
            contracts.SILO_SAVUSD_VAULT,
            contracts.SILO_SUSDP_VAULT,
            contracts.SILO_GAMI_USDC_VAULT,
            contracts.FOLKS_SPOKE_USDC,
          ].filter(addr => addr !== ZERO_ADDR) },
          null,   // amount — any (maxUint256 for efficiency)
        ],
      },
      // Permit2.approve(USDC, euler_vault, amount, deadline) — set Permit2 allowance
      // This has a DIFFERENT target (PERMIT2, not USDC) so it has a unique permissionHash
      ...(contracts.PERMIT2 ? ([{
        target: contracts.PERMIT2,
        valueLimit: 0n,
        abi: PERMIT2_APPROVE_ABI,
        functionName: "approve" as const,
        args: [
          { condition: ParamCondition.EQUAL, value: contracts.USDC },
          { condition: ParamCondition.EQUAL, value: contracts.EULER_VAULT },
          null,
          null,
        ],
      }] as CallPolicyPermission[]) : []),

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
      // SILO V3 Gami USDC — deposit (ERC-4626)
      {
        target: contracts.SILO_GAMI_USDC_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [
          { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
          null,
        ],
      },

      // SILO V3 Gami USDC — redeem (ERC-4626)
      {
        target: contracts.SILO_GAMI_USDC_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [null, null, null],
      },

      // SILO V3 Gami USDC — withdraw (ERC-4626)
      {
        target: contracts.SILO_GAMI_USDC_VAULT,
        valueLimit: 0n,
        abi: ERC4626_VAULT_ABI,
        functionName: "withdraw",
        args: [null, null, null],
      },

      // Folks SpokeCommon — create account
      {
        target: contracts.FOLKS_SPOKE_COMMON,
        valueLimit: 0n,
        abi: FOLKS_SPOKE_COMMON_ABI,
        functionName: "createAccount",
        args: [null, null, null, null],
      },

      // Folks SpokeUSDC — create loan and deposit
      {
        target: contracts.FOLKS_SPOKE_USDC,
        valueLimit: 0n,
        abi: FOLKS_SPOKE_USDC_ABI,
        functionName: "createLoanAndDeposit",
        args: [
          null,
          null,
          null,
          { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
          null,
          null,
        ],
      },

      // Folks SpokeUSDC — deposit into an existing Folks loan
      {
        target: contracts.FOLKS_SPOKE_USDC,
        valueLimit: 0n,
        abi: FOLKS_SPOKE_USDC_ABI,
        functionName: "deposit",
        args: [
          null,
          null,
          null,
          { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
        ],
      },

      // Folks SpokeCommon — withdraw
      {
        target: contracts.FOLKS_SPOKE_COMMON,
        valueLimit: 0n,
        abi: FOLKS_SPOKE_COMMON_ABI,
        functionName: "withdraw",
        args: [null, null, null, null, null, null, null],
      },

      // Folks SpokeCommon — retry failed bridge message (recovery path)
      {
        target: contracts.FOLKS_SPOKE_COMMON,
        valueLimit: 0n,
        abi: FOLKS_SPOKE_COMMON_ABI,
        functionName: "retryMessage",
        args: [null, null, null, null],
      },

      // Folks SpokeCommon — reverse failed bridge message (refund path)
      {
        target: contracts.FOLKS_SPOKE_COMMON,
        valueLimit: 0n,
        abi: FOLKS_SPOKE_COMMON_ABI,
        functionName: "reverseMessage",
        args: [null, null, null, null],
      },

      // Folks SpokeUSDC — retry failed bridge message (recovery path)
      {
        target: contracts.FOLKS_SPOKE_USDC,
        valueLimit: 0n,
        abi: FOLKS_SPOKE_USDC_ABI,
        functionName: "retryMessage",
        args: [null, null, null, null],
      },

      // Folks SpokeUSDC — reverse failed bridge message (refund path)
      {
        target: contracts.FOLKS_SPOKE_USDC,
        valueLimit: 0n,
        abi: FOLKS_SPOKE_USDC_ABI,
        functionName: "reverseMessage",
        args: [null, null, null, null],
      },

    // USDC.transfer — fee collection to treasury AND user withdrawal to EOA.
    // Consolidated into single rule with ONE_OF (CallPolicy requires unique target+selector).
    // NOTE: When both treasury and user EOA exist, amount is uncapped for both.
    // User withdrawal is uncapped (it's their money). Treasury fees are protocol-controlled.
    ...(transferRecipients.length > 0 ? [{
      target: contracts.USDC,
      valueLimit: 0n,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer" as const,
      args: [
        transferRecipients.length === 1
          ? { condition: ParamCondition.EQUAL, value: transferRecipients[0] }
          : { condition: ParamCondition.ONE_OF, value: transferRecipients },
        null,   // amount — uncapped (user's money + protocol-controlled fees)
      ],
    }] as CallPolicyPermission[] : []),
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

  // Gas policy: lifetime gas cap prevents runaway spending.
  // Each UserOp on Avalanche can consume ~0.01-0.04 AVAX in gas (gasUsed × gasPrice).
  // 10 AVAX supports ~250-1000 operations — enough for months of rebalancing.
  // The rate limit policy (maxOpsPerDay) independently caps daily operations.
  // IMPORTANT: include a tiny per-grant nonce in the encoded gas-policy data.
  // CallPolicy V0.0.5 rejects duplicate permission hashes on re-install; if a
  // user re-grants with identical policy payloads, enable mode can revert with
  // "duplicate permissionHash". The nonce MUST be collision-resistant.
  const gasNonce = generatePerGrantGasNonce()
  const gasPolicyAllowed = parseUnits("10", 18) + gasNonce
  const gasPolicy = toGasPolicy({ allowed: gasPolicyAllowed })
  console.log("[ZeroDev] gasPolicy nonce:", gasNonce.toString())

  // Rate limit: max rebalances per day
  const rateLimitPolicy = toRateLimitPolicy({
    count:    config.maxOpsPerDay,
    interval: 86400,
  })

  // Time bound the session key on-chain to reduce blast radius if the key leaks.
  const timestampPolicy = toTimestampPolicy({
    validAfter: nowSeconds,
    validUntil: expiresAt,
  })

  // Compose all policies — ALL must pass for every UserOp
  const permissionPlugin = await toPermissionValidator(publicClient, {
    entryPoint:    ENTRYPOINT,
    kernelVersion: KERNEL_V3_1,
    signer:        sessionKeySigner,
    policies:      [callPolicy, gasPolicy, rateLimitPolicy, timestampPolicy],
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
    const enableReader = sudoValidator as unknown as Partial<EnableDataReader>
    if (typeof enableReader.getEnableData === "function") {
      sudoSignerAddress = await enableReader.getEnableData(kernelAccount.address)
    }
  } catch { /* ignore */ }
  console.log("[ZeroDev] Enable signature will be signed by:", sudoSignerAddress)
  console.log("[ZeroDev] Session key address:", sessionKeyAccount.address)
  console.log("[ZeroDev] Smart account address:", kernelAccount.address)

  // Diagnostic: log enableData hash so we can compare with backend-side hash
  // If these don't match, the deserialized validator produces different data
  try {
    const diagnostics = permissionPlugin as unknown as Partial<PermissionPluginDiagnostics>
    if (typeof diagnostics.getEnableData === "function" && typeof diagnostics.getIdentifier === "function") {
      const frontendEnableData = await diagnostics.getEnableData(kernelAccount.address)
      const frontendPermissionId = diagnostics.getIdentifier()
      console.log("[ZeroDev] Frontend enableData hash:", keccak256(frontendEnableData))
      console.log("[ZeroDev] Frontend enableData length:", frontendEnableData?.length)
      console.log("[ZeroDev] Frontend permissionId:", frontendPermissionId)
    } else {
      console.log("[ZeroDev] Permission diagnostics unavailable on current SDK object")
    }
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
    const pluginManager = (
      permissionAccount as unknown as { kernelPluginManager?: Partial<KernelPluginManagerDiagnostics> }
    ).kernelPluginManager
    if (
      !pluginManager
      || typeof pluginManager.getPluginsEnableTypedData !== "function"
      || typeof pluginManager.getPluginEnableSignature !== "function"
    ) {
      throw new Error("kernelPluginManager diagnostics are unavailable")
    }

    const typedData = await pluginManager.getPluginsEnableTypedData(kernelAccount.address)
    const enableSig = await pluginManager.getPluginEnableSignature(kernelAccount.address)
    console.log("[ZeroDev] Frontend typedDataHash:", hashTypedData(typedData))
    console.log("[ZeroDev] Frontend enableSigHash:", keccak256(enableSig))
    const typedMessage = (typedData as { message?: Record<string, unknown> }).message ?? {}
    console.log("[ZeroDev] Frontend validationId:", typedMessage.validationId)
    console.log("[ZeroDev] Frontend nonce:", typedMessage.nonce)
    const selectorData = typedMessage.selectorData
    if (typeof selectorData === "string" && selectorData.startsWith("0x")) {
      console.log("[ZeroDev] Frontend selectorDataHash:", keccak256(selectorData as `0x${string}`))
    }
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
    permissionAccount,
  }
}

// ── 4a. Deploy initial funds via permission account (session key signs — NO wallet popup) ──
// The session key signs the UserOp locally using its ephemeral private key.
// The enable signature (signed by the user in grantAndSerializeSessionKey) is
// piggybacked on the first UserOp automatically by the SDK.
// This eliminates one wallet popup compared to using the sudo kernel client.

export async function deployInitialViaPermissionAccount(
  permissionAccount: KernelAccountLike,
  smartAccountAddress: `0x${string}`,
  contracts: {
    AAVE_POOL: `0x${string}`
    BENQI_POOL: `0x${string}`
    SPARK_VAULT: `0x${string}`
    EULER_VAULT: `0x${string}`
    SILO_SAVUSD_VAULT: `0x${string}`
    SILO_SUSDP_VAULT: `0x${string}`
    SILO_GAMI_USDC_VAULT: `0x${string}`
    FOLKS_SPOKE_COMMON: `0x${string}`
    FOLKS_SPOKE_USDC: `0x${string}`
    FOLKS_HUB_CHAIN_ID: number
    FOLKS_USDC_POOL_ID: number
    FOLKS_USDC_LOAN_TYPE_ID: number
    FOLKS_ACCOUNT_NONCE: number
    FOLKS_LOAN_NONCE: number
    USDC: `0x${string}`
  },
  protocolId: "aave_v3" | "benqi" | "spark" | "euler_v2" | "silo_savusd_usdc" | "silo_susdp_usdc" | "silo_gami_usdc" | "folks",
  amountUsdc: string,
): Promise<{ txHash: string; explorerUrl: string }> {
  const amount = parseUnits(amountUsdc, 6)

  // Create kernel client from permission account — session key signs all UserOps
  const permissionClient = createKernelAccountClient({
    account: permissionAccount,
    chain: CHAIN,
    bundlerTransport: http(BUNDLER_URL),
    paymaster: createZeroDevPaymasterClient({
      chain: CHAIN,
      transport: http(PAYMASTER_URL),
    }),
  })

  const calls = [] as Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }>

  // Approve protocol spender before deposit
  const spender =
    protocolId === "aave_v3" ? contracts.AAVE_POOL
      : protocolId === "benqi" ? contracts.BENQI_POOL
      : protocolId === "spark" ? contracts.SPARK_VAULT
      : protocolId === "silo_savusd_usdc" ? contracts.SILO_SAVUSD_VAULT
      : protocolId === "silo_susdp_usdc" ? contracts.SILO_SUSDP_VAULT
      : protocolId === "silo_gami_usdc" ? contracts.SILO_GAMI_USDC_VAULT
      : protocolId === "folks" ? contracts.FOLKS_SPOKE_USDC
      : contracts.EULER_VAULT

  calls.push({
    to: contracts.USDC,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
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
  } else if (protocolId === "silo_gami_usdc") {
    calls.push({
      to: contracts.SILO_GAMI_USDC_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [amount, smartAccountAddress],
      }),
    })
  } else if (protocolId === "folks") {
    const folks = resolveFolksRoutingData(contracts, smartAccountAddress)
    calls.push({
      to: contracts.FOLKS_SPOKE_COMMON,
      value: 0n,
      data: encodeFunctionData({
        abi: FOLKS_SPOKE_COMMON_ABI,
        functionName: "createAccount",
        args: [
          FOLKS_DEFAULT_MESSAGE_PARAMS,
          folks.accountId,
          folks.accountNonce,
          FOLKS_ZERO_BYTES32,
        ],
      }),
    })
    calls.push({
      to: contracts.FOLKS_SPOKE_USDC,
      value: 0n,
      data: encodeFunctionData({
        abi: FOLKS_SPOKE_USDC_ABI,
        functionName: "createLoanAndDeposit",
        args: [
          FOLKS_DEFAULT_MESSAGE_PARAMS,
          folks.accountId,
          folks.loanNonce,
          amount,
          folks.loanTypeId,
          FOLKS_DEFAULT_LOAN_NAME,
        ],
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

  const txHash = await permissionClient.sendTransaction({ calls })
  return { txHash, explorerUrl: EXPLORER.tx(txHash) }
}

// ── 4b. Immediate initial deployment (sudo path — legacy, requires wallet popup) ──

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
    SILO_GAMI_USDC_VAULT: `0x${string}`
    FOLKS_SPOKE_COMMON: `0x${string}`
    FOLKS_SPOKE_USDC: `0x${string}`
    FOLKS_HUB_CHAIN_ID: number
    FOLKS_USDC_POOL_ID: number
    FOLKS_USDC_LOAN_TYPE_ID: number
    FOLKS_ACCOUNT_NONCE: number
    FOLKS_LOAN_NONCE: number
    USDC: `0x${string}`
  },
  protocolId: "aave_v3" | "benqi" | "spark" | "euler_v2" | "silo_savusd_usdc" | "silo_susdp_usdc" | "silo_gami_usdc" | "folks",
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
      : protocolId === "silo_gami_usdc" ? contracts.SILO_GAMI_USDC_VAULT
      : protocolId === "folks" ? contracts.FOLKS_SPOKE_USDC
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
  } else if (protocolId === "silo_gami_usdc") {
    calls.push({
      to: contracts.SILO_GAMI_USDC_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "deposit",
        args: [amount, smartAccountAddress],
      }),
    })
  } else if (protocolId === "folks") {
    const folks = resolveFolksRoutingData(contracts, smartAccountAddress)
    calls.push({
      to: contracts.FOLKS_SPOKE_COMMON,
      value: 0n,
      data: encodeFunctionData({
        abi: FOLKS_SPOKE_COMMON_ABI,
        functionName: "createAccount",
        args: [
          FOLKS_DEFAULT_MESSAGE_PARAMS,
          folks.accountId,
          folks.accountNonce,
          FOLKS_ZERO_BYTES32,
        ],
      }),
    })
    calls.push({
      to: contracts.FOLKS_SPOKE_USDC,
      value: 0n,
      data: encodeFunctionData({
        abi: FOLKS_SPOKE_USDC_ABI,
        functionName: "createLoanAndDeposit",
        args: [
          FOLKS_DEFAULT_MESSAGE_PARAMS,
          folks.accountId,
          folks.loanNonce,
          amount,
          folks.loanTypeId,
          FOLKS_DEFAULT_LOAN_NAME,
        ],
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
  contracts: { AAVE_POOL: `0x${string}`; BENQI_POOL: `0x${string}`; SPARK_VAULT: `0x${string}`; EULER_VAULT: `0x${string}`; SILO_SAVUSD_VAULT: `0x${string}`; SILO_SUSDP_VAULT: `0x${string}`; SILO_GAMI_USDC_VAULT: `0x${string}`; USDC: `0x${string}` },
  benqiQiTokenBalance: bigint,   // fetch this from on-chain before calling
  sparkShareBalance: bigint,     // ERC-4626 shares
  eulerShareBalance: bigint = 0n, // ERC-4626 shares
  siloSavusdShareBalance: bigint = 0n, // ERC-4626 shares
  siloSusdpShareBalance: bigint = 0n,  // ERC-4626 shares
  siloGamiShareBalance: bigint = 0n,   // ERC-4626 shares
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
    // Redeem all from Silo V3 Gami USDC vault (ERC-4626)
    ...(siloGamiShareBalance > 0n && contracts.SILO_GAMI_USDC_VAULT !== '0x0000000000000000000000000000000000000000' ? [{
      to: contracts.SILO_GAMI_USDC_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_VAULT_ABI,
        functionName: "redeem",
        args: [siloGamiShareBalance, smartAccountAddress, smartAccountAddress],
      }),
    }] : []),
  ]

  if (calls.length === 0) {
    throw new Error("No protocol positions to withdraw from")
  }

  const txHash = await kernelClient.sendTransaction({ calls })
  return { txHash, explorerUrl: EXPLORER.tx(txHash) }
}

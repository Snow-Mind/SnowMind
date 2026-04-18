import { deserializePermissionAccount } from "@zerodev/permissions"
import { toECDSASigner } from "@zerodev/permissions/signers"
import {
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  KernelV3_1AccountAbi,
} from "@zerodev/sdk"
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants"
import {
  createPublicClient,
  decodeErrorResult,
  decodeFunctionResult,
  fallback,
  http,
  encodeFunctionData,
  maxUint256,
  parseUnits,
  keccak256,
  concat,
  pad,
  encodeAbiParameters,
  parseAbiParameters,
  hashTypedData,
  zeroAddress,
} from "viem"
import { avalanche } from "viem/chains"
import { privateKeyToAccount } from "viem/accounts"
import { recoverTypedDataAddress, recoverMessageAddress } from "viem"

const CHAIN_ID = 43114
const CHAIN = avalanche
const ENTRYPOINT = getEntryPoint("0.7")
const ZERODEV_ID = process.env.ZERODEV_PROJECT_ID

// ZeroDev SDK calls proprietary RPC methods (zd_getUserOperationGasPrice, etc.)
// that ONLY work with ZeroDev's bundler. Never point these at Pimlico/Alchemy.
const ZERODEV_RPC = `https://rpc.zerodev.app/api/v3/${ZERODEV_ID}/chain/${CHAIN.id}`
const BUNDLER_URL = ZERODEV_RPC
const PAYMASTER_URL = ZERODEV_RPC
const DEFAULT_ZERODEV_REQUEST_ORIGIN = "https://app.snowmind.xyz"

function isHttpUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

function normalizeOrigin(raw) {
  if (!raw) return null
  const value = raw.trim()
  if (!value) return null

  const candidates = []
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string") {
            candidates.push(item)
          }
        }
      }
    } catch {
      // Ignore malformed JSON and fall back to comma-separated parsing.
    }
  }

  if (candidates.length === 0) {
    candidates.push(...value.split(","))
  }

  for (const entry of candidates) {
    const normalized = entry.trim().replace(/^['"]|['"]$/g, "")
    if (!isHttpUrl(normalized)) continue
    const parsed = new URL(normalized)
    return `${parsed.protocol}//${parsed.host}`
  }

  return null
}

const REQUEST_ORIGIN =
  normalizeOrigin(process.env.ZERODEV_REQUEST_ORIGIN) ?? DEFAULT_ZERODEV_REQUEST_ORIGIN

// Server-side Node.js doesn't send an Origin header automatically.
// ZeroDev's domain allowlist needs it to verify the request source.
const ZERODEV_FETCH_OPTIONS = {
  headers: { Origin: REQUEST_ORIGIN },
}

const EXPLORER_BASE = "https://snowtrace.io"

const DEFAULT_AVALANCHE_RPC_URLS = [
  "https://api.avax.network/ext/bc/C/rpc",
  "https://rpc.ankr.com/avalanche",
]

const BLOCKED_AVALANCHE_RPC_HOSTS = new Set([
  "avalanche.public-rpc.com",
])

function isAllowedRpcUrl(value) {
  if (!isHttpUrl(value)) return false
  try {
    const parsed = new URL(value)
    return !BLOCKED_AVALANCHE_RPC_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

function parseRpcUrlList(raw) {
  if (!raw) return []
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => isAllowedRpcUrl(entry))
}

function getAvalancheRpcUrls() {
  const configured = [
    ...parseRpcUrlList(process.env.AVALANCHE_RPC_URLS),
    process.env.AVALANCHE_RPC_URL,
    ...DEFAULT_AVALANCHE_RPC_URLS,
  ].filter((value) => typeof value === "string" && isAllowedRpcUrl(value))

  return [...new Set(configured)]
}

const AVALANCHE_RPC_URLS = getAvalancheRpcUrls()

function createAvalanchePublicClient() {
  const transports = AVALANCHE_RPC_URLS.map((rpcUrl) =>
    http(rpcUrl, {
      retryCount: 1,
      timeout: 15_000,
    }),
  )

  return createPublicClient({
    chain: CHAIN,
    transport: transports.length === 1
      ? transports[0]
      : fallback(transports, { rank: false }),
  })
}

const AAVE_ABI = [
  {
    name: "supply",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
]

const BENQI_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "mintAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "redeemTokens", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
]

const ERC4626_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "previewRedeem",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    name: "convertToAssets",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
]

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
]

// ── Permit2 (Uniswap canonical) — same address on ALL EVM chains ──────────
// Euler V2 (EVK) vaults use Permit2 for token transfers instead of standard
// ERC-20 transferFrom.  Deposits require: USDC.approve(PERMIT2, amount) +
// PERMIT2.approve(USDC, euler_vault, amount, deadline) before euler.deposit().
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3"

const PERMIT2_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
]

const USDC_DECIMALS = 6
const USDC_SCALE = 10n ** 6n
const MIN_USDC_PROJECTION_BUFFER = 10_000n // 0.01 USDC
const USDC_PROJECTION_BUFFER_BPS = 10n // 0.10%

function formatExecutionError(err) {
  const message = err?.shortMessage || err?.message || "Unknown execution error"
  const details = err?.details ? ` | details=${err.details}` : ""
  const kernelReason = decodeKernelValidationReason(err)
  const kernelDecoded = kernelReason ? ` | kernel=${kernelReason}` : ""
  const meta = err?.metaMessages?.length ? ` | meta=${err.metaMessages.join(" ; ")}` : ""
  const cause = err?.cause?.message ? ` | cause=${err.cause.message}` : ""
  return `${message}${details}${kernelDecoded}${meta}${cause}`
}

function decodeKernelValidationReason(err) {
  const text = [
    err?.details,
    err?.cause?.details,
    ...(Array.isArray(err?.metaMessages) ? err.metaMessages : []),
  ]
    .filter(Boolean)
    .join(" ")

  const match = text.match(/AA23 reverted\s+(0x[0-9a-fA-F]{8})/)
  if (!match) return ""

  const selector = match[1].toLowerCase()
  try {
    const decoded = decodeErrorResult({ abi: KernelV3_1AccountAbi, data: selector })
    if (decoded?.errorName === "EnableNotApproved") {
      return "EnableNotApproved (session key plugin enable signature missing/invalid)"
    }
    return decoded?.errorName || selector
  } catch {
    return selector
  }
}

function isLikelyPaymasterError(err) {
  const text = [
    err?.shortMessage,
    err?.message,
    err?.details,
    err?.cause?.message,
    ...(Array.isArray(err?.metaMessages) ? err.metaMessages : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return text.includes("paymaster") || text.includes("sponsoruseroperation") || text.includes("pm_")
}

/**
 * Detect if a validateUserOp revert is likely caused by paymaster/gas issues
 * rather than a genuine call-policy violation. Paymaster gas estimation failures
 * can produce "validateUserOp reverted" errors that don't contain the word
 * "paymaster". Retrying WITHOUT a paymaster rules this out.
 */
function isValidateUserOpRevert(err) {
  const text = [
    err?.shortMessage,
    err?.message,
    err?.details,
    err?.cause?.message,
    ...(Array.isArray(err?.metaMessages) ? err.metaMessages : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return text.includes("validateuserop") && text.includes("revert")
}

/**
 * Extract structured error info from ERC-4337 bundler errors.
 * Bundler errors wrap the actual revert reason deeply — this walks the cause
 * chain and extracts:
 *   - AA error code (AA23, AA24, AA25, AA41, etc.)
 *   - The hex revert data (if present)
 *   - Any decoded reason string
 */
function extractBundlerErrorInfo(err) {
  const fullText = []
  let walkErr = err
  for (let depth = 0; walkErr && depth < 6; depth++) {
    if (walkErr.message) fullText.push(walkErr.message)
    if (walkErr.shortMessage) fullText.push(walkErr.shortMessage)
    if (walkErr.details) fullText.push(walkErr.details)
    if (walkErr.metaMessages) fullText.push(...walkErr.metaMessages)
    walkErr = walkErr.cause
  }
  const joined = fullText.join(" ")

  // Extract AA error code
  const aaMatch = joined.match(/AA(\d{2})/i)
  const aaCode = aaMatch ? `AA${aaMatch[1]}` : null

  // Extract hex revert data (only after "reverted" keyword to avoid matching
  // the sender address or other hex values from the request body)
  const revertMatch = joined.match(/reverted\s+(0x[0-9a-fA-F]{8,})/)
  const revertData = revertMatch ? revertMatch[1].slice(0, 200) : null

  // Try to decode common Kernel error selectors from revert data
  let decodedKernelError = null
  if (revertData && revertData.length >= 10) {
    const errorSelector = revertData.slice(0, 10).toLowerCase()
    // Kernel v3.1 error selectors — computed via keccak256("ErrorName()").slice(0,10)
    // CRITICAL: 0x756688fe was previously mapped to EnableNotApproved — WRONG.
    //   keccak256("EnableNotApproved()") = 0xc48cf8ee...
    //   keccak256("InvalidNonce()")      = 0x756688fe...
    // This mismap caused EnableNotApproved to go UNDETECTED in all retry logic.
    const KERNEL_ERRORS = {
      "0xc48cf8ee": "EnableNotApproved",
      "0x756688fe": "InvalidNonce",
      "0x5c427cd9": "PolicySignatureOrderError",
      "0xb3c44269": "PermissionNotAllowedForAction",
      "0x44e18ef4": "PermissionNotAllowedForSignature",
      "0xda7a5e2e": "InvalidCallPhase",
      "0x756688ff": "PolicyFailed",
    }
    decodedKernelError = KERNEL_ERRORS[errorSelector] || null
  }

  return { aaCode, revertData, decodedKernelError, fullTextLength: joined.length }
}

async function getKernelClient(serializedPermission, sessionPrivateKey, options = { withPaymaster: true, forceRegularMode: false }) {
  const publicClient = createAvalanchePublicClient()

  // Diagnostic: log whether the session private key was provided.
  // NEVER log the key itself — only its presence and length.
  console.log(JSON.stringify({
    level: "info",
    action: "getKernelClient_init",
    hasSessionPrivateKey: !!sessionPrivateKey,
    sessionPrivateKeyLength: sessionPrivateKey ? sessionPrivateKey.length : 0,
    withPaymaster: options.withPaymaster,
    serializedPermissionLength: serializedPermission ? serializedPermission.length : 0,
    timestamp: new Date().toISOString(),
  }))

  // Official ZeroDev pattern: deserializePermissionAccount takes 5 args.
  // The signer is reconstructed from the separately-stored private key,
  // NOT embedded in the serialized blob. This ensures the plugin
  // serialization params hash matches the on-chain enable signature.
  if (!sessionPrivateKey) {
    throw new Error(
      "sessionPrivateKey is required for deserialization. " +
      "The frontend must send sessionPrivateKey alongside the serialized permission. " +
      "If this is a legacy session key without a stored private key, " +
      "the user must re-grant their session key from the dashboard."
    )
  }

  const sessionKeySigner = await toECDSASigner({
    signer: privateKeyToAccount(sessionPrivateKey),
  })

  console.log(JSON.stringify({
    level: "info",
    action: "session_key_signer_created",
    signerAddress: sessionKeySigner.account.address,
    timestamp: new Date().toISOString(),
  }))

  // ── Force regular mode: modify serialized params BEFORE deserialization ──
  // After the first successful enable-mode UserOp, the permission is
  // registered on-chain. Subsequent UserOps must NOT include the enable
  // data, or the Kernel contract reverts with "duplicate permissionHash".
  // Setting isPreInstalled=true causes the SDK to:
  //   1. Initialize pluginEnabled=true in the closure (skip enable envelope in getSignatureData)
  //   2. Use VALIDATOR_MODE.DEFAULT in getNonceKey (not ENABLE)
  //   3. Pass pluginEnableSignature=undefined to toKernelPluginManager
  let permissionBlob = serializedPermission
  if (options.forceRegularMode) {
    try {
      const decoded = JSON.parse(Buffer.from(permissionBlob, "base64").toString("utf-8"))
      decoded.isPreInstalled = true
      delete decoded.enableSignature
      permissionBlob = Buffer.from(JSON.stringify(decoded)).toString("base64")
      console.log(JSON.stringify({
        level: "info",
        action: "force_regular_mode",
        detail: "Set isPreInstalled=true in serialized params — SDK will skip enable data.",
        timestamp: new Date().toISOString(),
      }))
    } catch (e) {
      // If we can't parse the permission blob in regular mode, the blob
      // is corrupt and MUST NOT be used as-is (it would attempt enable
      // mode and fail with "duplicate permissionHash").
      throw new Error(
        `forceRegularMode: failed to parse serialized permission blob: ${e?.message?.slice(0, 200)}`
      )
    }
  }

  const permissionAccount = await deserializePermissionAccount(
    publicClient,
    ENTRYPOINT,
    KERNEL_V3_1,
    permissionBlob,
    sessionKeySigner,
  )

  console.log(JSON.stringify({
    level: "info",
    action: "permission_account_deserialized",
    permissionAccountAddress: permissionAccount.address,
    timestamp: new Date().toISOString(),
  }))

  // ── Diagnostic: verify on-chain state before building UserOp ──
  // Query the ECDSA validator module for the stored owner to compare with
  // the wallet address that signed the enable hash during serialization.
  const ECDSA_VALIDATOR_MODULE = "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57"
  try {
    const [storedOwner, currentNonce] = await Promise.all([
      publicClient.readContract({
        address: ECDSA_VALIDATOR_MODULE,
        abi: [{
          name: "ecdsaValidatorStorage",
          type: "function",
          stateMutability: "view",
          inputs: [{ type: "address" }],
          outputs: [{ type: "address" }],
        }],
        functionName: "ecdsaValidatorStorage",
        args: [permissionAccount.address],
      }),
      publicClient.readContract({
        address: permissionAccount.address,
        abi: [{
          name: "currentNonce",
          type: "function",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "uint32" }],
        }],
        functionName: "currentNonce",
      }),
    ])

    // Inspect kernel plugin manager for enable signature presence
    const kpm = permissionAccount.kernelPluginManager
    const hasPluginEnableSig = typeof kpm?.getPluginEnableSignature === "function"
    const activeMode = kpm?.activeValidatorMode ?? "unknown"
    const hasRegular = !!kpm?.regularValidator
    const hasSudo = !!kpm?.sudoValidator

    console.log(JSON.stringify({
      level: "info",
      action: "onchain_state_diagnostic",
      smartAccount: permissionAccount.address,
      ecdsaValidatorOwner: storedOwner,
      currentNonce: Number(currentNonce),
      pluginManager: {
        activeMode,
        hasRegular,
        hasSudo,
        hasPluginEnableSig,
      },
      timestamp: new Date().toISOString(),
    }))
  } catch (diagErr) {
    console.log(JSON.stringify({
      level: "warn",
      action: "onchain_diagnostic_failed",
      error: diagErr?.message?.slice(0, 300),
      timestamp: new Date().toISOString(),
    }))
  }

  // ── Diagnostic: verify enable data integrity ──────────────────────────
  // Compute the enable typed data hash and enable data hash from the
  // deserialized permission account. Compare with the stored enable
  // signature to verify it will pass on-chain _checkApproval().
  // This catches mismatches BEFORE submitting the UserOp to the bundler.
  try {
    const kpm = permissionAccount.kernelPluginManager
    if (kpm && typeof kpm.getPluginsEnableTypedData === "function") {
      const typedData = await kpm.getPluginsEnableTypedData(permissionAccount.address)
      const typedDataHash = hashTypedData(typedData)
      const enableDataHash = keccak256(typedData.message.validatorData)
      const selectorDataHash = keccak256(typedData.message.selectorData)

      const enableSig = typeof kpm.getPluginEnableSignature === "function"
        ? await kpm.getPluginEnableSignature(permissionAccount.address)
        : null

      let recoveredSigner = null
      let signerMatchesOwner = false
      if (enableSig && typedData) {
        try {
          recoveredSigner = await recoverTypedDataAddress({
            ...typedData,
            signature: enableSig,
          })
          // Compare with ECDSA validator owner
          const ECDSA_VALIDATOR_MODULE = "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57"
          const storedOwner = await publicClient.readContract({
            address: ECDSA_VALIDATOR_MODULE,
            abi: [{
              name: "ecdsaValidatorStorage",
              type: "function",
              stateMutability: "view",
              inputs: [{ type: "address" }],
              outputs: [{ type: "address" }],
            }],
            functionName: "ecdsaValidatorStorage",
            args: [permissionAccount.address],
          })
          signerMatchesOwner =
            recoveredSigner?.toLowerCase() === storedOwner?.toLowerCase()
        } catch (recoverErr) {
          console.log(JSON.stringify({
            level: "warn",
            action: "enable_sig_recovery_failed",
            error: recoverErr?.message?.slice(0, 300),
            timestamp: new Date().toISOString(),
          }))
        }
      }

      console.log(JSON.stringify({
        level: "info",
        action: "enable_data_diagnostic",
        smartAccount: permissionAccount.address,
        typedDataHash,
        enableDataHash,
        selectorDataHash,
        enableSigHash: enableSig ? keccak256(enableSig) : null,
        enableSigLength: enableSig?.length || 0,
        validationId: typedData.message?.validationId,
        nonce: typedData.message?.nonce,
        hook: typedData.message?.hook,
        domain: JSON.stringify(typedData.domain),
        recoveredSigner,
        signerMatchesOwner,
        timestamp: new Date().toISOString(),
      }))

      if (!signerMatchesOwner && recoveredSigner) {
        const errDetail = "The enable signature recovered a different address than the " +
          "on-chain ECDSA validator owner. This UserOp WILL fail with " +
          "EnableNotApproved on-chain. The session key must be re-granted."
        console.error(JSON.stringify({
          level: "error",
          action: "enable_sig_will_fail",
          smartAccount: permissionAccount.address,
          detail: errDetail,
          recoveredSigner,
          timestamp: new Date().toISOString(),
        }))
        // Abort early — do not submit UserOp that is guaranteed to fail.
        // The caller (rebalancer) treats EnableNotApproved as a definitive
        // session key error and deactivates the key.
        throw new Error(
          `EnableNotApproved (pre-check): enable signature signer ${recoveredSigner} ` +
          `does not match on-chain ECDSA owner. Session key must be re-granted.`
        )
      }
    } else {
      console.log(JSON.stringify({
        level: "warn",
        action: "enable_data_diagnostic_skipped",
        hasKpm: !!kpm,
        hasGetPluginsEnableTypedData: typeof kpm?.getPluginsEnableTypedData,
        hasGetPluginEnableSignature: typeof kpm?.getPluginEnableSignature,
        timestamp: new Date().toISOString(),
      }))
    }
  } catch (enableDiagErr) {
    // Re-throw if this is our own pre-check abort (EnableNotApproved)
    if (enableDiagErr?.message?.includes("EnableNotApproved (pre-check)")) {
      throw enableDiagErr
    }
    const enableDiagMessage = String(enableDiagErr?.message || "")
    if (enableDiagMessage.toLowerCase().includes("sudo validator not set")) {
      console.log(JSON.stringify({
        level: "info",
        action: "enable_data_diagnostic_skipped",
        reason: "sudo validator not set in current plugin mode",
        timestamp: new Date().toISOString(),
      }))
    } else {
      console.log(JSON.stringify({
        level: "warn",
        action: "enable_data_diagnostic_failed",
        error: enableDiagErr?.message?.slice(0, 300),
        timestamp: new Date().toISOString(),
      }))
    }
  }

  const clientConfig = {
    // SDK 5.4.x migration: client is required for on-chain reads during
    // UserOp construction (enable mode state checks, gas estimation, etc.)
    client: publicClient,
    account: permissionAccount,
    chain: CHAIN,
    bundlerTransport: http(BUNDLER_URL, { fetchOptions: ZERODEV_FETCH_OPTIONS }),
  }

  // Pass the ZeroDev paymaster client directly — NOT wrapped in { getPaymasterData }.
  // The wrapper pattern was missing getPaymasterStubData, which meant gas estimation
  // for enable-mode UserOps (with ~20KB enableData) ran WITHOUT paymaster context,
  // producing wrong gas estimates that the paymaster rejected (AA00).
  // Passing the client directly matches the frontend (deployInitialViaPermissionAccount)
  // which successfully installed permissions via enable mode.
  if (options.withPaymaster) {
    clientConfig.paymaster = createZeroDevPaymasterClient({
      chain: CHAIN,
      transport: http(PAYMASTER_URL, { fetchOptions: ZERODEV_FETCH_OPTIONS }),
    })
  }

  const client = createKernelAccountClient(clientConfig)

  return {
    client,
    publicClient,
    permissionAccount,
    permissionAccountAddress: permissionAccount.address,
  }
}

/**
 * Build the correct ERC-4626 withdrawal call.
 * - Known amount → withdraw(assets, receiver, owner) — takes USDC amount directly.
 * - MAX → redeem(shareBalance, receiver, owner) — requires backend to pass actual share balance.
 * NEVER use redeem() with USDC amounts — shares ≠ assets when share price > 1.0.
 */
/**
 * Verify the smart account actually holds vault shares before building
 * a withdrawal call.  If the account has 0 shares, the on-chain redeem/
 * withdraw will revert ("burn amount exceeds balance"), which reverts
 * the entire atomic UserOp.  Catching this BEFORE submission prevents
 * the infinite failure loop of stale-DB → impossible withdrawal → revert
 * → retry next cycle → same failure.
 */
async function verifyVaultShareBalance(publicClient, vaultAddress, accountAddress, protocolName) {
  try {
    const shareBalance = await publicClient.readContract({
      address: vaultAddress,
      abi: ERC4626_ABI,
      functionName: "balanceOf",
      args: [accountAddress],
    })
    if (shareBalance === 0n) {
      throw new Error(
        `${protocolName} withdrawal skipped: account ${accountAddress} has 0 vault shares ` +
        `in ${vaultAddress}. DB allocation is stale — reconciling.`
      )
    }
    console.log(JSON.stringify({
      level: "info",
      action: "vault_share_balance_verified",
      protocol: protocolName,
      vaultAddress,
      accountAddress,
      shareBalance: shareBalance.toString(),
      timestamp: new Date().toISOString(),
    }))
  } catch (err) {
    if (err.message?.includes("withdrawal skipped")) {
      throw err // Re-throw our own guard error
    }
    // RPC failure — log warning but don't block the withdrawal
    // (the on-chain transaction will tell us if it works)
    console.log(JSON.stringify({
      level: "warn",
      action: "vault_share_balance_check_failed",
      protocol: protocolName,
      error: err?.message?.slice(0, 200),
      timestamp: new Date().toISOString(),
    }))
  }
}

function buildErc4626Withdrawal(vaultAddress, amountUSDC, shareBalance, smartAccountAddress) {
  if (amountUSDC === "MAX") {
    if (!shareBalance) {
      throw new Error(`MAX withdrawal from ${vaultAddress} requires shareBalance but none provided`)
    }
    return {
      to: vaultAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_ABI,
        functionName: "redeem",
        args: [BigInt(shareBalance), smartAccountAddress, smartAccountAddress],
      }),
    }
  }
  // Known USDC amount → use withdraw(assets) which accepts the USDC amount directly
  return {
    to: vaultAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC4626_ABI,
      functionName: "withdraw",
      args: [parseUnits(String(amountUSDC), 6), smartAccountAddress, smartAccountAddress],
    }),
  }
}

function parseUsdcUnits(amountUSDC, fieldName = "amountUSDC") {
  const raw = String(amountUSDC ?? "").trim()
  if (!raw) {
    throw new Error(`${fieldName} is required`)
  }
  let units
  try {
    units = parseUnits(raw, USDC_DECIMALS)
  } catch (err) {
    throw new Error(`${fieldName} must be a valid USDC decimal value: ${err?.message || "invalid format"}`)
  }
  if (units < 0n) {
    throw new Error(`${fieldName} cannot be negative`)
  }
  return units
}

function formatUsdcUnits(amountUnits) {
  const isNegative = amountUnits < 0n
  const abs = isNegative ? -amountUnits : amountUnits
  const whole = abs / USDC_SCALE
  const fraction = (abs % USDC_SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "")
  const sign = isNegative ? "-" : ""
  if (!fraction) {
    return `${sign}${whole.toString()}`
  }
  return `${sign}${whole.toString()}.${fraction}`
}

function computeUsdcSafetyBuffer(projectedUnits) {
  if (projectedUnits <= 0n) {
    return 0n
  }
  const bpsBuffer = (projectedUnits * USDC_PROJECTION_BUFFER_BPS) / 10_000n
  const baseline = bpsBuffer > MIN_USDC_PROJECTION_BUFFER ? bpsBuffer : MIN_USDC_PROJECTION_BUFFER
  return baseline > projectedUnits ? projectedUnits : baseline
}

function sumPlannedDepositUnits(deposits) {
  let total = 0n
  for (const deposit of deposits || []) {
    total += parseUsdcUnits(deposit?.amountUSDC, "deposits[].amountUSDC")
  }
  return total
}

export function isErc20BalanceInsufficientError(err) {
  const text = [
    err?.shortMessage,
    err?.message,
    err?.details,
    err?.cause?.message,
    err?.cause?.details,
    ...(Array.isArray(err?.metaMessages) ? err.metaMessages : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return (
    text.includes("erc20: transfer amount exceeds balance")
    || text.includes("transfer amount exceeds balance")
    || text.includes("insufficient balance for transfer")
  )
}

export function capDepositsToProjectedBalance(deposits, availableUnits) {
  const available = availableUnits > 0n ? availableUnits : 0n
  let remaining = available
  let requestedTotal = 0n
  let plannedTotal = 0n
  let cappedLegCount = 0
  const normalized = []

  for (const deposit of deposits || []) {
    const requestedUnits = parseUsdcUnits(deposit?.amountUSDC, "deposits[].amountUSDC")
    if (requestedUnits === 0n) {
      continue
    }

    requestedTotal += requestedUnits
    if (remaining === 0n) {
      cappedLegCount += 1
      continue
    }

    const plannedUnits = requestedUnits <= remaining ? requestedUnits : remaining
    remaining -= plannedUnits
    plannedTotal += plannedUnits
    if (plannedUnits < requestedUnits) {
      cappedLegCount += 1
    }

    normalized.push({
      ...deposit,
      amountUSDC: formatUsdcUnits(plannedUnits),
    })
  }

  return {
    deposits: normalized,
    requestedTotal,
    plannedTotal,
    remainingUnits: remaining,
    cappedLegCount,
  }
}

async function estimateErc4626WithdrawalAssets(execPublicClient, vaultAddress, shareBalance) {
  const shares = BigInt(shareBalance)
  if (shares <= 0n) {
    return 0n
  }

  try {
    const preview = await execPublicClient.readContract({
      address: vaultAddress,
      abi: ERC4626_ABI,
      functionName: "previewRedeem",
      args: [shares],
    })
    return preview > 0n ? preview : 0n
  } catch {
    // Fallback to convertToAssets for vaults that do not expose previewRedeem.
    try {
      const converted = await execPublicClient.readContract({
        address: vaultAddress,
        abi: ERC4626_ABI,
        functionName: "convertToAssets",
        args: [shares],
      })
      return converted > 0n ? converted : 0n
    } catch {
      return 0n
    }
  }
}

async function estimateProjectedWithdrawalUsdc({
  execPublicClient,
  smartAccountAddress,
  withdrawals,
  contracts,
}) {
  let projectedUnits = 0n
  const erc4626VaultByProtocol = {
    spark: contracts.SPARK_VAULT,
    euler_v2: contracts.EULER_VAULT,
    silo_savusd_usdc: contracts.SILO_SAVUSD_VAULT,
    silo_susdp_usdc: contracts.SILO_SUSDP_VAULT,
  }

  for (const withdrawal of withdrawals || []) {
    const protocol = String(withdrawal?.protocol || "")
    const amountUSDC = withdrawal?.amountUSDC

    if (amountUSDC && amountUSDC !== "MAX") {
      projectedUnits += parseUsdcUnits(amountUSDC, `withdrawals.${protocol}.amountUSDC`)
      continue
    }

    const vaultAddress = erc4626VaultByProtocol[protocol]
    if (amountUSDC === "MAX" && vaultAddress && withdrawal?.shareBalance) {
      const estimated = await estimateErc4626WithdrawalAssets(
        execPublicClient,
        vaultAddress,
        withdrawal.shareBalance,
      )
      projectedUnits += estimated
      continue
    }

    if (amountUSDC === "MAX") {
      console.log(JSON.stringify({
        level: "warn",
        action: "projected_withdrawal_unknown_max_amount",
        smartAccountAddress,
        protocol,
        detail: "Unable to pre-estimate MAX withdrawal amount for this protocol; using conservative zero estimate",
        timestamp: new Date().toISOString(),
      }))
    }
  }

  return projectedUnits
}

function resolveContractKey(protocol, contracts) {
  const map = {
    aave_v3: "AAVE_POOL",
    aave: "AAVE_POOL",
    benqi: "BENQI_POOL",
    spark: "SPARK_VAULT",
    euler_v2: "EULER_VAULT",
    silo_savusd_usdc: "SILO_SAVUSD_VAULT",
    silo_susdp_usdc: "SILO_SUSDP_VAULT",
  }
  return contracts[map[protocol]] || null
}

function buildKernelBatchExecutionCalldata(calls) {
  return encodeFunctionData({
    abi: [{
      name: "execute",
      type: "function",
      stateMutability: "payable",
      inputs: [
        { name: "execMode", type: "bytes32" },
        { name: "executionCalldata", type: "bytes" },
      ],
      outputs: [],
    }],
    functionName: "execute",
    args: [
      // ExecMode: BATCH mode (0x01 at byte 0, rest 0)
      "0x0100000000000000000000000000000000000000000000000000000000000000",
      encodeAbiParameters(
        parseAbiParameters("(address to, uint256 value, bytes data)[]"),
        [calls.map(c => [c.to, c.value || 0n, c.data])],
      ),
    ],
  })
}

async function resolveKernelOwner(permissionAccount) {
  if (typeof permissionAccount.getOwner === "function") {
    const owner = await permissionAccount.getOwner()
    if (owner) return owner
  }
  if (typeof permissionAccount.getOwners === "function") {
    const owners = await permissionAccount.getOwners()
    if (Array.isArray(owners) && owners.length > 0) {
      return owners[0]
    }
  }
  throw new Error("Unable to resolve smart-account owner from on-chain kernel account")
}

export async function executeRebalance({
  serializedPermission,
  sessionPrivateKey,
  smartAccountAddress,
  withdrawals,
  deposits,
  contracts,
  feeTransfer,
  userTransfer,
}) {
  if (!ZERODEV_ID) {
    throw new Error("ZERODEV_PROJECT_ID is missing in execution service environment")
  }

  // ── Pre-flight: inspect the serialized blob for enableSignature ──
  // The blob is base64-encoded JSON. Check if it contains the enable
  // signature that the frontend's createKernelAccount(sudo+regular) produced.
  // If enableSignature is missing/empty, enable mode will always fail.
  let blobHasEnableSig = false
  let blobEnableSigLength = 0
  try {
    const decoded = JSON.parse(Buffer.from(serializedPermission, "base64").toString("utf-8"))
    blobHasEnableSig = !!decoded.enableSignature && decoded.enableSignature.length > 2
    blobEnableSigLength = decoded.enableSignature?.length || 0
    console.log(JSON.stringify({
      level: "info",
      action: "blob_enable_sig_check",
      smartAccountAddress,
      blobHasEnableSig,
      blobEnableSigLength,
      blobIsPreInstalled: !!decoded.isPreInstalled,
      timestamp: new Date().toISOString(),
    }))
  } catch (e) {
    console.log(JSON.stringify({
      level: "warn",
      action: "blob_enable_sig_check_failed",
      error: e?.message?.slice(0, 200),
      timestamp: new Date().toISOString(),
    }))
  }

  // ── Smart mode selection via EntryPoint nonce for this permissionId ──
  // Previous v1.4.0-1.4.1 used Kernel's currentNonce() which is the internal
  // CONFIG nonce (incremented by setRootValidator etc.), NOT the EntryPoint
  // nonce for a specific permissionId. That always returned >0 for deployed
  // accounts → forced regular mode → broke new/re-granted session keys.
  //
  // Correct approach: query EntryPoint.getNonce(account, nonceKey) where the
  // nonceKey encodes the permissionId. If nonce > 0 for the REGULAR mode key,
  // this permissionId has already been used successfully → skip enable mode.
  // If nonce == 0, the permissionId has never been used → try enable mode.
  let useEnableModeFirst = blobHasEnableSig
  let entryPointNonceForMode = 0n
  let blobPermissionIdForMode = null
  try {
    // Extract permissionId from the blob JSON to construct the nonce key.
    // The permissionId is not stored directly — we parse it after a quick
    // deserialization. To avoid a full second deserialization later, we
    // only do this check if the blob has an enableSig (mode decision matters).
    if (blobHasEnableSig) {
      const tempPublicClient = createAvalanchePublicClient()
      // Quick deserialization to extract the permissionId from the validator
      const tempSigner = await toECDSASigner({
        signer: privateKeyToAccount(sessionPrivateKey || ""),
      })
      const tempAccount = await deserializePermissionAccount(
        tempPublicClient,
        ENTRYPOINT,
        KERNEL_V3_1,
        serializedPermission,
        tempSigner,
      )
      const tempValidator = tempAccount.kernelPluginManager?.regular
        || tempAccount.kernelPluginManager?.regularValidator
      if (tempValidator && typeof tempValidator.getIdentifier === "function") {
        blobPermissionIdForMode = tempValidator.getIdentifier()
      }

      if (blobPermissionIdForMode) {
        // Construct BOTH regular and enable mode nonce keys for this permissionId.
        // Kernel v3.1 nonce layout (uint256 → upper 192 bits = key):
        //   byte 0 = mode (0x00=default/regular, 0x01=enable)
        //   byte 1 = validationType (0x02=PERMISSION)
        //   bytes 2-5 = permissionId (4 bytes)
        //   bytes 6-23 = zeros
        // We must check BOTH keys because:
        //   - If enable seq > 0: a previous enable-mode UserOp was mined for this
        //     permissionId → permission IS installed → must use regular mode.
        //   - If regular seq > 0: a previous regular-mode UserOp succeeded.
        //   - If BOTH are 0: permission has never been used → try enable mode.
        // Previously we only checked the regular key, which missed the case where
        // enable mode succeeded (installing the permission) but the inner calls
        // reverted → regular seq stays 0 → code incorrectly retried enable mode
        // → "duplicate permissionHash" revert.
        const permIdBigInt = BigInt(blobPermissionIdForMode)
        const regularNonceKey = (2n << 176n) | (permIdBigInt << 144n)
        const enableNonceKey = (1n << 184n) | (2n << 176n) | (permIdBigInt << 144n)

        const ENTRYPOINT_ADDR = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
        const nonceAbi = [{
          name: "getNonce",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "sender", type: "address" }, { name: "key", type: "uint192" }],
          outputs: [{ type: "uint256" }],
        }]
        const [regularFullNonce, enableFullNonce] = await Promise.all([
          tempPublicClient.readContract({
            address: ENTRYPOINT_ADDR,
            abi: nonceAbi,
            functionName: "getNonce",
            args: [smartAccountAddress, regularNonceKey],
          }),
          tempPublicClient.readContract({
            address: ENTRYPOINT_ADDR,
            abi: nonceAbi,
            functionName: "getNonce",
            args: [smartAccountAddress, enableNonceKey],
          }),
        ])

        // EntryPoint.getNonce returns (key << 64 | sequenceNumber).
        // Extract only the sequence number (lower 64 bits) to check
        // actual usage, because any non-zero key makes the full value > 0.
        const regularSeq = regularFullNonce & ((1n << 64n) - 1n)
        const enableSeq = enableFullNonce & ((1n << 64n) - 1n)
        entryPointNonceForMode = regularSeq > 0n ? regularSeq : enableSeq

        if (regularSeq > 0n || enableSeq > 0n) {
          // This permissionId has been used in enable or regular mode.
          // The permission IS registered on-chain → skip enable mode.
          useEnableModeFirst = false
          console.log(JSON.stringify({
            level: "info",
            action: "mode_selection_entrypoint_nonce_override",
            smartAccountAddress,
            permissionId: blobPermissionIdForMode,
            regularSeq: regularSeq.toString(),
            enableSeq: enableSeq.toString(),
            regularNonceKey: "0x" + regularNonceKey.toString(16).padStart(48, "0"),
            enableNonceKey: "0x" + enableNonceKey.toString(16).padStart(48, "0"),
            detail: enableSeq > 0n
              ? "Enable-mode sequence > 0 → permission was installed by a previous enable UserOp. Using regular mode."
              : "Regular-mode sequence > 0 → permission already used in regular mode. Using regular mode.",
            timestamp: new Date().toISOString(),
          }))
        } else {
          console.log(JSON.stringify({
            level: "info",
            action: "mode_selection_entrypoint_nonce_zero",
            smartAccountAddress,
            permissionId: blobPermissionIdForMode,
            regularSeq: "0",
            enableSeq: "0",
            detail: "EntryPoint nonce = 0 for BOTH enable and regular keys. " +
              "Permission has NOT been installed for this permissionId. Using enable mode.",
            timestamp: new Date().toISOString(),
          }))
        }
      }
    }
  } catch (nonceErr) {
    // If nonce query fails (e.g. account not deployed, RPC error),
    // fall through to enable mode which handles deployment + enable.
    console.log(JSON.stringify({
      level: "warn",
      action: "mode_selection_entrypoint_nonce_failed",
      smartAccountAddress,
      permissionId: blobPermissionIdForMode,
      error: nonceErr?.message?.slice(0, 300),
      timestamp: new Date().toISOString(),
    }))
  }

  const initialForceRegular = !useEnableModeFirst

  console.log(JSON.stringify({
    level: "info",
    action: "mode_selection",
    smartAccountAddress,
    useEnableModeFirst,
    initialForceRegular,
    permissionId: blobPermissionIdForMode,
    entryPointSequence: entryPointNonceForMode.toString(),
    reason: useEnableModeFirst
      ? "Blob contains enableSignature + EntryPoint sequence=0 → enable mode to register permission on-chain"
      : entryPointNonceForMode > 0n
        ? "EntryPoint sequence > 0 for this permissionId → permission already enabled, using regular mode"
        : "Blob has no enableSignature → permission should already be on-chain, using regular mode",
    timestamp: new Date().toISOString(),
  }))

  const { client: kernelClient, publicClient: execPublicClient, permissionAccountAddress, permissionAccount } = await getKernelClient(
    serializedPermission,
    sessionPrivateKey || "",
    { withPaymaster: true, forceRegularMode: initialForceRegular },
  )

  if (permissionAccountAddress.toLowerCase() !== smartAccountAddress.toLowerCase()) {
    throw new Error(
      `Session key/account mismatch: permissionAccount=${permissionAccountAddress} sender=${smartAccountAddress}`,
    )
  }

  // Only resolve owner when needed (userTransfer requires the EOA destination).
  // Standard rebalances (idle → protocol) have no userTransfer, so skip the
  // expensive on-chain resolution that fails on ZeroDev v5.x permission accounts.
  let onchainOwner = null
  if (userTransfer) {
    if (userTransfer.to) {
      // Trust the backend-provided destination (backend calls are HMAC-authenticated)
      onchainOwner = userTransfer.to
    } else {
      onchainOwner = await resolveKernelOwner(permissionAccount)
    }
  }
  const calls = []

  for (const { protocol, amountUSDC, qiTokenAmount, shareBalance } of withdrawals) {
    if (protocol === "aave_v3" || protocol === "aave") {
      calls.push({
        to: contracts.AAVE_POOL,
        value: 0n,
        data: encodeFunctionData({
          abi: AAVE_ABI,
          functionName: "withdraw",
          args: [
            contracts.USDC,
            amountUSDC === "MAX" ? maxUint256 : parseUnits(String(amountUSDC), 6),
            smartAccountAddress,
          ],
        }),
      })
    } else if (protocol === "benqi") {
      calls.push({
        to: contracts.BENQI_POOL,
        value: 0n,
        data: encodeFunctionData({ abi: BENQI_ABI, functionName: "redeem", args: [BigInt(qiTokenAmount)] }),
      })
    } else if (protocol === "spark" && contracts.SPARK_VAULT) {
      await verifyVaultShareBalance(execPublicClient, contracts.SPARK_VAULT, smartAccountAddress, protocol)
      calls.push(buildErc4626Withdrawal(contracts.SPARK_VAULT, amountUSDC, shareBalance, smartAccountAddress))
    } else if (protocol === "euler_v2" && contracts.EULER_VAULT) {
      await verifyVaultShareBalance(execPublicClient, contracts.EULER_VAULT, smartAccountAddress, protocol)
      calls.push(buildErc4626Withdrawal(contracts.EULER_VAULT, amountUSDC, shareBalance, smartAccountAddress))
    } else if (protocol === "silo_savusd_usdc" && contracts.SILO_SAVUSD_VAULT) {
      await verifyVaultShareBalance(execPublicClient, contracts.SILO_SAVUSD_VAULT, smartAccountAddress, protocol)
      calls.push(buildErc4626Withdrawal(contracts.SILO_SAVUSD_VAULT, amountUSDC, shareBalance, smartAccountAddress))
    } else if (protocol === "silo_susdp_usdc" && contracts.SILO_SUSDP_VAULT) {
      await verifyVaultShareBalance(execPublicClient, contracts.SILO_SUSDP_VAULT, smartAccountAddress, protocol)
      calls.push(buildErc4626Withdrawal(contracts.SILO_SUSDP_VAULT, amountUSDC, shareBalance, smartAccountAddress))
    }
  }

  let preflightUsdcBalance = null
  try {
    preflightUsdcBalance = await execPublicClient.readContract({
      address: contracts.USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [smartAccountAddress],
    })
  } catch (err) {
    console.log(JSON.stringify({
      level: "warn",
      action: "preflight_usdc_balance_failed_early",
      smartAccountAddress,
      error: err?.message?.slice(0, 300),
      timestamp: new Date().toISOString(),
    }))
  }

  const projectedWithdrawalUnits = await estimateProjectedWithdrawalUsdc({
    execPublicClient,
    smartAccountAddress,
    withdrawals,
    contracts,
  })

  const feeTransferAmount = Number(feeTransfer?.amountUSDC ?? 0)
  const feeTransferUnits = feeTransferAmount > 0
    ? parseUsdcUnits(feeTransfer.amountUSDC, "feeTransfer.amountUSDC")
    : 0n
  const userTransferUnits = userTransfer && userTransfer.amountUSDC > 0
    ? parseUsdcUnits(userTransfer.amountUSDC, "userTransfer.amountUSDC")
    : 0n

  let normalizedDeposits = Array.isArray(deposits) ? deposits : []
  if (preflightUsdcBalance !== null && normalizedDeposits.length > 0) {
    const projectedGrossUnits = preflightUsdcBalance + projectedWithdrawalUnits - feeTransferUnits - userTransferUnits
    const projectedNonNegativeUnits = projectedGrossUnits > 0n ? projectedGrossUnits : 0n
    const safetyBufferUnits = computeUsdcSafetyBuffer(projectedNonNegativeUnits)
    const projectedBudgetUnits = projectedNonNegativeUnits > safetyBufferUnits
      ? projectedNonNegativeUnits - safetyBufferUnits
      : 0n

    const capped = capDepositsToProjectedBalance(normalizedDeposits, projectedBudgetUnits)
    normalizedDeposits = capped.deposits

    if (capped.plannedTotal < capped.requestedTotal) {
      console.log(JSON.stringify({
        level: "warn",
        action: "deposits_capped_for_projected_balance",
        smartAccountAddress,
        projectedBalance: projectedNonNegativeUnits.toString(),
        projectedWithdrawals: projectedWithdrawalUnits.toString(),
        reservedFeeTransfer: feeTransferUnits.toString(),
        reservedUserTransfer: userTransferUnits.toString(),
        safetyBuffer: safetyBufferUnits.toString(),
        requestedDepositTotal: capped.requestedTotal.toString(),
        plannedDepositTotal: capped.plannedTotal.toString(),
        cappedLegCount: capped.cappedLegCount,
        originalDepositCount: deposits.length,
        plannedDepositCount: normalizedDeposits.length,
        timestamp: new Date().toISOString(),
      }))
    } else {
      console.log(JSON.stringify({
        level: "info",
        action: "deposit_projection_budget_ok",
        smartAccountAddress,
        projectedBalance: projectedNonNegativeUnits.toString(),
        projectedWithdrawals: projectedWithdrawalUnits.toString(),
        reservedFeeTransfer: feeTransferUnits.toString(),
        reservedUserTransfer: userTransferUnits.toString(),
        safetyBuffer: safetyBufferUnits.toString(),
        plannedDepositTotal: capped.plannedTotal.toString(),
        timestamp: new Date().toISOString(),
      }))
    }
  } else if (normalizedDeposits.length > 0) {
    console.log(JSON.stringify({
      level: "warn",
      action: "deposit_projection_budget_skipped",
      smartAccountAddress,
      reason: "Unable to read preflight USDC balance",
      timestamp: new Date().toISOString(),
    }))
  }

  if (feeTransferAmount > 0) {
    const feeRecipient = String(feeTransfer?.to || "").trim()
    if (!feeRecipient || feeRecipient.toLowerCase() === zeroAddress.toLowerCase()) {
      throw new Error("feeTransfer requires a non-zero recipient address when amountUSDC > 0")
    }
    calls.push({
      to: contracts.USDC,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [feeRecipient, parseUnits(String(feeTransfer.amountUSDC), 6)],
      }),
    })
  }

  if (userTransfer && userTransfer.amountUSDC > 0) {
    if (!onchainOwner) {
      throw new Error("userTransfer requested but owner could not be resolved")
    }
    if (userTransfer.to && userTransfer.to.toLowerCase() !== onchainOwner.toLowerCase()) {
      throw new Error(`User transfer destination mismatch: provided=${userTransfer.to} onchainOwner=${onchainOwner}`)
    }
    calls.push({
      to: contracts.USDC,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [onchainOwner, parseUnits(String(userTransfer.amountUSDC), 6)],
      }),
    })
  }

  // DISABLED: On-chain logRebalance removed from the atomic batch.
  // Including Registry calls in the same UserOp risks the entire rebalance
  // reverting if the Registry call fails (permissions, gas, contract state).
  // Rebalance outcomes are tracked in the backend database instead.
  // The Registry can be called in a SEPARATE, non-critical transaction later
  // if on-chain audit logging is needed.

  const baseCallCount = calls.length

  const rebuildDepositAndApprovalCalls = () => {
    // Keep withdrawals + transfers untouched, then rebuild mutable deposit tail.
    calls.splice(baseCallCount)

    // Approve exact amounts per protocol — never use infinite approvals.
    // Aggregate deposits per protocol, then approve-to-zero + approve exact sum.
    const depositAmountsPerProtocol = new Map()
    for (const { protocol, amountUSDC } of normalizedDeposits) {
      const prev = depositAmountsPerProtocol.get(protocol) || 0n
      depositAmountsPerProtocol.set(protocol, prev + parseUsdcUnits(amountUSDC, "deposits[].amountUSDC"))
    }
    for (const [protocol, totalAmount] of depositAmountsPerProtocol) {
      const spender = resolveContractKey(protocol, contracts)
      if (!spender) continue

      if (protocol === "euler_v2") {
        // Euler V2 (EVK) uses Permit2 for token transfers.
        // Flow: USDC.approve(Permit2) → Permit2.approve(USDC, euler, amt, deadline) → euler.deposit()
        const permit2Addr = contracts.PERMIT2 || PERMIT2_ADDRESS
        calls.push({
          to: contracts.USDC,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [permit2Addr, 0n],
          }),
        })
        calls.push({
          to: contracts.USDC,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [permit2Addr, totalAmount],
          }),
        })
        // Set Permit2 allowance for the Euler vault with 1-hour expiry
        const permit2Deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        calls.push({
          to: permit2Addr,
          value: 0n,
          data: encodeFunctionData({
            abi: PERMIT2_ABI,
            functionName: "approve",
            args: [contracts.USDC, spender, totalAmount, permit2Deadline],
          }),
        })
      } else {
        // Standard ERC-20 approve race-condition protection: set to 0 first, then exact amount
        calls.push({
          to: contracts.USDC,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [spender, 0n],
          }),
        })
        calls.push({
          to: contracts.USDC,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [spender, totalAmount],
          }),
        })
      }
    }

    for (const { protocol, amountUSDC } of normalizedDeposits) {
      const amount = parseUsdcUnits(amountUSDC, "deposits[].amountUSDC")
      if (protocol === "aave_v3" || protocol === "aave") {
        calls.push({
          to: contracts.AAVE_POOL,
          value: 0n,
          data: encodeFunctionData({
            abi: AAVE_ABI,
            functionName: "supply",
            args: [contracts.USDC, amount, smartAccountAddress, 0],
          }),
        })
      } else if (protocol === "benqi") {
        calls.push({
          to: contracts.BENQI_POOL,
          value: 0n,
          data: encodeFunctionData({ abi: BENQI_ABI, functionName: "mint", args: [amount] }),
        })
      } else if (protocol === "spark" && contracts.SPARK_VAULT) {
        calls.push({
          to: contracts.SPARK_VAULT,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: "deposit",
            args: [amount, smartAccountAddress],
          }),
        })
      } else if (protocol === "euler_v2" && contracts.EULER_VAULT) {
        calls.push({
          to: contracts.EULER_VAULT,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: "deposit",
            args: [amount, smartAccountAddress],
          }),
        })
      } else if (protocol === "silo_savusd_usdc" && contracts.SILO_SAVUSD_VAULT) {
        calls.push({
          to: contracts.SILO_SAVUSD_VAULT,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: "deposit",
            args: [amount, smartAccountAddress],
          }),
        })
      } else if (protocol === "silo_susdp_usdc" && contracts.SILO_SUSDP_VAULT) {
        calls.push({
          to: contracts.SILO_SUSDP_VAULT,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC4626_ABI,
            functionName: "deposit",
            args: [amount, smartAccountAddress],
          }),
        })
      }
    }
  }

  rebuildDepositAndApprovalCalls()

  if (!calls.length) {
    throw new Error("No executable calls generated for rebalance")
  }

  // ── Pre-flight balance diagnostic: check USDC + vault share balances ──
  try {
    const usdcBalance = preflightUsdcBalance !== null
      ? preflightUsdcBalance
      : await execPublicClient.readContract({
        address: contracts.USDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [smartAccountAddress],
      })
    console.log(JSON.stringify({
      level: "info", action: "preflight_usdc_balance",
      smartAccountAddress,
      usdcBalance: usdcBalance.toString(),
      usdcBalanceFormatted: `$${(Number(usdcBalance) / 1e6).toFixed(6)}`,
      timestamp: new Date().toISOString(),
    }))
  } catch (e) {
    console.log(JSON.stringify({
      level: "warn", action: "preflight_usdc_balance_failed",
      error: e?.message?.slice(0, 200),
      timestamp: new Date().toISOString(),
    }))
  }

  // Log the call targets for debugging session key / policy mismatches
  // Decode function selectors to human-readable names
  const KNOWN_SELECTORS = {
    "0x095ea7b3": "approve(address,spender,uint256,amount)",
    "0xa9059cbb": "transfer(address,uint256)",
    "0x6e553f65": "deposit(uint256,address)",
    "0xb460af94": "withdraw(uint256,address,address)",
    "0xba087652": "redeem(uint256,address,address)",
    "0x617ba037": "supply(address,uint256,address,uint16)",
    "0x69328dec": "aaveWithdraw(address,uint256,address)",
    "0xa0712d68": "mint(uint256)",
    "0xdb006a75": "benqiRedeem(uint256)",
    "0x87517c45": "permit2Approve(address,address,uint160,uint48)",
  }
  const callDetails = calls.map((c, i) => ({
    index: i,
    target: c.to,
    selector: c.data?.slice(0, 10) || "none",
    decoded: KNOWN_SELECTORS[c.data?.slice(0, 10)] || "unknown",
    dataLength: c.data?.length || 0,
  }))
  console.log(JSON.stringify({
    level: "info",
    action: "rebalance_calls_built",
    smartAccountAddress,
    permissionAccountAddress,
    callCount: calls.length,
    callTargets: calls.map((c) => c.to),
    callDetails,
    timestamp: new Date().toISOString(),
  }))

  // Pre-flight: check if smart account is deployed (helps diagnose session key issues)
  try {
    const code = await execPublicClient.getBytecode({ address: smartAccountAddress })
    const isDeployed = code && code !== "0x" && code.length > 2
    console.log(JSON.stringify({
      level: "info", action: "preflight_check",
      smartAccountAddress,
      accountDeployed: isDeployed,
      callCount: calls.length,
      callTargets: calls.map((c) => c.to),
      timestamp: new Date().toISOString(),
    }))
  } catch (preflightErr) {
    console.log(JSON.stringify({
      level: "warn", action: "preflight_check_failed",
      smartAccountAddress, error: preflightErr?.message?.slice(0, 200),
      timestamp: new Date().toISOString(),
    }))
  }

  // ── Individual call simulation (eth_call) ──
  // Simulate each call as if sent directly FROM the smart account (msg.sender = smart account).
  // This bypasses ERC-4337 validation and tests whether the inner DeFi calls would succeed.
  // If a call reverts here, it will also revert inside the UserOp.
  try {
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]
      try {
        await execPublicClient.call({
          account: smartAccountAddress,
          to: call.to,
          data: call.data,
          value: call.value || 0n,
        })
        console.log(JSON.stringify({
          level: "info", action: "call_simulation_ok",
          smartAccountAddress, callIndex: i, target: call.to,
          selector: call.data?.slice(0, 10) || "none",
          timestamp: new Date().toISOString(),
        }))
      } catch (simErr) {
        console.log(JSON.stringify({
          level: "warn", action: "call_simulation_reverted_nonfatal",
          smartAccountAddress, callIndex: i, target: call.to,
          selector: call.data?.slice(0, 10) || "none",
          note: "Individual call simulation can fail for state-dependent calls; rely on batch_simulation_* for final verdict",
          error: simErr?.message?.slice(0, 2000),
          shortMessage: simErr?.shortMessage?.slice(0, 1000),
          details: simErr?.details?.slice(0, 1000),
          causeMessage: simErr?.cause?.message?.slice(0, 1000),
          timestamp: new Date().toISOString(),
        }))
      }
    }
  } catch (simBatchErr) {
    console.log(JSON.stringify({
      level: "warn", action: "call_simulation_batch_error",
      error: simBatchErr?.message?.slice(0, 500),
      timestamp: new Date().toISOString(),
    }))
  }

  // ── Simulate full batch via Kernel's execute(calls) ──
  // Encode the full batched call exactly as the Kernel will execute it.
  // This tests the complete batch atomicity (prior calls affect later calls).
  const runBatchSimulation = async () => {
    await execPublicClient.call({
      account: smartAccountAddress,
      to: smartAccountAddress,
      data: buildKernelBatchExecutionCalldata(calls),
    })
  }

  let batchSimulationError = null
  try {
    await runBatchSimulation()
    console.log(JSON.stringify({
      level: "info", action: "batch_simulation_ok",
      smartAccountAddress, callCount: calls.length,
      timestamp: new Date().toISOString(),
    }))
  } catch (batchSimErr) {
    batchSimulationError = batchSimErr
    console.error(JSON.stringify({
      level: "error", action: "batch_simulation_REVERTED",
      smartAccountAddress, callCount: calls.length,
      error: batchSimErr?.message?.slice(0, 3000),
      shortMessage: batchSimErr?.shortMessage?.slice(0, 1000),
      details: batchSimErr?.details?.slice(0, 2000),
      causeMessage: batchSimErr?.cause?.message?.slice(0, 2000),
      timestamp: new Date().toISOString(),
    }))
  }

  // Fail safe for partial-withdrawal drift: reduce deposits, then retry batch simulation.
  if (batchSimulationError && isErc20BalanceInsufficientError(batchSimulationError) && normalizedDeposits.length > 0) {
    const currentPlannedDepositTotal = sumPlannedDepositUnits(normalizedDeposits)
    const fallbackTrimUnits = currentPlannedDepositTotal > 10_000n ? 10_000n : 1n
    const fallbackBudget = currentPlannedDepositTotal > fallbackTrimUnits
      ? currentPlannedDepositTotal - fallbackTrimUnits
      : 0n
    const recapped = capDepositsToProjectedBalance(normalizedDeposits, fallbackBudget)

    if (recapped.plannedTotal < currentPlannedDepositTotal) {
      normalizedDeposits = recapped.deposits
      rebuildDepositAndApprovalCalls()

      console.log(JSON.stringify({
        level: "warn",
        action: "batch_simulation_replanned_deposits",
        smartAccountAddress,
        previousPlannedDepositTotal: currentPlannedDepositTotal.toString(),
        replannedDepositTotal: recapped.plannedTotal.toString(),
        droppedUnits: (currentPlannedDepositTotal - recapped.plannedTotal).toString(),
        remainingDepositCount: normalizedDeposits.length,
        callCount: calls.length,
        timestamp: new Date().toISOString(),
      }))

      try {
        await runBatchSimulation()
        batchSimulationError = null
        console.log(JSON.stringify({
          level: "info",
          action: "batch_simulation_ok_after_replan",
          smartAccountAddress,
          callCount: calls.length,
          timestamp: new Date().toISOString(),
        }))
      } catch (retryBatchSimErr) {
        batchSimulationError = retryBatchSimErr
        console.error(JSON.stringify({
          level: "error",
          action: "batch_simulation_REVERTED_after_replan",
          smartAccountAddress,
          callCount: calls.length,
          error: retryBatchSimErr?.message?.slice(0, 3000),
          shortMessage: retryBatchSimErr?.shortMessage?.slice(0, 1000),
          details: retryBatchSimErr?.details?.slice(0, 2000),
          causeMessage: retryBatchSimErr?.cause?.message?.slice(0, 2000),
          timestamp: new Date().toISOString(),
        }))
      }
    }
  }

  // Last-resort fail-safe: execute withdrawals only if deposits still overdraw.
  if (batchSimulationError && isErc20BalanceInsufficientError(batchSimulationError) && normalizedDeposits.length > 0) {
    const droppedDepositCount = normalizedDeposits.length
    normalizedDeposits = []
    rebuildDepositAndApprovalCalls()

    console.log(JSON.stringify({
      level: "warn",
      action: "batch_simulation_dropped_all_deposits",
      smartAccountAddress,
      droppedDepositCount,
      callCount: calls.length,
      timestamp: new Date().toISOString(),
    }))

    try {
      await runBatchSimulation()
      batchSimulationError = null
      console.log(JSON.stringify({
        level: "info",
        action: "batch_simulation_ok_without_deposits",
        smartAccountAddress,
        callCount: calls.length,
        timestamp: new Date().toISOString(),
      }))
    } catch (finalBatchSimErr) {
      batchSimulationError = finalBatchSimErr
      console.error(JSON.stringify({
        level: "error",
        action: "batch_simulation_REVERTED_without_deposits",
        smartAccountAddress,
        callCount: calls.length,
        error: finalBatchSimErr?.message?.slice(0, 3000),
        shortMessage: finalBatchSimErr?.shortMessage?.slice(0, 1000),
        details: finalBatchSimErr?.details?.slice(0, 2000),
        causeMessage: finalBatchSimErr?.cause?.message?.slice(0, 2000),
        timestamp: new Date().toISOString(),
      }))
    }
  }

  if (!calls.length) {
    throw new Error("No executable calls remain after rebalance safety adjustments")
  }

  if (batchSimulationError && isErc20BalanceInsufficientError(batchSimulationError)) {
    throw new Error(formatExecutionError(batchSimulationError))
  }

  // ── Deep enable-signature verification ──
  // Use the SDK's own getPluginsEnableTypedData to produce the typed data
  // the exact same way the SDK does internally, then recover the signer
  // and compare it with the on-chain ECDSA validator owner.
  try {
    const kpm = permissionAccount.kernelPluginManager
    const regularValidator = kpm?.regularValidator
    const action = typeof kpm?.getAction === "function" ? kpm.getAction() : null

    // Check if the plugin is already enabled on-chain
    let pluginEnabledOnChain = "unknown"
    if (typeof kpm?.isPluginEnabled === "function" && action?.selector) {
      try {
        pluginEnabledOnChain = await kpm.isPluginEnabled(smartAccountAddress, action.selector)
      } catch (e) { pluginEnabledOnChain = `error: ${e?.message?.slice(0, 100)}` }
    }

    // Get the enable signature (cached from serialized blob)
    // NOTE: If forceRegularMode was used, enableSignature was deleted from the
    // deserialized blob, so this will be null. The blobEnableSigLength logged
    // earlier (from the ORIGINAL blob) is the authoritative check.
    let enableSig = null
    if (typeof kpm?.getPluginEnableSignature === "function") {
      try {
        enableSig = await kpm.getPluginEnableSignature(smartAccountAddress)
      } catch (e) { /* will be logged below */ }
    }

    // Get the enable data from the deserialized permission plugin
    let enableDataHex = null
    if (regularValidator && typeof regularValidator.getEnableData === "function") {
      try {
        enableDataHex = await regularValidator.getEnableData(smartAccountAddress)
      } catch (e) { /* ignore */ }
    }

    // Get the permission ID (validator identifier)
    let permissionId = null
    if (regularValidator && typeof regularValidator.getIdentifier === "function") {
      try {
        permissionId = regularValidator.getIdentifier()
      } catch (e) { /* ignore */ }
    }

    // Read the on-chain currentNonce and compute the SDK nonce
    let onchainNonce = null
    let sdkNonce = null
    try {
      onchainNonce = await execPublicClient.readContract({
        address: smartAccountAddress,
        abi: [{ name: "currentNonce", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] }],
        functionName: "currentNonce",
      })
      sdkNonce = onchainNonce === 0 ? 1 : Number(onchainNonce)
    } catch (e) { /* ignore */ }

    // Get the on-chain EIP-712 domain version (same logic as SDK's accountMetadata)
    let onchainVersion = KERNEL_V3_1 // fallback
    try {
      const domainResult = await execPublicClient.request({
        method: "eth_call",
        params: [{
          to: smartAccountAddress,
          data: encodeFunctionData({
            abi: [{ name: "eip712Domain", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bytes1" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "uint256[]" }] }],
            functionName: "eip712Domain",
          }),
        }, "latest"],
      })
      if (domainResult && domainResult !== "0x") {
        const decoded = decodeFunctionResult({
          abi: [{ name: "eip712Domain", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bytes1" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "uint256[]" }] }],
          functionName: "eip712Domain",
          data: domainResult,
        })
        onchainVersion = decoded[2] // version string
      }
    } catch (e) { /* use fallback */ }

    // ── Inline SDK's getPluginsEnableTypedData (ep0_7) ──
    // Direct import of SDK internal path fails due to package exports.
    // This is a verbatim copy of the SDK function from:
    // @zerodev/sdk/_esm/accounts/kernel/utils/plugins/ep0_7/getPluginsEnableTypedData.js
    const VALIDATOR_TYPE_MAP = { SUDO: "0x00", SECONDARY: "0x01", PERMISSION: "0x02" }
    const CALL_TYPE_INLINE = { DELEGATE_CALL: "0xFF" }

    let backendRecoveredSigner = "unable_to_recover"
    let backendTypedDataHash = "none"
    let enableSigHash = enableSig ? keccak256(enableSig) : "none"
    let backendValidationId = "none"
    let backendSelectorDataHash = "none"
    let backendDomain = "none"
    let eip191RecoveredSigner = "not_computed"

    if (enableSig && enableDataHex && regularValidator && sdkNonce !== null) {
      try {
        const validationId = concat([
          VALIDATOR_TYPE_MAP[regularValidator.validatorType],
          pad(regularValidator.getIdentifier(), { size: 20, dir: "right" }),
        ])
        const selectorData = concat([
          action.selector,
          action.address,
          action.hook?.address ?? zeroAddress,
          encodeAbiParameters(
            parseAbiParameters("bytes selectorInitData, bytes hookInitData"),
            [CALL_TYPE_INLINE.DELEGATE_CALL, "0x0000"],
          ),
        ])
        const domain = {
          name: "Kernel",
          version: onchainVersion === "0.3.0" ? "0.3.0-beta" : onchainVersion,
          chainId: CHAIN_ID,
          verifyingContract: smartAccountAddress,
        }
        const backendTypedData = {
          domain,
          types: {
            Enable: [
              { name: "validationId", type: "bytes21" },
              { name: "nonce", type: "uint32" },
              { name: "hook", type: "address" },
              { name: "validatorData", type: "bytes" },
              { name: "hookData", type: "bytes" },
              { name: "selectorData", type: "bytes" },
            ],
          },
          message: {
            validationId,
            nonce: sdkNonce,
            hook: zeroAddress,
            validatorData: enableDataHex,
            hookData: "0x",
            selectorData,
          },
          primaryType: "Enable",
        }

        backendTypedDataHash = hashTypedData(backendTypedData)
        backendValidationId = validationId
        backendSelectorDataHash = keccak256(selectorData)
        backendDomain = JSON.stringify(domain)

        backendRecoveredSigner = await recoverTypedDataAddress({
          ...backendTypedData,
          signature: enableSig,
        })

        // HYPOTHESIS CHECK: If Privy uses personal_sign (EIP-191) instead of
        // eth_signTypedData_v4 (EIP-712), recovering via EIP-191 should give
        // the correct owner address.
        try {
          eip191RecoveredSigner = await recoverMessageAddress({
            message: { raw: backendTypedDataHash },
            signature: enableSig,
          })
        } catch (e) {
          eip191RecoveredSigner = `error: ${e?.message?.slice(0, 200)}`
        }
      } catch (e) {
        backendRecoveredSigner = `error: ${e?.message?.slice(0, 200)}`
      }
    }

    // Read the on-chain ECDSA owner for comparison
    const ECDSA_VALIDATOR_MODULE = "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57"
    let ecdsaOwner = "unknown"
    try {
      ecdsaOwner = await execPublicClient.readContract({
        address: ECDSA_VALIDATOR_MODULE,
        abi: [{ name: "ecdsaValidatorStorage", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] }],
        functionName: "ecdsaValidatorStorage",
        args: [smartAccountAddress],
      })
    } catch (e) { /* ignore */ }

    const backendSignerMatchesOwner = typeof backendRecoveredSigner === "string"
      && typeof ecdsaOwner === "string"
      && backendRecoveredSigner.toLowerCase() === ecdsaOwner.toLowerCase()

    const ownerLooksUninitialized = typeof ecdsaOwner === "string" && (
      ecdsaOwner.toLowerCase() === zeroAddress.toLowerCase() ||
      ecdsaOwner.toLowerCase() === "unknown"
    )
    const typedDataDiagnosticsReady = (
      backendTypedDataHash !== "none" &&
      backendValidationId !== "none" &&
      backendSelectorDataHash !== "none" &&
      onchainNonce !== null &&
      sdkNonce !== null
    )
    const mismatchActionable = typedDataDiagnosticsReady && !ownerLooksUninitialized

    // Hash the enableData for cross-side comparison with frontend
    const enableDataHash = enableDataHex ? keccak256(enableDataHex) : "none"

    console.log(JSON.stringify({
      level: "info",
      action: "enable_signature_verification",
      smartAccountAddress,
      pluginEnabledOnChain,
      pluginEnabledOnChainNote: "WARNING: checks action selector only, not specific permissionId",
      onchainNonce: onchainNonce !== null ? Number(onchainNonce) : null,
      sdkNonce,
      onchainVersion,
      permissionId,
      validatorType: regularValidator?.validatorType ?? "unknown",
      enableDataLength: enableDataHex?.length ?? 0,
      enableDataHash,
      enableSigLength: enableSig?.length ?? 0,
      enableSigLengthNote: initialForceRegular
        ? "Expected 0 — forceRegularMode deletes enableSig from blob before deserialization"
        : "From deserialized blob (enable mode)",
      blobEnableSigLength,
      blobEnableSigNote: "From ORIGINAL blob before any modification — authoritative check",
      enableSigHash,
      backendTypedDataHash,
      backendValidationId,
      backendSelectorDataHash,
      backendDomain,
      backendRecoveredSigner,
      ecdsaOwner,
      backendSignerMatchesOwner,
      eip191RecoveredSigner,
      eip191MatchesOwner: typeof eip191RecoveredSigner === "string" && typeof ecdsaOwner === "string"
        ? eip191RecoveredSigner.toLowerCase() === ecdsaOwner.toLowerCase()
        : false,
      actionSelector: action?.selector ?? "null",
      actionAddress: action?.address ?? "null",
      actionHookAddress: action?.hook?.address ?? "none",
      timestamp: new Date().toISOString(),
    }))

    const hasRecoverableEnableSig = typeof enableSig === "string" && enableSig.startsWith("0x") && enableSig.length > 2
    if (hasRecoverableEnableSig && !backendSignerMatchesOwner) {
      if (mismatchActionable) {
        console.log(JSON.stringify({
          level: "error",
          action: "enable_signature_MISMATCH",
          detail: "Compare backendTypedDataHash with frontend typedDataHash from console logs. " +
            "If hashes match, the typed data is identical and the enable signature itself is the problem. " +
            "If hashes differ, compare validationId, selectorDataHash, domain, nonce to find the discrepancy.",
          backendRecoveredSigner,
          ecdsaOwner,
          enableDataHash,
          enableSigHash,
          backendTypedDataHash,
          backendValidationId,
          backendSelectorDataHash,
          onchainNonce: onchainNonce !== null ? Number(onchainNonce) : null,
          sdkNonce,
          timestamp: new Date().toISOString(),
        }))
      } else {
        console.log(JSON.stringify({
          level: "warn",
          action: "enable_signature_mismatch_deferred",
          detail: "Non-actionable mismatch during pre-enable diagnostics (owner uninitialized or typed-data inputs incomplete).",
          backendRecoveredSigner,
          ecdsaOwner,
          enableDataHash,
          enableSigHash,
          backendTypedDataHash,
          backendValidationId,
          backendSelectorDataHash,
          diagnosticsReady: typedDataDiagnosticsReady,
          ownerLooksUninitialized,
          onchainNonce: onchainNonce !== null ? Number(onchainNonce) : null,
          sdkNonce,
          timestamp: new Date().toISOString(),
        }))
      }
    }
  } catch (debugErr) {
    console.log(JSON.stringify({
      level: "warn",
      action: "enable_signature_debug_failed",
      error: debugErr?.message?.slice(0, 300),
      timestamp: new Date().toISOString(),
    }))
  }

  try {
    const txHash = await kernelClient.sendTransaction({ calls })

    // If enable mode was used (first-ever execution), the permission is now
    // registered on-chain. Log success so we know future attempts can skip enable.
    if (useEnableModeFirst) {
      console.log(JSON.stringify({
        level: "info", action: "enable_mode_succeeded",
        smartAccountAddress,
        detail: "Permission enabled on-chain via first UserOp. Future rebalances should use regular mode.",
        timestamp: new Date().toISOString(),
      }))
    }

    return {
      txHash,
      explorerUrl: `${EXPLORER_BASE}/tx/${txHash}`,
    }
  } catch (err) {
    const allText = [err?.shortMessage, err?.message, err?.details,
      err?.cause?.message, err?.cause?.details]
      .filter(Boolean).join(" ").toLowerCase()

    // Extract structured bundler error info (AA codes, revert data)
    const bundlerInfo = extractBundlerErrorInfo(err)

    // Log full error details for diagnostics — UNTRUNCATED to capture full revert reasons
    // Walk the entire cause chain to extract deeply nested bundler error info
    const errChain = []
    let errWalk = err
    for (let depth = 0; errWalk && depth < 5; depth++) {
      errChain.push({
        depth,
        name: errWalk?.name,
        shortMessage: errWalk?.shortMessage,
        message: errWalk?.message?.slice(0, 5000),
        details: errWalk?.details?.slice(0, 5000),
        code: errWalk?.code,
        metaMessages: errWalk?.metaMessages,
      })
      errWalk = errWalk?.cause
    }
    console.error(JSON.stringify({
      level: "error", action: "primary_mode_failed_detail",
      smartAccountAddress,
      mode: useEnableModeFirst ? "enable" : "regular",
      shortMessage: err?.shortMessage?.slice(0, 5000),
      details: err?.details?.slice(0, 5000),
      causeMessage: err?.cause?.message?.slice(0, 5000),
      causeDetails: err?.cause?.details?.slice(0, 5000),
      deepCause: err?.cause?.cause?.message?.slice(0, 3000),
      deepCauseDetails: err?.cause?.cause?.details?.slice(0, 3000),
      errorChain: errChain,
      bundlerInfo,
      timestamp: new Date().toISOString(),
    }))

    // ── Retry 0: try the opposite mode ──────────────────────────
    // If we started with enable mode and it failed (e.g. permission
    // was ALREADY registered → duplicate/invalidnonce), retry with
    // regular mode. If we started with regular mode and it failed
    // (permission not on-chain), retry with enable mode.
    //
    // Also check bundlerInfo.decodedKernelError for decoded error names
    // that don't appear in the text (e.g. EnableNotApproved from 0xc48cf8ee).
    const decodedError = bundlerInfo?.decodedKernelError?.toLowerCase() || ""
    const isPermissionRelated = (
      allText.includes("aa24") ||
      allText.includes("signature error") ||
      allText.includes("enablenotapproved") ||
      decodedError === "enablenotapproved" ||
      allText.includes("duplicate permissionhash") ||
      allText.includes("invalidnonce") ||
      decodedError === "invalidnonce" ||
      (allText.includes("useroperation reverted") && allText.includes("simulation"))
    )

    if (isPermissionRelated) {
      const retryForceRegular = useEnableModeFirst // flip the mode
      console.log(JSON.stringify({
        level: "warn", action: "permission_mode_retry",
        smartAccountAddress,
        primaryMode: useEnableModeFirst ? "enable" : "regular",
        retryMode: retryForceRegular ? "regular" : "enable",
        detail: useEnableModeFirst
          ? "Enable mode failed (permission may already be on-chain). Retrying with regular mode."
          : "Regular mode failed (permission may not be on-chain). Retrying with enable mode.",
        originalError: err?.shortMessage?.slice(0, 500),
        timestamp: new Date().toISOString(),
      }))
      try {
        const { client: retryClient } = await getKernelClient(
          serializedPermission,
          sessionPrivateKey || "",
          { withPaymaster: true, forceRegularMode: retryForceRegular },
        )
        const retryTxHash = await retryClient.sendTransaction({ calls })
        console.log(JSON.stringify({
          level: "info", action: "permission_mode_retry_succeeded",
          smartAccountAddress, txHash: retryTxHash,
          retryMode: retryForceRegular ? "regular" : "enable",
          timestamp: new Date().toISOString(),
        }))
        return { txHash: retryTxHash, explorerUrl: `${EXPLORER_BASE}/tx/${retryTxHash}` }
      } catch (retryErr) {
        // Both modes failed — log comprehensive details for debugging
        const retryText = [retryErr?.shortMessage, retryErr?.message,
          retryErr?.details, retryErr?.cause?.message, retryErr?.cause?.details]
          .filter(Boolean).join(" ").toLowerCase()
        const hasDuplicateHash = retryText.includes("duplicate permissionhash")
        const hasInvalidNonce = retryText.includes("invalidnonce")

        // Extract structured bundler error info for retry error
        const retryBundlerInfo = extractBundlerErrorInfo(retryErr)

        // Check for EnableNotApproved in BOTH text search AND decoded kernel errors
        const hasEnableNotApproved = retryText.includes("enablenotapproved")
          || bundlerInfo?.decodedKernelError === "EnableNotApproved"
          || retryBundlerInfo?.decodedKernelError === "EnableNotApproved"

        // Walk the retry error chain for full diagnostics
        const retryErrChain = []
        let retryErrWalk = retryErr
        for (let depth = 0; retryErrWalk && depth < 5; depth++) {
          retryErrChain.push({
            depth,
            name: retryErrWalk?.name,
            shortMessage: retryErrWalk?.shortMessage,
            message: retryErrWalk?.message?.slice(0, 5000),
            details: retryErrWalk?.details?.slice(0, 5000),
            code: retryErrWalk?.code,
            metaMessages: retryErrWalk?.metaMessages,
          })
          retryErrWalk = retryErrWalk?.cause
        }

        console.error(JSON.stringify({
          level: "error", action: "both_modes_failed",
          smartAccountAddress,
          primaryMode: useEnableModeFirst ? "enable" : "regular",
          primaryError: err?.shortMessage?.slice(0, 3000),
          primaryDetails: err?.details?.slice(0, 3000),
          primaryCauseMsg: err?.cause?.message?.slice(0, 3000),
          primaryDeepCause: err?.cause?.cause?.message?.slice(0, 2000),
          primaryBundlerInfo: bundlerInfo,
          retryMode: retryForceRegular ? "regular" : "enable",
          retryError: retryErr?.shortMessage?.slice(0, 3000),
          retryDetails: retryErr?.details?.slice(0, 3000),
          retryCauseMessage: retryErr?.cause?.message?.slice(0, 3000),
          retryCauseDetails: retryErr?.cause?.details?.slice(0, 3000),
          retryDeepCause: retryErr?.cause?.cause?.message?.slice(0, 2000),
          retryBundlerInfo,
          retryErrorChain: retryErrChain,
          hasDuplicateHash,
          hasInvalidNonce,
          hasEnableNotApproved,
          blobHasEnableSig,
          blobEnableSigLength,
          timestamp: new Date().toISOString(),
        }))

        // Determine the most useful error message
        // Check if PRIMARY failed with duplicate permissionHash or AA23
        const primaryText = [err?.shortMessage, err?.message,
          err?.details, err?.cause?.message, err?.cause?.details]
          .filter(Boolean).join(" ").toLowerCase()
        const primaryHasDuplicateHash = primaryText.includes("duplicate permissionhash")
        const primaryHasAA23 = primaryText.includes("aa23")
        const retryHasAA23 = retryText.includes("aa23")

        if (hasEnableNotApproved) {
          throw new Error(
            "EnableNotApproved: The enable signature in the serialized permission blob is " +
            "invalid or was signed by a different key than the on-chain ECDSA validator owner. " +
            "The user must re-grant the session key from the dashboard. " +
            `Enable error: ${retryErr?.shortMessage || retryErr?.message || "unknown"}`
          )
        }
        // ── Permission hash conflict detection ──
        // "duplicate permissionHash" = the Kernel smart contract already has
        // a permission with the same policy hash installed on-chain.
        // This can happen two ways:
        //   A. SAME session key: a previous enable-mode UserOp mined successfully
        //      (installed the permission) but the inner DeFi calls reverted.
        //      Fix: use regular mode (the nonce pre-check should have caught this,
        //      but if it didn't, this is a safety net).
        //   B. DIFFERENT session key: the user re-granted, producing a new
        //      permissionId but the same permissionHash (policies unchanged).
        //      Fix: the backend should recover the ORIGINAL session key whose
        //      permission IS installed on-chain and use it in regular mode.
        //
        // In NEITHER case should we throw "DEADLOCK" (which deactivates the
        // session key). Deactivation forces re-grant → new key with same hash
        // collision → infinite loop. Instead, throw PERMISSION_RECOVERY_NEEDED
        // so the backend can try to recover the working session key.
        const hasDuplicateHashConflict =
          (primaryHasDuplicateHash && retryHasAA23) ||
          (hasDuplicateHash && primaryHasAA23)
        if (hasDuplicateHashConflict) {
          const regularErr = retryForceRegular
            ? (retryErr?.shortMessage || retryErr?.message)
            : (err?.shortMessage || err?.message)
          throw new Error(
            "PERMISSION_RECOVERY_NEEDED: Permission policies are already installed on-chain " +
            "(enable mode: duplicate permissionHash) but the current session key's permissionId " +
            "is not the one installed (regular mode: AA23). This happens when a user re-grants " +
            "their session key — the new key has a different permissionId but the same policy hash. " +
            "The frontend MUST include a unique gasNonce in the gas policy so each grant produces " +
            "a distinct permissionHash. If the frontend already has gasNonce, ensure it is deployed " +
            "to production (merge dev→main for Vercel). After deploying, user must re-grant. " +
            "DO NOT deactivate the session key — that would force another re-grant and repeat the cycle. " +
            `Regular error: ${regularErr || "unknown"}`
          )
        }
        if (hasDuplicateHash && !retryForceRegular) {
          // Enable retry got duplicate → permission IS registered, but regular mode also failed
          // AND primary was NOT AA23 (that's the deadlock case above)
          // This means the inner calls (withdrawals/deposits) are reverting
          throw new Error(
            "Permission is registered on-chain (enable retry got 'duplicate permissionHash') " +
            "but regular mode also failed. The inner calls (withdrawals/deposits) are reverting. " +
            `Regular error: ${err?.shortMessage || err?.message || "unknown"}`
          )
        }
        if (hasInvalidNonce && !hasDuplicateHash) {
          throw new Error(
            "Enable signature nonce mismatch: the serialized blob was signed with a different " +
            "nonce than the on-chain currentNonce. The user must re-grant the session key. " +
            `Error: ${retryErr?.shortMessage || retryErr?.message || "unknown"}`
          )
        }

        // ── Retry 2: both modes failed — try WITHOUT paymaster ──────────
        // The paymaster can cause "UserOperation reverted during simulation"
        // if its validatePaymasterUserOp reverts. This masks the real error.
        // If the primary was enable mode and failed (no duplicate hash), try
        // enable mode again without paymaster to get the raw contract revert.
        // If primary had duplicate hash → permission is on-chain → use regular.
        const noPaymasterForceRegular = primaryHasDuplicateHash || !useEnableModeFirst
        console.log(JSON.stringify({
          level: "warn", action: "both_modes_failed_trying_no_paymaster",
          smartAccountAddress,
          mode: noPaymasterForceRegular ? "regular" : "enable",
          timestamp: new Date().toISOString(),
        }))
        try {
          const { client: noPaymasterClient } = await getKernelClient(
            serializedPermission,
            sessionPrivateKey || "",
            { withPaymaster: false, forceRegularMode: noPaymasterForceRegular },
          )
          const noPaymasterTxHash = await noPaymasterClient.sendTransaction({ calls })
          console.log(JSON.stringify({
            level: "info", action: "no_paymaster_retry_succeeded",
            smartAccountAddress, txHash: noPaymasterTxHash,
            timestamp: new Date().toISOString(),
          }))
          return { txHash: noPaymasterTxHash, explorerUrl: `${EXPLORER_BASE}/tx/${noPaymasterTxHash}` }
        } catch (noPaymasterErr) {
          const noPaymasterBundlerInfo = extractBundlerErrorInfo(noPaymasterErr)
          console.error(JSON.stringify({
            level: "error", action: "no_paymaster_retry_also_failed",
            smartAccountAddress,
            error: noPaymasterErr?.shortMessage?.slice(0, 3000),
            details: noPaymasterErr?.details?.slice(0, 3000),
            causeMessage: noPaymasterErr?.cause?.message?.slice(0, 3000),
            bundlerInfo: noPaymasterBundlerInfo,
            timestamp: new Date().toISOString(),
          }))
        }

        throw new Error(
          `Both enable and regular modes failed. ` +
          `Primary (${useEnableModeFirst ? "enable" : "regular"}): ${err?.shortMessage || err?.message || "unknown"} | ` +
          `Retry (${retryForceRegular ? "regular" : "enable"}): ${retryErr?.shortMessage || retryErr?.message || "unknown"}`
        )
      }
    }
    // Retry 1: explicit paymaster error — try without paymaster
    if (isLikelyPaymasterError(err)) {
      console.log(JSON.stringify({
        level: "warn", action: "paymaster_error_retry",
        smartAccountAddress, error: err?.shortMessage?.slice(0, 200),
        timestamp: new Date().toISOString(),
      }))
      try {
        const { client: noPaymasterClient } = await getKernelClient(serializedPermission, sessionPrivateKey || "", { withPaymaster: false })
        const txHash = await noPaymasterClient.sendTransaction({ calls })
        return { txHash, explorerUrl: `${EXPLORER_BASE}/tx/${txHash}` }
      } catch (paymasterRetryErr) {
        throw new Error(
          formatExecutionError(err)
          + ` [paymaster retry also failed: ${paymasterRetryErr?.shortMessage || paymasterRetryErr?.message || "unknown"}]`
        )
      }
    }
    // Retry 2: validateUserOp revert — may be caused by paymaster gas
    // estimation issues. Try once without paymaster to rule it out.
    if (isValidateUserOpRevert(err)) {
      console.log(JSON.stringify({
        level: "warn", action: "validateUserOp_revert_retry",
        smartAccountAddress, error: err?.shortMessage?.slice(0, 200),
        timestamp: new Date().toISOString(),
      }))
      try {
        const { client: noPaymasterClient } = await getKernelClient(serializedPermission, sessionPrivateKey || "", { withPaymaster: false })
        const txHash = await noPaymasterClient.sendTransaction({ calls })
        return { txHash, explorerUrl: `${EXPLORER_BASE}/tx/${txHash}` }
      } catch (retryErr) {
        // Both attempts failed — throw the ORIGINAL error with more context
        throw new Error(
          formatExecutionError(err)
          + ` [retry without paymaster also failed: ${retryErr?.shortMessage || retryErr?.message || "unknown"}]`
        )
      }
    }
    // ── Full error dump for any unhandled rebalance failure ──
    console.log(JSON.stringify({
      level: "error",
      action: "rebalance_failed_full_dump",
      smartAccountAddress,
      permissionAccountAddress,
      errorName: err?.name,
      errorMessage: err?.message?.slice(0, 500),
      shortMessage: err?.shortMessage?.slice(0, 500),
      details: err?.details?.slice(0, 500),
      causeMessage: err?.cause?.message?.slice(0, 500),
      causeDetails: err?.cause?.details?.slice(0, 500),
      metaMessages: err?.metaMessages,
      // Walk the cause chain for nested errors
      causeCauseMessage: err?.cause?.cause?.message?.slice(0, 300),
      causeCauseDetails: err?.cause?.cause?.details?.slice(0, 300),
      timestamp: new Date().toISOString(),
    }))
    throw new Error(formatExecutionError(err))
  }
}

export async function executeWithdrawal({
  serializedPermission,
  sessionPrivateKey,
  smartAccountAddress,
  ownerAddress,
  agentFeeAmount,
  isFullWithdrawal,
  contracts,
  balances,
  withdrawAmount,
}) {
  if (!ZERODEV_ID) {
    throw new Error("ZERODEV_PROJECT_ID is missing in execution service environment")
  }

  // Use same smart mode selection as executeRebalance
  let blobHasEnableSigWd = false
  try {
    const decoded = JSON.parse(Buffer.from(serializedPermission, "base64").toString("utf-8"))
    blobHasEnableSigWd = !!decoded.enableSignature && decoded.enableSignature.length > 2
  } catch { /* ignore */ }

  const wdUseEnableFirst = blobHasEnableSigWd
  const { client: kernelClient, publicClient: wdPublicClient, permissionAccountAddress, permissionAccount } = await getKernelClient(
    serializedPermission,
    sessionPrivateKey || "",
    { withPaymaster: true, forceRegularMode: !wdUseEnableFirst },
  )

  if (permissionAccountAddress.toLowerCase() !== smartAccountAddress.toLowerCase()) {
    throw new Error(
      `Session key/account mismatch: permissionAccount=${permissionAccountAddress} sender=${smartAccountAddress}`,
    )
  }

  // Use ownerAddress from backend (trusted, from accounts table) if provided.
  // Fall back to on-chain resolution only as a last resort.
  let onchainOwner = ownerAddress || null
  if (!onchainOwner) {
    onchainOwner = await resolveKernelOwner(permissionAccount)
  }
  const calls = []

  // Aave: only withdraw if user has aTokens (withdraw(maxUint256) reverts with 0 balance)
  const aaveATokenBalance = BigInt(balances?.aaveATokenBalance || "0")
  if (aaveATokenBalance > 0n) {
    calls.push({
      to: contracts.AAVE_POOL,
      value: 0n,
      data: encodeFunctionData({
        abi: AAVE_ABI,
        functionName: "withdraw",
        args: [contracts.USDC, maxUint256, smartAccountAddress],
      }),
    })
  }

  const benqiQiTokenBalance = BigInt(balances?.benqiQiTokenBalance || "0")
  if (benqiQiTokenBalance > 0n) {
    calls.push({
      to: contracts.BENQI_POOL,
      value: 0n,
      data: encodeFunctionData({
        abi: BENQI_ABI,
        functionName: "redeem",
        args: [benqiQiTokenBalance],
      }),
    })
  }

  const sparkShareBalance = BigInt(balances?.sparkShareBalance || "0")
  if (
    contracts.SPARK_VAULT &&
    contracts.SPARK_VAULT !== "0x0000000000000000000000000000000000000000" &&
    sparkShareBalance > 0n
  ) {
    calls.push({
      to: contracts.SPARK_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_ABI,
        functionName: "redeem",
        args: [sparkShareBalance, smartAccountAddress, smartAccountAddress],
      }),
    })
  }

  const eulerShareBalance = BigInt(balances?.eulerShareBalance || "0")
  if (
    contracts.EULER_VAULT &&
    contracts.EULER_VAULT !== "0x0000000000000000000000000000000000000000" &&
    eulerShareBalance > 0n
  ) {
    calls.push({
      to: contracts.EULER_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_ABI,
        functionName: "redeem",
        args: [eulerShareBalance, smartAccountAddress, smartAccountAddress],
      }),
    })
  }

  const siloSavusdShareBalance = BigInt(balances?.siloSavusdShareBalance || "0")
  if (
    contracts.SILO_SAVUSD_VAULT &&
    contracts.SILO_SAVUSD_VAULT !== "0x0000000000000000000000000000000000000000" &&
    siloSavusdShareBalance > 0n
  ) {
    calls.push({
      to: contracts.SILO_SAVUSD_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_ABI,
        functionName: "redeem",
        args: [siloSavusdShareBalance, smartAccountAddress, smartAccountAddress],
      }),
    })
  }

  const siloSusdpShareBalance = BigInt(balances?.siloSusdpShareBalance || "0")
  if (
    contracts.SILO_SUSDP_VAULT &&
    contracts.SILO_SUSDP_VAULT !== "0x0000000000000000000000000000000000000000" &&
    siloSusdpShareBalance > 0n
  ) {
    calls.push({
      to: contracts.SILO_SUSDP_VAULT,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC4626_ABI,
        functionName: "redeem",
        args: [siloSusdpShareBalance, smartAccountAddress, smartAccountAddress],
      }),
    })
  }

  const feeAmountRaw = BigInt(agentFeeAmount || "0")
  if (feeAmountRaw > 0n) {
    if (!contracts.TREASURY || contracts.TREASURY === "0x0000000000000000000000000000000000000000") {
      throw new Error("Treasury address is required when agentFeeAmount > 0")
    }
    calls.push({
      to: contracts.USDC,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [contracts.TREASURY, feeAmountRaw],
      }),
    })
  }

  // Backend sends net-of-fee amount (withdrawAmount = requestedAmount - agentFee).
  const transferAmount = BigInt(withdrawAmount || "0")
  if (transferAmount <= 0n) {
    throw new Error("withdrawAmount must be > 0")
  }

  calls.push({
    to: contracts.USDC,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [onchainOwner, transferAmount],
    }),
  })

  try {
    const txHash = await kernelClient.sendTransaction({ calls })
    return {
      txHash,
      explorerUrl: `${EXPLORER_BASE}/tx/${txHash}`,
      owner: onchainOwner,
      callCount: calls.length,
    }
  } catch (err) {
    const allText = [err?.shortMessage, err?.message, err?.details,
      err?.cause?.message, err?.cause?.details]
      .filter(Boolean).join(" ").toLowerCase()

    const wdBundlerInfo = extractBundlerErrorInfo(err)
    console.error(JSON.stringify({
      level: "error", action: "withdrawal_primary_failed_detail",
      smartAccountAddress,
      mode: wdUseEnableFirst ? "enable" : "regular",
      shortMessage: err?.shortMessage?.slice(0, 5000),
      details: err?.details?.slice(0, 5000),
      causeMessage: err?.cause?.message?.slice(0, 5000),
      bundlerInfo: wdBundlerInfo,
      timestamp: new Date().toISOString(),
    }))

    // ── Retry 0: try the opposite mode ──────────────────────────
    const isPermissionRelatedWd = (
      allText.includes("aa24") ||
      allText.includes("signature error") ||
      allText.includes("enablenotapproved") ||
      allText.includes("duplicate permissionhash") ||
      allText.includes("invalidnonce") ||
      (allText.includes("useroperation reverted") && allText.includes("simulation"))
    )
    if (isPermissionRelatedWd) {
      const wdRetryForceRegular = wdUseEnableFirst // flip the mode
      console.log(JSON.stringify({
        level: "warn", action: "withdrawal_permission_mode_retry",
        smartAccountAddress,
        primaryMode: wdUseEnableFirst ? "enable" : "regular",
        retryMode: wdRetryForceRegular ? "regular" : "enable",
        originalError: err?.shortMessage?.slice(0, 500),
        timestamp: new Date().toISOString(),
      }))
      try {
        const { client: retryClient } = await getKernelClient(
          serializedPermission,
          sessionPrivateKey || "",
          { withPaymaster: true, forceRegularMode: wdRetryForceRegular },
        )
        const retryTxHash = await retryClient.sendTransaction({ calls })
        return {
          txHash: retryTxHash,
          explorerUrl: `${EXPLORER_BASE}/tx/${retryTxHash}`,
          owner: onchainOwner,
          callCount: calls.length,
        }
      } catch (retryErr) {
        const retryText = [retryErr?.shortMessage, retryErr?.message,
          retryErr?.details, retryErr?.cause?.message, retryErr?.cause?.details]
          .filter(Boolean).join(" ").toLowerCase()
        const retryBundlerInfoWd = extractBundlerErrorInfo(retryErr)
        const hasEnableNotApprovedWd = retryText.includes("enablenotapproved")
          || retryBundlerInfoWd?.decodedKernelError === "EnableNotApproved"
        if (hasEnableNotApprovedWd) {
          throw new Error(
            "EnableNotApproved: enable signature invalid. User must re-grant session key. " +
            `Error: ${retryErr?.shortMessage || retryErr?.message || "unknown"}`
          )
        }
        throw new Error(
          `Both modes failed for withdrawal. ` +
          `Primary (${wdUseEnableFirst ? "enable" : "regular"}): ${err?.shortMessage || "unknown"} | ` +
          `Retry (${wdRetryForceRegular ? "regular" : "enable"}): ${retryErr?.shortMessage || "unknown"}`
        )
      }
    }
    if (isLikelyPaymasterError(err)) {
      try {
        const { client: noPaymasterClient } = await getKernelClient(serializedPermission, sessionPrivateKey || "", { withPaymaster: false })
        const txHash = await noPaymasterClient.sendTransaction({ calls })
        return {
          txHash,
          explorerUrl: `${EXPLORER_BASE}/tx/${txHash}`,
          owner: onchainOwner,
          callCount: calls.length,
        }
      } catch (paymasterRetryErr) {
        throw new Error(
          formatExecutionError(err)
          + ` [paymaster retry also failed: ${paymasterRetryErr?.shortMessage || paymasterRetryErr?.message || "unknown"}]`
        )
      }
    }
    if (isValidateUserOpRevert(err)) {
      try {
        const { client: noPaymasterClient } = await getKernelClient(serializedPermission, sessionPrivateKey || "", { withPaymaster: false })
        const txHash = await noPaymasterClient.sendTransaction({ calls })
        return {
          txHash,
          explorerUrl: `${EXPLORER_BASE}/tx/${txHash}`,
          owner: onchainOwner,
          callCount: calls.length,
        }
      } catch (retryErr) {
        throw new Error(
          formatExecutionError(err)
          + ` [retry without paymaster also failed: ${retryErr?.shortMessage || retryErr?.message || "unknown"}]`
        )
      }
    }
    throw new Error(formatExecutionError(err))
  }
}

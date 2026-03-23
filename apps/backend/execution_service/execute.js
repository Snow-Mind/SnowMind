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
  http,
  encodeFunctionData,
  maxUint256,
  parseUnits,
} from "viem"
import { avalanche } from "viem/chains"
import { privateKeyToAccount } from "viem/accounts"

const CHAIN_ID = 43114
const CHAIN = avalanche
const ENTRYPOINT = getEntryPoint("0.7")
const ZERODEV_ID = process.env.ZERODEV_PROJECT_ID

// ZeroDev SDK calls proprietary RPC methods (zd_getUserOperationGasPrice, etc.)
// that ONLY work with ZeroDev's bundler. Never point these at Pimlico/Alchemy.
const ZERODEV_RPC = `https://rpc.zerodev.app/api/v3/${ZERODEV_ID}/chain/${CHAIN.id}`
const BUNDLER_URL = ZERODEV_RPC
const PAYMASTER_URL = ZERODEV_RPC

// Server-side Node.js doesn't send an Origin header automatically.
// ZeroDev's domain allowlist needs it to verify the request source.
const ZERODEV_FETCH_OPTIONS = {
  headers: { Origin: "https://www.snowmind.xyz" },
}

const EXPLORER_BASE = "https://snowtrace.io"

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
]

const ERC20_ABI = [
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

const REGISTRY_ABI = [
  {
    name: "logRebalance",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fromProtocol", type: "address" },
      { name: "toProtocol", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
]

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

async function getKernelClient(serializedPermission, sessionPrivateKey, options = { withPaymaster: true }) {
  const publicClient = createPublicClient({
    chain: CHAIN,
    transport: http(process.env.AVALANCHE_RPC_URL),
  })

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

  const permissionAccount = await deserializePermissionAccount(
    publicClient,
    ENTRYPOINT,
    KERNEL_V3_1,
    serializedPermission,
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

  const clientConfig = {
    // SDK 5.4.x migration: client is required for on-chain reads during
    // UserOp construction (enable mode state checks, gas estimation, etc.)
    client: publicClient,
    account: permissionAccount,
    chain: CHAIN,
    bundlerTransport: http(BUNDLER_URL, { fetchOptions: ZERODEV_FETCH_OPTIONS }),
  }

  // Permission accounts use the { getPaymasterData } wrapper pattern.
  // This matches the official ZeroDev transaction-automation example.
  // The wrapper ensures the SDK calls getPaymasterData at the right phase.
  if (options.withPaymaster) {
    const paymasterClient = createZeroDevPaymasterClient({
      chain: CHAIN,
      transport: http(PAYMASTER_URL, { fetchOptions: ZERODEV_FETCH_OPTIONS }),
    })
    clientConfig.paymaster = {
      getPaymasterData(userOperation) {
        return paymasterClient.sponsorUserOperation({ userOperation })
      },
    }
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

  const { client: kernelClient, publicClient: execPublicClient, permissionAccountAddress, permissionAccount } = await getKernelClient(
    serializedPermission,
    sessionPrivateKey || "",
    { withPaymaster: true },
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
      calls.push(buildErc4626Withdrawal(contracts.SPARK_VAULT, amountUSDC, shareBalance, smartAccountAddress))
    } else if (protocol === "euler_v2" && contracts.EULER_VAULT) {
      calls.push(buildErc4626Withdrawal(contracts.EULER_VAULT, amountUSDC, shareBalance, smartAccountAddress))
    } else if (protocol === "silo_savusd_usdc" && contracts.SILO_SAVUSD_VAULT) {
      calls.push(buildErc4626Withdrawal(contracts.SILO_SAVUSD_VAULT, amountUSDC, shareBalance, smartAccountAddress))
    } else if (protocol === "silo_susdp_usdc" && contracts.SILO_SUSDP_VAULT) {
      calls.push(buildErc4626Withdrawal(contracts.SILO_SUSDP_VAULT, amountUSDC, shareBalance, smartAccountAddress))
    }
  }

  if (feeTransfer && feeTransfer.to && feeTransfer.amountUSDC > 0) {
    calls.push({
      to: contracts.USDC,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [feeTransfer.to, parseUnits(String(feeTransfer.amountUSDC), 6)],
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

  // Log each withdrawal once. If there are deposits, pair with the first
  // deposit target so the registry records the flow direction. Previous code
  // used a nested loop that created N×M false entries.
  // GUARD: Skip logRebalance when REGISTRY is empty/not deployed — the session
  // key call policy may not include Registry permissions. Rebalance must not
  // fail due to an optional audit log call.
  const registryValid = contracts.REGISTRY && contracts.REGISTRY.length >= 42
    && contracts.REGISTRY !== "0x0000000000000000000000000000000000000000"
  if (registryValid) {
    const firstDepositAddr = deposits.length > 0
      ? resolveContractKey(deposits[0].protocol, contracts)
      : null
    for (const w of withdrawals) {
      const from = resolveContractKey(w.protocol, contracts)
      const to = firstDepositAddr || from  // fallback to self if no deposits
      if (from && to) {
        calls.push({
          to: contracts.REGISTRY,
          value: 0n,
          data: encodeFunctionData({
            abi: REGISTRY_ABI,
            functionName: "logRebalance",
            args: [from, to, parseUnits(String(w.amountUSDC), 6)],
          }),
        })
      }
    }
  }

  // Approve exact amounts per protocol — never use infinite approvals.
  // Aggregate deposits per protocol, then approve-to-zero + approve exact sum.
  const depositAmountsPerProtocol = new Map()
  for (const { protocol, amountUSDC } of deposits) {
    const prev = depositAmountsPerProtocol.get(protocol) || 0n
    depositAmountsPerProtocol.set(protocol, prev + parseUnits(String(amountUSDC), 6))
  }
  for (const [protocol, totalAmount] of depositAmountsPerProtocol) {
    const spender = resolveContractKey(protocol, contracts)
    if (spender) {
      // ERC-20 approve race-condition protection: set to 0 first, then exact amount
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

  for (const { protocol, amountUSDC } of deposits) {
    const amount = parseUnits(String(amountUSDC), 6)
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

  if (!calls.length) {
    throw new Error("No executable calls generated for rebalance")
  }

  // Log the call targets for debugging session key / policy mismatches
  console.log(JSON.stringify({
    level: "info",
    action: "rebalance_calls_built",
    smartAccountAddress,
    permissionAccountAddress,
    callCount: calls.length,
    callTargets: calls.map((c) => c.to),
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

  // ── Deep enable-signature debugging ──
  // Capture the plugin manager state right before UserOp submission.
  // This logs whether the SDK thinks the plugin is already enabled,
  // the enable signature details, and the validator configuration.
  try {
    const kpm = permissionAccount.kernelPluginManager
    const regularValidator = kpm?.regularValidator
    const sudoValidator = kpm?.sudoValidator
    const action = typeof kpm?.getAction === "function" ? kpm.getAction() : null
    const validityData = typeof kpm?.getValidityData === "function" ? kpm.getValidityData() : null

    // Check if the plugin is already enabled on-chain
    let pluginEnabledOnChain = "unknown"
    if (typeof kpm?.isPluginEnabled === "function" && action?.selector) {
      try {
        pluginEnabledOnChain = await kpm.isPluginEnabled(smartAccountAddress, action.selector)
      } catch (e) { pluginEnabledOnChain = `error: ${e?.message?.slice(0, 100)}` }
    }

    // Get the enable signature if available
    let enableSigLength = 0
    let enableSigPrefix = ""
    if (typeof kpm?.getPluginEnableSignature === "function") {
      try {
        const sig = await kpm.getPluginEnableSignature(smartAccountAddress)
        enableSigLength = sig?.length ?? 0
        enableSigPrefix = sig ? sig.slice(0, 20) + "..." : "null"
      } catch (e) { enableSigPrefix = `error: ${e?.message?.slice(0, 100)}` }
    }

    // Get enable typed data (the hash the owner must sign)
    let enableTypedDataHash = "unavailable"
    if (typeof kpm?.getPluginsEnableTypedData === "function") {
      try {
        const td = await kpm.getPluginsEnableTypedData(smartAccountAddress)
        enableTypedDataHash = JSON.stringify({
          domain: td?.domain,
          primaryType: td?.primaryType,
          // Only log field names and types, not values (too large)
          messageFields: td?.message ? Object.keys(td.message) : [],
        })
      } catch (e) { enableTypedDataHash = `error: ${e?.message?.slice(0, 200)}` }
    }

    console.log(JSON.stringify({
      level: "info",
      action: "enable_signature_debug",
      smartAccountAddress,
      pluginEnabledOnChain,
      activeValidatorMode: kpm?.activeValidatorMode ?? "unknown",
      regularValidatorAddress: regularValidator?.address ?? "null",
      regularValidatorType: regularValidator?.validatorType ?? "null",
      sudoValidatorAddress: sudoValidator?.address ?? "null",
      actionSelector: action?.selector ?? "null",
      actionAddress: action?.address ?? "null",
      validityData: validityData ? { validAfter: Number(validityData.validAfter), validUntil: Number(validityData.validUntil) } : null,
      enableSigLength,
      enableSigPrefix,
      enableTypedDataHash,
      timestamp: new Date().toISOString(),
    }))
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
    return { txHash, explorerUrl: `${EXPLORER_BASE}/tx/${txHash}` }
  } catch (err) {
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

  const { client: kernelClient, publicClient: wdPublicClient, permissionAccountAddress, permissionAccount } = await getKernelClient(
    serializedPermission,
    sessionPrivateKey || "",
    { withPaymaster: true },
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

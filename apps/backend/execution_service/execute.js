import { deserializePermissionAccount } from "@zerodev/permissions"
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

const CHAIN_ID      = 43114
const CHAIN         = avalanche
const ENTRYPOINT    = getEntryPoint("0.7")
const ZERODEV_ID    = process.env.ZERODEV_PROJECT_ID
const BUNDLER_URL   = `https://rpc.zerodev.app/api/v3/${ZERODEV_ID}/chain/${CHAIN.id}`
const PAYMASTER_URL = `https://rpc.zerodev.app/api/v3/${ZERODEV_ID}/chain/${CHAIN.id}`

const EXPLORER_BASE = 'https://snowtrace.io'

const AAVE_ABI = [
  { name: "supply",   type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "asset",        type: "address" },
      { name: "amount",       type: "uint256" },
      { name: "onBehalfOf",   type: "address" },
      { name: "referralCode", type: "uint16"  },
    ], outputs: [] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "asset",  type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to",     type: "address" },
    ], outputs: [{ name: "", type: "uint256" }] },
]

const BENQI_ABI = [
  { name: "mint",   type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "mintAmount",   type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "redeem", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "redeemTokens", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }] },
]

// ERC-4626 vault ABI — used by Spark and Euler vaults
const ERC4626_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "assets",   type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "assets",   type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner",    type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }] },
  { name: "redeem",  type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "shares",   type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner",    type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
]

// ERC-20 ABI — shared by USDC approve/transfer across all protocols
const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }] },
]

const REGISTRY_ABI = [
  { name: "logRebalance", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "fromProtocol", type: "address" },
      { name: "toProtocol",   type: "address" },
      { name: "amount",       type: "uint256" },
    ], outputs: [] },
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

  return (
    text.includes("paymaster") ||
    text.includes("sponsoruseroperation") ||
    text.includes("pm_")
  )
}

async function getKernelClient(serializedPermission, options = { withPaymaster: true }) {
  const publicClient = createPublicClient({
    chain: CHAIN,
    transport: http(process.env.AVALANCHE_RPC_URL),
  })
  const paymasterClient = options.withPaymaster
    ? createZeroDevPaymasterClient({
        chain: CHAIN,
        transport: http(PAYMASTER_URL),
      })
    : null

  // Kernel doc: "deserializePermissionAccount reconstructs full kernel client"
  const permissionAccount = await deserializePermissionAccount(
    publicClient,
    ENTRYPOINT,
    KERNEL_V3_1,
    serializedPermission,
  )

  const clientConfig = {
    account: permissionAccount,
    chain: CHAIN,
    bundlerTransport: http(BUNDLER_URL),
  }

  if (paymasterClient) {
    clientConfig.paymaster = {
      getPaymasterData(userOperation) {
        return paymasterClient.sponsorUserOperation({ userOperation })
      },
    }
  }

  const client = createKernelAccountClient(clientConfig)

  return {
    client,
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
        abi: ERC4626_ABI, functionName: "redeem",
        args: [BigInt(shareBalance), smartAccountAddress, smartAccountAddress],
      }),
    }
  }
  // Known USDC amount → use withdraw(assets) which accepts the USDC amount directly
  return {
    to: vaultAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC4626_ABI, functionName: "withdraw",
      args: [parseUnits(String(amountUSDC), 6), smartAccountAddress, smartAccountAddress],
    }),
  }
}

function resolveContractKey(protocol, contracts) {
  const map = {
    aave_v3:  "AAVE_POOL",
    aave:     "AAVE_POOL",
    benqi:    "BENQI_POOL",
    spark:    "SPARK_VAULT",
    euler_v2: "EULER_VAULT",
    silo_savusd_usdc: "SILO_SAVUSD_VAULT",
    silo_susdp_usdc:  "SILO_SUSDP_VAULT",
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
  smartAccountAddress,
  withdrawals,   // [{ protocol: "benqi", amountUSDC: 3000, qiTokenAmount: "12345678" }]
  deposits,      // [{ protocol: "aave_v3", amountUSDC: 3000 }]
  contracts,     // { AAVE_POOL, BENQI_POOL, SPARK_VAULT, USDC, REGISTRY }
  feeTransfer,   // optional: { to: "0xTreasury", amountUSDC: 50 }
  userTransfer,  // optional: { to: "0xUserEOA", amountUSDC: 9950 }
}) {
  if (!ZERODEV_ID) {
    throw new Error("ZERODEV_PROJECT_ID is missing in execution service environment")
  }

  const {
    client: kernelClient,
    permissionAccountAddress,
    permissionAccount,
  } = await getKernelClient(serializedPermission, { withPaymaster: true })

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

  // ── WITHDRAWALS FIRST — ensure funds available before deposits ─────────────
  for (const { protocol, amountUSDC, qiTokenAmount, shareBalance } of withdrawals) {
    if (protocol === "aave_v3" || protocol === "aave") {
      calls.push({
        to: contracts.AAVE_POOL,
        value: 0n,
        data: encodeFunctionData({
          abi: AAVE_ABI, functionName: "withdraw",
          args: [
            contracts.USDC,
            amountUSDC === "MAX" ? maxUint256 : parseUnits(String(amountUSDC), 6),
            smartAccountAddress,
          ],
        }),
      })
    } else if (protocol === "benqi") {
      // qiTokenAmount is calculated by Python backend from on-chain exchangeRate
      calls.push({
        to: contracts.BENQI_POOL,
        value: 0n,
        data: encodeFunctionData({
          abi: BENQI_ABI, functionName: "redeem",
          args: [BigInt(qiTokenAmount)],
        }),
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

  // ── FEE TRANSFER — send profit fee to treasury (atomic with withdrawal) ──
  if (feeTransfer && feeTransfer.to && feeTransfer.amountUSDC > 0) {
    calls.push({
      to: contracts.USDC,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI, functionName: "transfer",
        args: [feeTransfer.to, parseUnits(String(feeTransfer.amountUSDC), 6)],
      }),
    })
  }

  // ── USER TRANSFER — send remaining funds to user's EOA (atomic with withdrawal) ──
  if (userTransfer && userTransfer.amountUSDC > 0) {
    if (!onchainOwner) {
      throw new Error("userTransfer requested but owner could not be resolved")
    }
    if (userTransfer.to && userTransfer.to.toLowerCase() !== onchainOwner.toLowerCase()) {
      throw new Error(
        `User transfer destination mismatch: provided=${userTransfer.to} onchainOwner=${onchainOwner}`,
      )
    }
    calls.push({
      to: contracts.USDC,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI, functionName: "transfer",
        args: [onchainOwner, parseUnits(String(userTransfer.amountUSDC), 6)],
      }),
    })
  }

  // ── REGISTRY LOG — log each withdrawal once ────────────────────────
  // Pair each withdrawal with the first deposit target as representative
  // destination. Previous nested loop created N×M false entries.
  // GUARD: Skip logRebalance when REGISTRY is empty/not deployed.
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
            abi: REGISTRY_ABI, functionName: "logRebalance",
            args: [from, to, parseUnits(String(w.amountUSDC), 6)],
          }),
        })
      }
    }
  }

  // ── APPROVE USDC for deposit targets (idempotent — no-op if already set) ──
  const depositTargets = new Set(deposits.map(d => d.protocol))
  for (const protocol of depositTargets) {
    const spender = resolveContractKey(protocol, contracts)
    if (spender) {
      calls.push({
        to: contracts.USDC,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI, functionName: "approve",
          args: [spender, maxUint256],
        }),
      })
    }
  }

  // ── DEPOSITS SECOND ────────────────────────────────────────────────────────
  for (const { protocol, amountUSDC } of deposits) {
    const amount = parseUnits(String(amountUSDC), 6)
    if (protocol === "aave_v3" || protocol === "aave") {
      calls.push({
        to: contracts.AAVE_POOL,
        value: 0n,
        data: encodeFunctionData({
          abi: AAVE_ABI, functionName: "supply",
          args: [contracts.USDC, amount, smartAccountAddress, 0],
        }),
      })
    } else if (protocol === "benqi") {
      calls.push({
        to: contracts.BENQI_POOL,
        value: 0n,
        data: encodeFunctionData({
          abi: BENQI_ABI, functionName: "mint",
          args: [amount],
        }),
      })
    } else if (protocol === "spark" && contracts.SPARK_VAULT) {
      calls.push({
        to: contracts.SPARK_VAULT,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC4626_ABI, functionName: "deposit",
          args: [amount, smartAccountAddress],
        }),
      })
    } else if (protocol === "euler_v2" && contracts.EULER_VAULT) {
      calls.push({
        to: contracts.EULER_VAULT,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC4626_ABI, functionName: "deposit",
          args: [amount, smartAccountAddress],
        }),
      })
    } else if (protocol === "silo_savusd_usdc" && contracts.SILO_SAVUSD_VAULT) {
      calls.push({
        to: contracts.SILO_SAVUSD_VAULT,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC4626_ABI, functionName: "deposit",
          args: [amount, smartAccountAddress],
        }),
      })
    } else if (protocol === "silo_susdp_usdc" && contracts.SILO_SUSDP_VAULT) {
      calls.push({
        to: contracts.SILO_SUSDP_VAULT,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC4626_ABI, functionName: "deposit",
          args: [amount, smartAccountAddress],
        }),
      })
    }
  }

  // Single atomic UserOp — kernel doc: "Batched as a single atomic UserOp"
  if (!calls.length) {
    throw new Error("No executable calls generated for rebalance")
  }

  try {
    const txHash = await kernelClient.sendTransaction({ calls })
    return { txHash, explorerUrl: `${EXPLORER_BASE}/tx/${txHash}` }
  } catch (err) {
    // Fallback: if sponsorship fails, retry without paymaster.
    if (isLikelyPaymasterError(err)) {
      const { client: noPaymasterClient } = await getKernelClient(serializedPermission, { withPaymaster: false })
      const txHash = await noPaymasterClient.sendTransaction({ calls })
      return { txHash, explorerUrl: `${EXPLORER_BASE}/tx/${txHash}` }
    }
    throw new Error(formatExecutionError(err))
  }
}

export async function executeWithdrawal({
  serializedPermission,
  smartAccountAddress,
  ownerAddress,        // backend-provided EOA owner (trusted, HMAC-authenticated)
  agentFeeAmount,      // raw 6-decimal integer string
  isFullWithdrawal,
  contracts,           // { AAVE_POOL, BENQI_POOL, SPARK_VAULT, EULER_VAULT, SILO_SAVUSD_VAULT, SILO_SUSDP_VAULT, USDC, TREASURY }
  balances,            // { benqiQiTokenBalance, sparkShareBalance, eulerShareBalance, siloSavusdShareBalance, siloSusdpShareBalance }
  withdrawAmount,      // raw 6-decimal integer string (partial path)
}) {
  if (!ZERODEV_ID) {
    throw new Error("ZERODEV_PROJECT_ID is missing in execution service environment")
  }

  const {
    client: kernelClient,
    permissionAccountAddress,
    permissionAccount,
  } = await getKernelClient(serializedPermission, { withPaymaster: true })

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

  // 1) Redeem from Aave (MAX withdraw) — ONLY if user has aTokens
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

  // 2) Redeem Benqi by qiToken shares (exact), if non-zero
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

  // 3) Redeem Spark shares (ERC-4626), if configured and non-zero
  const sparkShareBalance = BigInt(balances?.sparkShareBalance || "0")
  if (contracts.SPARK_VAULT && contracts.SPARK_VAULT !== "0x0000000000000000000000000000000000000000" && sparkShareBalance > 0n) {
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

  // 3b) Redeem Euler shares (ERC-4626), if configured and non-zero
  const eulerShareBalance = BigInt(balances?.eulerShareBalance || "0")
  if (contracts.EULER_VAULT && contracts.EULER_VAULT !== "0x0000000000000000000000000000000000000000" && eulerShareBalance > 0n) {
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

  // 3c) Redeem Silo savUSD/USDC shares (ERC-4626), if configured and non-zero
  const siloSavusdShareBalance = BigInt(balances?.siloSavusdShareBalance || "0")
  if (contracts.SILO_SAVUSD_VAULT && contracts.SILO_SAVUSD_VAULT !== "0x0000000000000000000000000000000000000000" && siloSavusdShareBalance > 0n) {
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

  // 3d) Redeem Silo sUSDp/USDC shares (ERC-4626), if configured and non-zero
  const siloSusdpShareBalance = BigInt(balances?.siloSusdpShareBalance || "0")
  if (contracts.SILO_SUSDP_VAULT && contracts.SILO_SUSDP_VAULT !== "0x0000000000000000000000000000000000000000" && siloSusdpShareBalance > 0n) {
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

  // 4) Agent fee transfer to treasury (if any)
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

  // 5) Final user transfer — always to on-chain owner.
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
      const { client: noPaymasterClient } = await getKernelClient(serializedPermission, { withPaymaster: false })
      const txHash = await noPaymasterClient.sendTransaction({ calls })
      return {
        txHash,
        explorerUrl: `${EXPLORER_BASE}/tx/${txHash}`,
        owner: onchainOwner,
        callCount: calls.length,
      }
    }
    throw new Error(formatExecutionError(err))
  }
}

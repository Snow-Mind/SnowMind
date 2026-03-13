import { deserializePermissionAccount } from "@zerodev/permissions"
import {
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk"
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants"
import {
  createPublicClient,
  http,
  encodeFunctionData,
  maxUint256,
  parseUnits,
} from "viem"
import { avalancheFuji, avalanche } from "viem/chains"

const CHAIN_ID      = Number(process.env.AVALANCHE_CHAIN_ID || 43113)
const CHAIN         = CHAIN_ID === 43114 ? avalanche : avalancheFuji
const ENTRYPOINT    = getEntryPoint("0.7")
const ZERODEV_ID    = process.env.ZERODEV_PROJECT_ID
const BUNDLER_URL   = `https://rpc.zerodev.app/api/v3/${ZERODEV_ID}/chain/${CHAIN.id}`
const PAYMASTER_URL = `https://rpc.zerodev.app/api/v3/${ZERODEV_ID}/chain/${CHAIN.id}`

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

// ERC-4626 vault ABI — used by Euler V2 and Spark mock vaults
const ERC4626_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "assets",   type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }] },
  { name: "redeem",  type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "shares",   type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner",    type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }] },
]

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
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
  const meta = err?.metaMessages?.length ? ` | meta=${err.metaMessages.join(" ; ")}` : ""
  const cause = err?.cause?.message ? ` | cause=${err.cause.message}` : ""
  return `${message}${details}${meta}${cause}`
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
    permissionAccountAddress: permissionAccount.address,
  }
}

function resolveContractKey(protocol, contracts) {
  const map = {
    aave_v3:  "AAVE_POOL",
    benqi:    "BENQI_POOL",
    euler_v2: "EULER_VAULT",
    spark:    "SPARK_VAULT",
  }
  return contracts[map[protocol]] || null
}

export async function executeRebalance({
  serializedPermission,
  smartAccountAddress,
  withdrawals,   // [{ protocol: "benqi", amountUSDC: 3000, qiTokenAmount: "12345678" }]
  deposits,      // [{ protocol: "aave_v3", amountUSDC: 3000 }]
  contracts,     // { AAVE_POOL, BENQI_POOL, EULER_VAULT, SPARK_VAULT, USDC, REGISTRY }
}) {
  if (!ZERODEV_ID) {
    throw new Error("ZERODEV_PROJECT_ID is missing in execution service environment")
  }

  const { client: kernelClient, permissionAccountAddress } = await getKernelClient(serializedPermission, { withPaymaster: true })

  if (permissionAccountAddress.toLowerCase() !== smartAccountAddress.toLowerCase()) {
    throw new Error(
      `Session key/account mismatch: permissionAccount=${permissionAccountAddress} sender=${smartAccountAddress}`,
    )
  }
  const calls = []

  // ── WITHDRAWALS FIRST — ensure funds available before deposits ─────────────
  for (const { protocol, amountUSDC, qiTokenAmount } of withdrawals) {
    if (protocol === "aave_v3") {
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
    } else if (protocol === "euler_v2" && contracts.EULER_VAULT) {
      // ERC-4626: redeem(shares, receiver, owner) — use MAX for full exit
      const shares = amountUSDC === "MAX" ? maxUint256 : parseUnits(String(amountUSDC), 6)
      calls.push({
        to: contracts.EULER_VAULT,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC4626_ABI, functionName: "redeem",
          args: [shares, smartAccountAddress, smartAccountAddress],
        }),
      })
    } else if (protocol === "spark" && contracts.SPARK_VAULT) {
      const shares = amountUSDC === "MAX" ? maxUint256 : parseUnits(String(amountUSDC), 6)
      calls.push({
        to: contracts.SPARK_VAULT,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC4626_ABI, functionName: "redeem",
          args: [shares, smartAccountAddress, smartAccountAddress],
        }),
      })
    }
  }

  // ── REGISTRY LOG — between withdrawals and deposits ────────────────────────
  for (const w of withdrawals) {
    for (const d of deposits) {
      const from = resolveContractKey(w.protocol, contracts)
      const to = resolveContractKey(d.protocol, contracts)
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
    if (protocol === "aave_v3") {
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
    } else if (protocol === "euler_v2" && contracts.EULER_VAULT) {
      // ERC-4626: deposit(assets, receiver)
      calls.push({
        to: contracts.EULER_VAULT,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC4626_ABI, functionName: "deposit",
          args: [amount, smartAccountAddress],
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
    }
  }

  // Single atomic UserOp — kernel doc: "Batched as a single atomic UserOp"
  if (!calls.length) {
    throw new Error("No executable calls generated for rebalance")
  }

  try {
    const txHash = await kernelClient.sendTransaction({ calls })
    return { txHash, explorerUrl: `https://testnet.snowtrace.io/tx/${txHash}` }
  } catch (err) {
    // Fallback: if sponsorship fails, retry without paymaster.
    if (isLikelyPaymasterError(err)) {
      const { client: noPaymasterClient } = await getKernelClient(serializedPermission, { withPaymaster: false })
      const txHash = await noPaymasterClient.sendTransaction({ calls })
      return { txHash, explorerUrl: `https://testnet.snowtrace.io/tx/${txHash}` }
    }
    throw new Error(formatExecutionError(err))
  }
}

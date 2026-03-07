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
import { avalancheFuji } from "viem/chains"

const CHAIN       = avalancheFuji
const ENTRYPOINT  = getEntryPoint("0.7")
const BUNDLER_URL = `https://api.pimlico.io/v2/avalanche-fuji/rpc?apikey=${process.env.PIMLICO_API_KEY}`

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

const REGISTRY_ABI = [
  { name: "logRebalance", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "fromProtocol", type: "address" },
      { name: "toProtocol",   type: "address" },
      { name: "amount",       type: "uint256" },
    ], outputs: [] },
]

async function getKernelClient(serializedPermission) {
  const publicClient = createPublicClient({
    chain: CHAIN,
    transport: http(process.env.AVALANCHE_RPC_URL),
  })
  const paymasterClient = createZeroDevPaymasterClient({
    chain: CHAIN,
    transport: http(BUNDLER_URL),
  })

  // Kernel doc: "deserializePermissionAccount reconstructs full kernel client"
  const permissionAccount = await deserializePermissionAccount(
    publicClient,
    ENTRYPOINT,
    KERNEL_V3_1,
    serializedPermission,
  )

  return createKernelAccountClient({
    account: permissionAccount,
    chain: CHAIN,
    bundlerTransport: http(BUNDLER_URL),
    paymaster: {
      getPaymasterData(userOperation) {
        return paymasterClient.sponsorUserOperation({ userOperation })
      },
    },
  })
}

function resolveContractKey(protocol, contracts) {
  const map = {
    aave_v3: "AAVE_POOL",
    benqi:   "BENQI_POOL",
  }
  return contracts[map[protocol]] || null
}

export async function executeRebalance({
  serializedPermission,
  smartAccountAddress,
  withdrawals,   // [{ protocol: "benqi", amountUSDC: 3000, qiTokenAmount: "12345678" }]
  deposits,      // [{ protocol: "aave_v3", amountUSDC: 3000 }]
  contracts,     // { AAVE_POOL, BENQI_POOL, USDC, REGISTRY }
}) {
  const kernelClient = await getKernelClient(serializedPermission)
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
    }
  }

  // ── REGISTRY LOG — between withdrawals and deposits ────────────────────────
  for (const w of withdrawals) {
    for (const d of deposits) {
      calls.push({
        to: contracts.REGISTRY,
        value: 0n,
        data: encodeFunctionData({
          abi: REGISTRY_ABI, functionName: "logRebalance",
          args: [
            resolveContractKey(w.protocol, contracts),
            resolveContractKey(d.protocol, contracts),
            parseUnits(String(w.amountUSDC), 6),
          ],
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
    }
  }

  // Single atomic UserOp — kernel doc: "Batched as a single atomic UserOp"
  const txHash = await kernelClient.sendTransaction({ calls })
  return { txHash, explorerUrl: `https://testnet.snowtrace.io/tx/${txHash}` }
}

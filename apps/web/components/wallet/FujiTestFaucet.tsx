'use client'

import { useState } from 'react'
import { useWalletClient, useAccount } from 'wagmi'
import { parseUnits, encodeFunctionData } from 'viem'
import { CONTRACTS, IS_TESTNET } from '@/lib/constants'

const FAUCET_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_token', type: 'address' },
      { name: '_to', type: 'address' },
      { name: '_amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

export function FujiTestFaucet() {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [isMinting, setIsMinting] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)

  if (!IS_TESTNET) return null

  const handleMintUSDC = async () => {
    if (!walletClient || !address) return
    setIsMinting(true)
    setTxHash(null)

    try {
      const hash = await walletClient.sendTransaction({
        to: CONTRACTS.AAVE_FAUCET,
        data: encodeFunctionData({
          abi: FAUCET_ABI,
          functionName: 'mint',
          args: [CONTRACTS.USDC, address, parseUnits('10000', 6)],
        }),
      })
      setTxHash(hash)
    } catch (err) {
      console.error('Faucet mint failed:', err)
    } finally {
      setIsMinting(false)
    }
  }

  return (
    <div className="rounded-xl border border-[--border-frost] bg-[--ice-20] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <h3 className="text-sm font-semibold text-[--arctic]">Fuji Testnet Faucet</h3>
      </div>

      <p className="text-xs text-[--arctic]/60">
        Get free test tokens to try SnowMind on Avalanche Fuji testnet.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleMintUSDC}
          disabled={isMinting || !address}
          className="rounded-lg bg-[--glacier]/15 border border-[--glacier]/30 px-4 py-2 text-sm font-medium text-[--glacier] hover:bg-[--glacier]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isMinting ? 'Minting…' : 'Get 10,000 Test USDC'}
        </button>

        <a
          href="https://faucet.avax.network/"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-[--frost]/15 border border-[--frost]/30 px-4 py-2 text-sm font-medium text-[--frost] hover:bg-[--frost]/25 transition-colors"
        >
          Get Test AVAX ↗
        </a>
      </div>

      {txHash && (
        <p className="text-xs text-[--mint]">
          10,000 test USDC sent!{' '}
          <a
            href={`https://testnet.snowtrace.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            View tx
          </a>
        </p>
      )}
    </div>
  )
}

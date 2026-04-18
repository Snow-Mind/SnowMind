import test from "node:test"
import assert from "node:assert/strict"

import { parseUnits } from "viem"

import { capDepositsToProjectedBalance, isErc20BalanceInsufficientError } from "./execute.js"

test("capDepositsToProjectedBalance keeps deposits when budget is sufficient", () => {
  const deposits = [
    { protocol: "benqi", amountUSDC: "1.25" },
    { protocol: "spark", amountUSDC: "0.5" },
  ]

  const result = capDepositsToProjectedBalance(deposits, parseUnits("2.0", 6))

  assert.equal(result.requestedTotal, parseUnits("1.75", 6))
  assert.equal(result.plannedTotal, parseUnits("1.75", 6))
  assert.equal(result.cappedLegCount, 0)
  assert.deepEqual(result.deposits, [
    { protocol: "benqi", amountUSDC: "1.25" },
    { protocol: "spark", amountUSDC: "0.5" },
  ])
})

test("capDepositsToProjectedBalance caps tail deposit when budget is short", () => {
  const deposits = [
    { protocol: "spark", amountUSDC: "1.5" },
    { protocol: "benqi", amountUSDC: "1.0" },
  ]

  const result = capDepositsToProjectedBalance(deposits, parseUnits("2.2", 6))

  assert.equal(result.requestedTotal, parseUnits("2.5", 6))
  assert.equal(result.plannedTotal, parseUnits("2.2", 6))
  assert.equal(result.cappedLegCount, 1)
  assert.deepEqual(result.deposits, [
    { protocol: "spark", amountUSDC: "1.5" },
    { protocol: "benqi", amountUSDC: "0.7" },
  ])
})

test("capDepositsToProjectedBalance drops all deposits when budget is zero", () => {
  const deposits = [
    { protocol: "spark", amountUSDC: "1.0" },
    { protocol: "benqi", amountUSDC: "2.0" },
  ]

  const result = capDepositsToProjectedBalance(deposits, 0n)

  assert.equal(result.plannedTotal, 0n)
  assert.equal(result.deposits.length, 0)
  assert.equal(result.cappedLegCount, 2)
})

test("capDepositsToProjectedBalance rejects negative deposit amounts", () => {
  assert.throws(
    () => capDepositsToProjectedBalance([{ protocol: "spark", amountUSDC: "-1" }], parseUnits("1.0", 6)),
    /cannot be negative/,
  )
})

test("isErc20BalanceInsufficientError detects transfer amount exceeds balance", () => {
  const err = {
    message: "execution reverted: ERC20: transfer amount exceeds balance",
  }

  assert.equal(isErc20BalanceInsufficientError(err), true)
})

test("isErc20BalanceInsufficientError ignores unrelated execution errors", () => {
  const err = {
    message: "execution reverted: slippage tolerance exceeded",
  }

  assert.equal(isErc20BalanceInsufficientError(err), false)
})

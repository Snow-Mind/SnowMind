"""Pimlico bundler client for submitting and tracking ERC-4337 UserOperations."""

from __future__ import annotations

import asyncio
import logging

import httpx

from app.core.config import get_settings

logger = logging.getLogger("snowmind")

ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"


class PimlicoBundler:
    """Thin async wrapper around Pimlico's JSON-RPC bundler API."""

    def __init__(self) -> None:
        settings = get_settings()
        self.rpc_url = settings.pimlico_rpc_url
        self.entrypoint = settings.ENTRYPOINT_V07

    # ── JSON-RPC transport ──────────────────────────────────────────

    async def _rpc(
        self,
        client: httpx.AsyncClient,
        method: str,
        params: list,
    ) -> dict:
        """Send a single JSON-RPC request to Pimlico."""
        resp = await client.post(
            self.rpc_url,
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        )
        resp.raise_for_status()
        body = resp.json()
        if "error" in body:
            raise RuntimeError(f"Pimlico RPC error ({method}): {body['error']}")
        return body

    # ── Public API ──────────────────────────────────────────────────

    async def send_userop(self, userop: dict) -> str:
        """Submit a signed UserOperation via ``eth_sendUserOperation``.

        Returns the ``userOpHash`` assigned by the bundler.
        """
        async with httpx.AsyncClient(timeout=30) as client:
            body = await self._rpc(
                client, "eth_sendUserOperation", [userop, self.entrypoint],
            )
            op_hash: str = body["result"]
            logger.info("UserOp submitted: %s", op_hash)
            return op_hash

    async def wait_for_receipt(
        self,
        userop_hash: str,
        timeout_secs: int = 60,
    ) -> dict:
        """Poll ``eth_getUserOperationReceipt`` until mined or timeout.

        Returns receipt dict with keys ``success``, ``txHash``, ``actualGasUsed``.
        """
        async with httpx.AsyncClient(timeout=15) as client:
            for _ in range(timeout_secs // 2):
                body = await self._rpc(
                    client,
                    "eth_getUserOperationReceipt",
                    [userop_hash],
                )
                receipt = body.get("result")
                if receipt and receipt.get("success"):
                    tx_hash = receipt["receipt"]["transactionHash"]
                    logger.info("UserOp %s mined in tx %s", userop_hash, tx_hash)
                    return {
                        "success": True,
                        "txHash": tx_hash,
                        "actualGasUsed": receipt["receipt"].get("gasUsed"),
                    }
                if receipt and not receipt.get("success"):
                    raise RuntimeError(
                        f"UserOp {userop_hash} reverted on-chain: "
                        f"{receipt.get('reason', 'unknown')}"
                    )
                await asyncio.sleep(2)

        raise TimeoutError(
            f"UserOp {userop_hash} not confirmed within {timeout_secs}s"
        )

    async def estimate_gas(self, userop: dict) -> dict:
        """``eth_estimateUserOperationGas`` — returns gas-limit fields."""
        async with httpx.AsyncClient(timeout=15) as client:
            body = await self._rpc(
                client,
                "eth_estimateUserOperationGas",
                [userop, self.entrypoint],
            )
            return body["result"]

    async def sponsor_userop(self, userop: dict) -> dict:
        """``pm_sponsorUserOperation`` — Pimlico paymaster sponsorship.

        Returns dict with ``paymasterAndData`` and gas-limit overrides.
        Makes the transaction gasless for the end-user.
        """
        async with httpx.AsyncClient(timeout=15) as client:
            body = await self._rpc(
                client,
                "pm_sponsorUserOperation",
                [userop, self.entrypoint],
            )
            data = body["result"]
            return {
                "paymasterAndData": data["paymasterAndData"],
                "callGasLimit": data.get("callGasLimit"),
                "verificationGasLimit": data.get("verificationGasLimit"),
                "preVerificationGas": data.get("preVerificationGas"),
            }

    async def get_gas_prices(self) -> dict:
        """``pimlico_getUserOperationGasPrice`` — returns fast gas prices."""
        async with httpx.AsyncClient(timeout=10) as client:
            body = await self._rpc(
                client, "pimlico_getUserOperationGasPrice", [],
            )
            return body["result"]["fast"]

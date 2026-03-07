"""ERC-4337 UserOperation construction and Pimlico bundler submission."""

from __future__ import annotations

import logging

from eth_abi import encode
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

from app.core.config import get_settings
from app.services.execution.bundler import PimlicoBundler

logger = logging.getLogger("snowmind")


class UserOpBuilder:
    """Builds, sponsors, signs, and submits ERC-4337 UserOperations via Pimlico."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.bundler = PimlicoBundler()
        self.entrypoint = self.settings.ENTRYPOINT_V07
        self.chain_id = self.settings.AVALANCHE_CHAIN_ID

    # ── Public API ──────────────────────────────────────────────────

    async def build_and_send_userop(
        self,
        smart_account_address: str,
        calls: list[dict],       # [{"to": "0x…", "data": "0x…", "value": 0}]
        session_key_hex: str,    # decrypted session private key (hex)
    ) -> str:
        """Build, sign, and submit a UserOp. Returns the on-chain tx hash."""

        # 1. Encode batch calldata for Kernel v3.1 executeBatch
        calldata = self.encode_batch_calls(calls)

        # 2. Partial UserOp scaffold
        userop: dict = {
            "sender": smart_account_address,
            "nonce": hex(await self._get_nonce(smart_account_address)),
            "initCode": "0x",
            "callData": calldata,
            "callGasLimit": "0x0",
            "verificationGasLimit": "0x0",
            "preVerificationGas": "0x0",
            "maxFeePerGas": "0x0",
            "maxPriorityFeePerGas": "0x0",
            "paymasterAndData": "0x",
            "signature": "0x",
        }

        # 3. Gas prices from Pimlico
        gas_prices = await self.bundler.get_gas_prices()
        userop["maxFeePerGas"] = gas_prices["maxFeePerGas"]
        userop["maxPriorityFeePerGas"] = gas_prices["maxPriorityFeePerGas"]

        # 4. Paymaster sponsorship (makes tx gasless for user)
        sponsored = await self.bundler.sponsor_userop(userop)
        userop["paymasterAndData"] = sponsored["paymasterAndData"]
        # Use gas limits from paymaster if provided
        for key in ("callGasLimit", "verificationGasLimit", "preVerificationGas"):
            if sponsored.get(key):
                userop[key] = sponsored[key]

        # 5. Refined gas estimates
        gas_est = await self.bundler.estimate_gas(userop)
        userop.update(gas_est)

        # 6. Compute UserOp hash and sign with session key
        userop_hash = self._compute_userop_hash(userop)
        signer = Account.from_key(session_key_hex)
        sig = signer.sign_message(encode_defunct(hexstr=userop_hash))
        userop["signature"] = "0x" + sig.signature.hex()

        # 7. Submit to bundler
        op_hash = await self.bundler.send_userop(userop)

        # 8. Wait for on-chain receipt
        receipt = await self.bundler.wait_for_receipt(op_hash)
        tx_hash = receipt["txHash"]
        logger.info("UserOp mined: tx %s (gas: %s)", tx_hash, receipt.get("actualGasUsed"))
        return tx_hash

    def build_batch_userop(
        self,
        smart_account_address: str,
        calls: list[dict],
        session_key: str,
    ) -> dict:
        """Build an unsigned batched UserOp dict (for inspection/dry-run).

        Does NOT submit — use ``build_and_send_userop`` for the full pipeline.
        """
        return {
            "sender": smart_account_address,
            "nonce": "0x0",
            "initCode": "0x",
            "callData": self.encode_batch_calls(calls),
            "callGasLimit": "0x0",
            "verificationGasLimit": "0x0",
            "preVerificationGas": "0x0",
            "maxFeePerGas": "0x0",
            "maxPriorityFeePerGas": "0x0",
            "paymasterAndData": "0x",
            "signature": "0x",
        }

    # ── Kernel batch encoding ───────────────────────────────────────

    @staticmethod
    def encode_batch_calls(calls: list[dict]) -> str:
        """Encode calls for Kernel v3.1 ``executeBatch((address,uint256,bytes)[])``.

        Each call is ``{to: address, data: hex, value: int}``.
        Returns hex calldata for the smart account's executeBatch function.
        """
        targets = [Web3.to_checksum_address(c["to"]) for c in calls]
        values = [c.get("value", 0) for c in calls]
        datas = [bytes.fromhex(c["data"][2:]) if c["data"] != "0x" else b"" for c in calls]

        selector = Web3.keccak(text="executeBatch((address,uint256,bytes)[])")[:4]
        encoded = encode(
            ["(address,uint256,bytes)[]"],
            [list(zip(targets, values, datas))],
        )
        return "0x" + selector.hex() + encoded.hex()

    # ── Nonce lookup ────────────────────────────────────────────────

    async def _get_nonce(self, sender: str) -> int:
        """Read the next nonce from the EntryPoint contract via bundler RPC."""
        import httpx

        selector = Web3.keccak(text="getNonce(address,uint192)")[:4]
        params = encode(
            ["address", "uint192"],
            [Web3.to_checksum_address(sender), 0],
        )
        calldata = "0x" + selector.hex() + params.hex()

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                self.bundler.rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "eth_call",
                    "params": [{"to": self.entrypoint, "data": calldata}, "latest"],
                },
            )
            resp.raise_for_status()
            body = resp.json()
            if "error" in body:
                raise RuntimeError(f"getNonce failed: {body['error']}")
            return int(body["result"], 16)

    # ── UserOp hash (ERC-4337 v0.6 compatible) ─────────────────────

    def _compute_userop_hash(self, userop: dict) -> str:
        """Locally compute the UserOperation hash for signing."""
        sender = Web3.to_checksum_address(userop["sender"])
        init_code = bytes.fromhex(userop.get("initCode", "0x")[2:])
        call_data = bytes.fromhex(userop["callData"][2:])
        pm_data = bytes.fromhex(userop.get("paymasterAndData", "0x")[2:])

        packed = encode(
            [
                "address", "uint256",
                "bytes32", "bytes32",
                "uint256", "uint256", "uint256",
                "uint256", "uint256",
                "bytes32",
            ],
            [
                sender,
                int(userop["nonce"], 16),
                Web3.keccak(init_code),
                Web3.keccak(call_data),
                int(userop["callGasLimit"], 16),
                int(userop["verificationGasLimit"], 16),
                int(userop["preVerificationGas"], 16),
                int(userop["maxFeePerGas"], 16),
                int(userop["maxPriorityFeePerGas"], 16),
                Web3.keccak(pm_data),
            ],
        )

        pack_hash = Web3.keccak(packed)
        final = encode(
            ["bytes32", "address", "uint256"],
            [pack_hash, Web3.to_checksum_address(self.entrypoint), self.chain_id],
        )
        return "0x" + Web3.keccak(final).hex()

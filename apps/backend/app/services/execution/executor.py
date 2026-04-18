import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass

import httpx
from web3 import Web3

from app.core.config import get_settings
from app.services.protocols.base import get_shared_async_web3


_ENTRYPOINT_V07_ADDRESS = Web3.to_checksum_address(
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
)
_ENTRYPOINT_V07_EVENTS_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "userOpHash", "type": "bytes32"},
            {"indexed": True, "name": "sender", "type": "address"},
            {"indexed": True, "name": "paymaster", "type": "address"},
            {"indexed": False, "name": "nonce", "type": "uint256"},
            {"indexed": False, "name": "success", "type": "bool"},
            {"indexed": False, "name": "actualGasCost", "type": "uint256"},
            {"indexed": False, "name": "actualGasUsed", "type": "uint256"},
        ],
        "name": "UserOperationEvent",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "userOpHash", "type": "bytes32"},
            {"indexed": True, "name": "sender", "type": "address"},
            {"indexed": False, "name": "nonce", "type": "uint256"},
            {"indexed": False, "name": "revertReason", "type": "bytes"},
        ],
        "name": "UserOperationRevertReason",
        "type": "event",
    },
]
_USEROP_RECEIPT_TIMEOUT_SECONDS = 120


@dataclass(frozen=True)
class UserOpVerificationResult:
    succeeded: bool
    terminal: bool
    reason: str
    revert_reason_hex: str | None = None


class UserOpVerificationError(RuntimeError):
    """Base class for UserOperation confirmation failures."""


class UserOpExecutionFailedError(UserOpVerificationError):
    """Raised when EntryPoint reports an inner UserOperation failure."""


class UserOpReceiptUnavailableError(UserOpVerificationError):
    """Raised when tx confirmation cannot be retrieved reliably."""


async def verify_userop_execution(
    tx_hash: str,
    smart_account_address: str,
    *,
    timeout_seconds: int = _USEROP_RECEIPT_TIMEOUT_SECONDS,
) -> UserOpVerificationResult:
    """Verify ERC-4337 UserOperation success for a sender in an EntryPoint tx.

    This checks the outer tx receipt *and* UserOperationEvent.success for the
    specific smart-account sender. A tx hash alone is insufficient because
    handleOps can succeed while an inner user-op reverts.
    """
    normalized_tx_hash = str(tx_hash or "").strip()
    if not normalized_tx_hash:
        return UserOpVerificationResult(
            succeeded=False,
            terminal=True,
            reason="missing_tx_hash",
        )

    try:
        expected_sender = Web3.to_checksum_address(smart_account_address)
    except Exception:
        return UserOpVerificationResult(
            succeeded=False,
            terminal=True,
            reason=f"invalid_sender_address:{smart_account_address}",
        )

    w3 = get_shared_async_web3()
    try:
        receipt = await w3.eth.wait_for_transaction_receipt(
            normalized_tx_hash,
            timeout=timeout_seconds,
            poll_latency=1.0,
        )
    except Exception as exc:
        return UserOpVerificationResult(
            succeeded=False,
            terminal=False,
            reason=f"receipt_unavailable:{exc}",
        )

    if int(receipt.get("status", 0)) != 1:
        return UserOpVerificationResult(
            succeeded=False,
            terminal=True,
            reason="entrypoint_transaction_reverted",
        )

    entrypoint = w3.eth.contract(
        address=_ENTRYPOINT_V07_ADDRESS,
        abi=_ENTRYPOINT_V07_EVENTS_ABI,
    )
    saw_sender_event = False
    sender_succeeded = False
    revert_reason_hex: str | None = None

    for raw_log in receipt.get("logs", []):
        log_address = str(raw_log.get("address") or "").lower()
        if log_address != _ENTRYPOINT_V07_ADDRESS.lower():
            continue

        try:
            decoded = entrypoint.events.UserOperationEvent().process_log(raw_log)
            log_sender = Web3.to_checksum_address(str(decoded["args"]["sender"]))
            if log_sender == expected_sender:
                saw_sender_event = True
                sender_succeeded = sender_succeeded or bool(decoded["args"]["success"])
            continue
        except Exception:
            pass

        try:
            decoded = entrypoint.events.UserOperationRevertReason().process_log(raw_log)
            log_sender = Web3.to_checksum_address(str(decoded["args"]["sender"]))
            if log_sender == expected_sender:
                revert_reason = decoded["args"].get("revertReason")
                if revert_reason:
                    revert_reason_hex = Web3.to_hex(revert_reason)
            continue
        except Exception:
            continue

    if not saw_sender_event:
        return UserOpVerificationResult(
            succeeded=False,
            terminal=True,
            reason="missing_useroperation_event_for_sender",
        )

    if not sender_succeeded:
        reason = "useroperation_failed_inside_entrypoint"
        if revert_reason_hex:
            reason = f"{reason}:revert_data={revert_reason_hex}"
        return UserOpVerificationResult(
            succeeded=False,
            terminal=True,
            reason=reason,
            revert_reason_hex=revert_reason_hex,
        )

    return UserOpVerificationResult(
        succeeded=True,
        terminal=True,
        reason="ok",
    )


async def assert_userop_execution_succeeded(
    tx_hash: str,
    smart_account_address: str,
    *,
    timeout_seconds: int = _USEROP_RECEIPT_TIMEOUT_SECONDS,
) -> UserOpVerificationResult:
    """Raise if the UserOperation was not conclusively successful on-chain."""
    verification = await verify_userop_execution(
        tx_hash,
        smart_account_address,
        timeout_seconds=timeout_seconds,
    )
    if verification.succeeded:
        return verification

    message = (
        f"UserOperation confirmation failed for {smart_account_address} tx={tx_hash}: "
        f"{verification.reason}"
    )
    if verification.terminal:
        raise UserOpExecutionFailedError(message)
    raise UserOpReceiptUnavailableError(message)


class ExecutionService:
    @staticmethod
    def _build_signature_message(
        method: str,
        path: str,
        timestamp: str,
        nonce: str,
        body: str,
    ) -> str:
        return f"{method}\n{path}\n{timestamp}\n{nonce}\n{body}"

    async def _post(self, path: str, payload: dict) -> dict:
        settings = get_settings()
        if not settings.INTERNAL_SERVICE_KEY:
            raise RuntimeError("INTERNAL_SERVICE_KEY is required for execution service auth")

        body = json.dumps(payload, separators=(",", ":"), sort_keys=True)

        headers = {
            "content-type": "application/json",
        }
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(16)
        message = self._build_signature_message(
            method="POST",
            path=path,
            timestamp=timestamp,
            nonce=nonce,
            body=body,
        )
        signature = hmac.new(
            settings.INTERNAL_SERVICE_KEY.encode("utf-8"),
            message.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        headers.update(
            {
                "x-request-timestamp": timestamp,
                "x-request-nonce": nonce,
                "x-request-signature": signature,
            }
        )

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{settings.EXECUTION_SERVICE_URL}{path}",
                headers=headers,
                content=body,
            )
            resp.raise_for_status()
            return resp.json()

    async def execute_rebalance(
        self,
        serialized_permission: str,   # decrypted approval from DB
        smart_account_address: str,
        withdrawals: list[dict],
        deposits: list[dict],
        session_private_key: str = "",  # session key's private key for deserialization
        fee_transfer: dict | None = None,
        user_transfer: dict | None = None,
    ) -> dict:
        settings = get_settings()
        payload = {
            "serializedPermission": serialized_permission,
            "sessionPrivateKey": session_private_key,
            "smartAccountAddress": smart_account_address,
            "withdrawals": withdrawals,
            "deposits": deposits,
            "contracts": {
                "AAVE_POOL": settings.AAVE_V3_POOL,
                "BENQI_POOL": settings.BENQI_QIUSDC,
                "SPARK_VAULT": settings.SPARK_SPUSDC,
                "EULER_VAULT": settings.EULER_VAULT,
                "SILO_SAVUSD_VAULT": settings.SILO_SAVUSD_VAULT,
                "SILO_SUSDP_VAULT": settings.SILO_SUSDP_VAULT,
                "SILO_GAMI_USDC_VAULT": settings.SILO_GAMI_USDC_VAULT,
                "FOLKS_SPOKE_COMMON": settings.FOLKS_SPOKE_COMMON,
                "FOLKS_SPOKE_USDC": settings.FOLKS_SPOKE_USDC,
                "FOLKS_HUB": settings.FOLKS_HUB,
                "FOLKS_MESSAGE_MANAGER": settings.FOLKS_MESSAGE_MANAGER,
                "FOLKS_ACCOUNT_MANAGER": settings.FOLKS_ACCOUNT_MANAGER,
                "FOLKS_LOAN_MANAGER": settings.FOLKS_LOAN_MANAGER,
                "FOLKS_USDC_HUB_POOL": settings.FOLKS_USDC_HUB_POOL,
                "FOLKS_HUB_CHAIN_ID": settings.FOLKS_HUB_CHAIN_ID,
                "FOLKS_USDC_POOL_ID": settings.FOLKS_USDC_POOL_ID,
                "FOLKS_USDC_LOAN_TYPE_ID": settings.FOLKS_USDC_LOAN_TYPE_ID,
                "FOLKS_ACCOUNT_NONCE": settings.FOLKS_ACCOUNT_NONCE,
                "FOLKS_LOAN_NONCE": settings.FOLKS_LOAN_NONCE,
                "FOLKS_ACCOUNT_NONCE_SCAN_MAX": settings.FOLKS_ACCOUNT_NONCE_SCAN_MAX,
                "FOLKS_LOAN_NONCE_SCAN_MAX": settings.FOLKS_LOAN_NONCE_SCAN_MAX,
                "USDC": settings.USDC_ADDRESS,
                "PERMIT2": settings.PERMIT2,
                "REGISTRY": settings.REGISTRY_CONTRACT_ADDRESS,
            },
        }
        if fee_transfer:
            payload["feeTransfer"] = fee_transfer
        if user_transfer:
            payload["userTransfer"] = user_transfer
        result = await self._post("/execute-rebalance", payload)
        tx_hash = str(result.get("txHash") or "").strip()
        if not tx_hash:
            raise RuntimeError("Execution service response missing txHash")
        await assert_userop_execution_succeeded(tx_hash, smart_account_address)
        result["userOpConfirmed"] = True
        return result

    async def execute_withdrawal(
        self,
        payload: dict,
    ) -> dict:
        return await self._post("/execute/withdrawal", payload)

    async def execute_folks_recovery(
        self,
        payload: dict,
    ) -> dict:
        return await self._post("/execute/folks-recovery", payload)

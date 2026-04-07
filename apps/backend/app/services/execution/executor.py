import hashlib
import hmac
import json
import secrets
import time

import httpx
from app.core.config import get_settings


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
                "FOLKS_ACCOUNT_MANAGER": settings.FOLKS_ACCOUNT_MANAGER,
                "FOLKS_LOAN_MANAGER": settings.FOLKS_LOAN_MANAGER,
                "FOLKS_USDC_HUB_POOL": settings.FOLKS_USDC_HUB_POOL,
                "FOLKS_HUB_CHAIN_ID": settings.FOLKS_HUB_CHAIN_ID,
                "FOLKS_USDC_POOL_ID": settings.FOLKS_USDC_POOL_ID,
                "FOLKS_USDC_LOAN_TYPE_ID": settings.FOLKS_USDC_LOAN_TYPE_ID,
                "FOLKS_ACCOUNT_NONCE": settings.FOLKS_ACCOUNT_NONCE,
                "FOLKS_LOAN_NONCE": settings.FOLKS_LOAN_NONCE,
                "USDC": settings.USDC_ADDRESS,
                "PERMIT2": settings.PERMIT2,
                "REGISTRY": settings.REGISTRY_CONTRACT_ADDRESS,
            },
        }
        if fee_transfer:
            payload["feeTransfer"] = fee_transfer
        if user_transfer:
            payload["userTransfer"] = user_transfer
        return await self._post("/execute-rebalance", payload)

    async def execute_withdrawal(
        self,
        payload: dict,
    ) -> dict:
        return await self._post("/execute/withdrawal", payload)

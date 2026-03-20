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
        body = json.dumps(payload, separators=(",", ":"), sort_keys=True)

        headers = {
            "content-type": "application/json",
            "x-internal-key": settings.INTERNAL_SERVICE_KEY,
        }
        if settings.INTERNAL_SERVICE_KEY:
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
        serialized_permission: str,   # decrypted from DB
        smart_account_address: str,
        withdrawals: list[dict],
        deposits: list[dict],
        fee_transfer: dict | None = None,
        user_transfer: dict | None = None,
    ) -> dict:
        settings = get_settings()
        payload = {
            "serializedPermission": serialized_permission,
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
                "USDC": settings.USDC_ADDRESS,
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

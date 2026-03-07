import httpx
from app.core.config import get_settings


class ExecutionService:
    async def execute_rebalance(
        self,
        serialized_permission: str,   # decrypted from DB
        smart_account_address: str,
        withdrawals: list[dict],
        deposits: list[dict],
    ) -> dict:
        settings = get_settings()
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{settings.EXECUTION_SERVICE_URL}/execute-rebalance",
                headers={"x-internal-key": settings.INTERNAL_SERVICE_KEY},
                json={
                    "serializedPermission": serialized_permission,
                    "smartAccountAddress":  smart_account_address,
                    "withdrawals":          withdrawals,
                    "deposits":             deposits,
                    "contracts": {
                        "AAVE_POOL": settings.AAVE_V3_POOL,
                        "BENQI_POOL": settings.BENQI_POOL,
                        "USDC":      settings.USDC_ADDRESS,
                        "REGISTRY":  settings.REGISTRY_CONTRACT_ADDRESS,
                    },
                },
            )
            resp.raise_for_status()
            return resp.json()

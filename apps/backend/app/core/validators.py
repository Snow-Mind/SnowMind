"""Input validation utilities for API boundaries."""

from __future__ import annotations

from web3 import Web3


def validate_eth_address(address: str) -> str:
    """Returns checksummed address or raises ValueError."""
    try:
        return Web3.to_checksum_address(address)
    except Exception:
        raise ValueError(f"Invalid Ethereum address: {address}")


def validate_usdc_amount(amount: float, min_usd: float = 100.0) -> float:
    """Validates USDC amount is positive and above minimum."""
    if amount <= 0:
        raise ValueError("Amount must be positive")
    if amount < min_usd:
        raise ValueError(f"Minimum amount is ${min_usd}")
    if amount > 10_000_000:
        raise ValueError("Amount exceeds maximum")
    return amount

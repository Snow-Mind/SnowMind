// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockBenqiPool
 * @notice Simulates Benqi's qiUSDC (qiToken / Compound-fork) interface on Fuji testnet.
 *         Real Benqi is mainnet-only. This contract uses IDENTICAL function signatures
 *         and APY calculation methods so the BenqiAdapter works without changes.
 *
 * Real Benqi mainnet:
 *   qiUSDC:  0xBEb5d47A3f720Ec0a390d04b4d41ED7d9688bC7F
 *   qiUSDCn: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C (native USDC)
 *
 * Snowtrace verification: https://testnet.snowtrace.io/address/{DEPLOYED}#code
 */
contract MockBenqiPool is ERC20 {

    IERC20 public immutable underlying;   // USDC on Fuji
    uint256 public exchangeRateMantissa;  // Scaled 1e18 (starts at 0.02 = 2e16)
    uint256 public supplyRatePerTimestampVal; // Per-second rate, scaled 1e18
    uint256 public totalSupplyUnderlying;

    uint256 private constant MANTISSA = 1e18;
    // Simulates ~4.5% APY: 4.5% / 365.25 / 86400 ≈ 1.426e-9 per second → 1.426e9 in 1e18 units
    uint256 private constant DEFAULT_SUPPLY_RATE = 1426000000;

    event Mint(address minter, uint256 mintAmount, uint256 mintTokens);
    event Redeem(address redeemer, uint256 redeemAmount, uint256 redeemTokens);

    constructor(address _underlying) ERC20("SnowMind Mock qiUSDC", "sm-qiUSDC") {
        underlying = IERC20(_underlying);
        exchangeRateMantissa = 2e16;  // 0.02 initial exchange rate (Benqi standard)
        supplyRatePerTimestampVal = DEFAULT_SUPPLY_RATE;
    }

    /**
     * @notice Supply USDC, receive qiTokens
     * @dev Identical signature to real Benqi qiToken.mint()
     * @param mintAmount Amount of USDC to supply (6 decimals)
     * @return 0 on success
     */
    function mint(uint256 mintAmount) external returns (uint256) {
        require(underlying.transferFrom(msg.sender, address(this), mintAmount), "Transfer failed");

        // qiTokens = mintAmount / exchangeRate
        // exchangeRate is scaled by 1e18, USDC has 6 decimals, qiToken has 8 decimals
        uint256 qiTokens = (mintAmount * 1e12 * MANTISSA) / exchangeRateMantissa;

        _mint(msg.sender, qiTokens);
        totalSupplyUnderlying += mintAmount;

        emit Mint(msg.sender, mintAmount, qiTokens);
        return 0;
    }

    /**
     * @notice Burn qiTokens, receive USDC
     * @dev Identical signature to real Benqi qiToken.redeem()
     * @param redeemTokens Amount of qiTokens to burn
     * @return 0 on success
     */
    function redeem(uint256 redeemTokens) external returns (uint256) {
        // USDC = qiTokens * exchangeRate / 1e18 / 1e12
        uint256 redeemAmount = (redeemTokens * exchangeRateMantissa) / (MANTISSA * 1e12);
        require(underlying.balanceOf(address(this)) >= redeemAmount, "Insufficient liquidity");

        _burn(msg.sender, redeemTokens);
        require(underlying.transfer(msg.sender, redeemAmount), "Transfer failed");
        totalSupplyUnderlying -= redeemAmount;

        emit Redeem(msg.sender, redeemAmount, redeemTokens);
        return 0;
    }

    /**
     * @notice Get per-second supply rate
     * @dev Same as real Benqi. APY = (1 + rate/1e18)^SECONDS_PER_YEAR - 1
     * @return Per-second rate scaled by 1e18
     */
    function supplyRatePerTimestamp() external view returns (uint256) {
        // Dynamically adjust rate based on utilization (simulates real Benqi behavior)
        // Higher deposits → lower rate (supply increases → utilization drops → APY drops)
        uint256 utilizationFactor = totalSupplyUnderlying > 0
            ? (totalSupplyUnderlying * 1e6) / (totalSupplyUnderlying + 1e12)  // caps at high util
            : 5e5;
        // Rate between 1.0% and 6.0% APY depending on pool size
        return DEFAULT_SUPPLY_RATE + (utilizationFactor * 1000);
    }

    /**
     * @notice Get current exchange rate (qiToken → USDC)
     * @dev Stored rate, same as real Benqi. Used for balance calculation.
     */
    function exchangeRateStored() external view returns (uint256) {
        return exchangeRateMantissa;
    }

    /**
     * @notice Get underlying USDC balance for a user (via their qiToken balance)
     * @dev Same as real Benqi
     */
    function balanceOfUnderlying(address account) external view returns (uint256) {
        uint256 qiBal = balanceOf(account);
        return (qiBal * exchangeRateMantissa) / (MANTISSA * 1e12);
    }

    /**
     * @notice Simulate interest accrual — call periodically to update exchange rate
     * @dev In real Benqi this happens automatically every block. Here manual for testnet.
     */
    function accrueInterest() external {
        // Increment exchange rate slightly (~4.5% APY equivalent)
        // Each call: rate increases by DEFAULT_SUPPLY_RATE / 1e18
        exchangeRateMantissa += (exchangeRateMantissa * DEFAULT_SUPPLY_RATE) / (MANTISSA * 1000);
    }

    // ── Admin helpers for testnet ──────────────────────────────────────────────

    function setSupplyRate(uint256 newRate) external {
        // Allows testnet demonstration of optimizer responding to rate changes
        supplyRatePerTimestampVal = newRate;
    }
}

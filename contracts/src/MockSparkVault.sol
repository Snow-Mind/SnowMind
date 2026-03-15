// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/**
 * @title MockSparkVault
 * @notice Simulates Spark Savings ERC-4626 vault interface on Fuji.
 *         Real Spark Savings uses identical ERC-4626 standard (deposit/redeem).
 *         Includes accrueInterest() for testnet yield simulation.
 */
contract MockSparkVault is ERC4626 {
    uint256 private _apy = 37500; // 3.75% APY in basis points (1e6 = 100%)
    uint256 private _accruedInterest; // Virtual accrued interest (in asset decimals)

    constructor(address asset)
        ERC20("SnowMind Mock Spark USDC Vault", "sm-sUSDC")
        ERC4626(IERC20(asset))
    {}

    // Returns per-second yield rate for cross-protocol APY comparison
    function interestRatePerSecond() external view returns (uint256) {
        // _apy / 1e6 / 31557600 scaled by 1e18
        return (_apy * 1e18) / (1e6 * 31557600);
    }

    /// @notice Override totalAssets to include virtual accrued interest.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + _accruedInterest;
    }

    /// @notice Simulate yield accrual. Called by the scheduler every 5 minutes.
    ///         Adds interest proportional to the APY on the current total assets.
    ///         Each call simulates ~5 minutes of yield at the configured APY.
    function accrueInterest() external {
        uint256 total = totalAssets();
        if (total == 0) return;
        // Interest for 5 minutes: total * _apy / 1e6 / (365.25 * 24 * 12)
        // = total * _apy / (1e6 * 105192)
        _accruedInterest += (total * _apy) / (1e6 * 105192);
    }
}

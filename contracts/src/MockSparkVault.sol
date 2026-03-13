// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/**
 * @title MockSparkVault
 * @notice Simulates Spark Savings ERC-4626 vault interface on Fuji.
 *         Real Spark Savings uses identical ERC-4626 standard (deposit/redeem).
 */
contract MockSparkVault is ERC4626 {
    uint256 private _apy = 37500; // 3.75% APY in basis points (1e6 = 100%)

    constructor(address asset)
        ERC20("SnowMind Mock Spark USDC Vault", "sm-sUSDC")
        ERC4626(IERC20(asset))
    {}

    // Returns per-second yield rate for cross-protocol APY comparison
    function interestRatePerSecond() external view returns (uint256) {
        // _apy / 1e6 / 31557600 scaled by 1e18
        return (_apy * 1e18) / (1e6 * 31557600);
    }
}

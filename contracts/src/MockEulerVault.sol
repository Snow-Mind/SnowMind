// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/**
 * @title MockEulerVault
 * @notice Simulates Euler V2 ERC-4626 vault interface on Fuji.
 *         Real Euler V2 uses identical ERC-4626 standard (deposit/redeem).
 * Status: "Coming Soon" in UI — deployed but shown as inactive protocol.
 */
contract MockEulerVault is ERC4626 {
    uint256 private _apy = 35000; // 3.5% APY in basis points (1e6 = 100%)

    constructor(address asset)
        ERC20("SnowMind Mock Euler USDC Vault", "sm-eUSDC")
        ERC4626(IERC20(asset))
    {}

    // Returns per-second yield rate for cross-protocol APY comparison
    function interestRatePerSecond() external view returns (uint256) {
        // _apy / 1e6 / 31557600 scaled by 1e18
        return (_apy * 1e18) / (1e6 * 31557600);
    }
}

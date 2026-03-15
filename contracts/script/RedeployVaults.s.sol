// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MockEulerVault.sol";
import "../src/MockSparkVault.sol";

/// @notice Redeploy only MockEulerVault and MockSparkVault with accrueInterest() support.
contract RedeployVaults is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdcFuji = 0x5425890298aed601595a70AB815c96711a31Bc65;

        vm.startBroadcast(pk);

        MockEulerVault euler = new MockEulerVault(usdcFuji);
        MockSparkVault spark = new MockSparkVault(usdcFuji);

        vm.stopBroadcast();

        console.log("=== NEW VAULT ADDRESSES ===");
        console.log("EULER_VAULT=", address(euler));
        console.log("SPARK_VAULT=", address(spark));
    }
}

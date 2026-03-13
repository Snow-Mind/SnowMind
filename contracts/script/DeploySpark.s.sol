// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MockSparkVault.sol";

contract DeploySparkScript is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdcFuji = 0x5425890298aed601595a70AB815c96711a31Bc65;

        vm.startBroadcast(pk);

        MockSparkVault spark = new MockSparkVault(usdcFuji);

        vm.stopBroadcast();

        console.log("=== DEPLOYED SPARK VAULT ===");
        console.log("SPARK_VAULT_FUJI=", address(spark));
        console.log("Snowtrace: https://testnet.snowtrace.io/address/", address(spark));
    }
}

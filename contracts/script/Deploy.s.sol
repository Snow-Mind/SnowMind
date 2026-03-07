// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/SnowMindRegistry.sol";
import "../src/MockBenqiPool.sol";
import "../src/MockEulerVault.sol";

contract DeployScript is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdcFuji = 0x5425890298aed601595a70AB815c96711a31Bc65;

        vm.startBroadcast(pk);

        // Deploy SnowMindRegistry (from PROMPT 0)
        SnowMindRegistry registry = new SnowMindRegistry();

        // Deploy MockBenqiPool (Fuji testnet only)
        MockBenqiPool benqi = new MockBenqiPool(usdcFuji);

        // Deploy MockEulerVault (Fuji testnet only, shown as Coming Soon)
        MockEulerVault euler = new MockEulerVault(usdcFuji);

        vm.stopBroadcast();

        // Print all addresses — save these to both .env files
        console.log("=== DEPLOYED ADDRESSES (add to .env) ===");
        console.log("REGISTRY_CONTRACT_ADDRESS=", address(registry));
        console.log("BENQI_POOL_FUJI=", address(benqi));
        console.log("EULER_VAULT_FUJI=", address(euler));
        console.log("AAVE_V3_POOL_FUJI=0x1775ECC8362dB6CaB0c7A9C0957cF656A5276c29");
        console.log("USDC_FUJI=0x5425890298aed601595a70AB815c96711a31Bc65");
        console.log("");
        console.log("=== SNOWTRACE LINKS ===");
        console.log("Registry: https://testnet.snowtrace.io/address/", address(registry));
        console.log("MockBenqi: https://testnet.snowtrace.io/address/", address(benqi));
        console.log("MockEuler: https://testnet.snowtrace.io/address/", address(euler));
    }
}

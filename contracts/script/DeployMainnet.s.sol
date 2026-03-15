// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/SnowMindRegistry.sol";

/**
 * @title DeployMainnet
 * @notice Deploy ONLY the SnowMindRegistry on Avalanche mainnet.
 *         No mock contracts — real Aave V3 and Benqi are already live.
 *
 * Usage:
 *   forge script script/DeployMainnet.s.sol \
 *     --rpc-url avalanche \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $SNOWTRACE_API_KEY
 *
 * After deploy:
 *   1. Copy the Registry address to REGISTRY_CONTRACT_ADDRESS in env vars
 *   2. Transfer ownership to Gnosis Safe multisig
 */
contract DeployMainnet is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(pk);

        // Deploy SnowMindRegistry — the only custom contract needed on mainnet
        SnowMindRegistry registry = new SnowMindRegistry();

        vm.stopBroadcast();

        // Print deployment info
        console.log("=== MAINNET DEPLOYMENT ===");
        console.log("SnowMindRegistry:", address(registry));
        console.log("");
        console.log("=== ADD TO ENV VARS ===");
        console.log("REGISTRY_CONTRACT_ADDRESS=", address(registry));
        console.log("NEXT_PUBLIC_REGISTRY_ADDRESS=", address(registry));
        console.log("");
        console.log("=== VERIFY ON SNOWTRACE ===");
        console.log("https://snowtrace.io/address/", address(registry));
        console.log("");
        console.log("=== ALREADY LIVE (DO NOT REDEPLOY) ===");
        console.log("Aave V3 Pool:  0x794a61358D6845594F94dc1DB02A252b5b4814aD");
        console.log("Benqi qiUSDCn: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C");
        console.log("Native USDC:   0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E");
        console.log("");
        console.log("NEXT STEP: Transfer registry ownership to your Gnosis Safe multisig!");
    }
}

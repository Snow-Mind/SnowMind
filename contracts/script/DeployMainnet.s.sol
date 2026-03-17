// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/SnowMindRegistry.sol";

/**
 * @title DeployMainnet
 * @notice Deploy ONLY the SnowMindRegistry on Avalanche mainnet.
 *         No mock contracts — all lending protocols are already live.
 *
 * Prerequisites:
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   export SNOWTRACE_API_KEY=...
 *
 * Usage:
 *   forge script script/DeployMainnet.s.sol \
 *     --rpc-url avalanche \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $SNOWTRACE_API_KEY
 *
 * After deploy:
 *   1. Copy the Registry address to REGISTRY_CONTRACT_ADDRESS in backend env vars
 *   2. Copy the Registry address to NEXT_PUBLIC_REGISTRY_ADDRESS in frontend env vars
 *   3. Transfer ownership to Gnosis Safe multisig:
 *      cast send <REGISTRY_ADDRESS> "transferOwnership(address)" <GNOSIS_SAFE_ADDRESS> \
 *        --rpc-url avalanche --private-key $DEPLOYER_PRIVATE_KEY
 */
contract DeployMainnet is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(pk);

        // Deploy SnowMindRegistry — the only custom contract needed on mainnet.
        // Owner is set to msg.sender (the deployer). Transfer to Gnosis Safe after.
        SnowMindRegistry registry = new SnowMindRegistry();

        vm.stopBroadcast();

        // Print deployment info
        console.log("=== MAINNET DEPLOYMENT COMPLETE ===");
        console.log("SnowMindRegistry:", address(registry));
        console.log("Owner:           ", registry.owner());
        console.log("");
        console.log("=== ADD TO ENV VARS ===");
        console.log("REGISTRY_CONTRACT_ADDRESS=", address(registry));
        console.log("NEXT_PUBLIC_REGISTRY_ADDRESS=", address(registry));
        console.log("");
        console.log("=== VERIFY ON SNOWTRACE ===");
        console.log("https://snowtrace.io/address/", address(registry));
        console.log("");
        console.log("=== ALREADY LIVE (DO NOT REDEPLOY) ===");
        console.log("Aave V3 Pool:    0x794a61358D6845594F94dc1DB02A252b5b4814aD");
        console.log("Benqi qiUSDCn:   0xB715808a78F6041E46d61Cb123C9B4A27056AE9C");
        console.log("Euler V2 Vault:  0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e");
        console.log("Spark spUSDC:    0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d");
        console.log("Native USDC:     0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E");
        console.log("EntryPoint v0.7: 0x0000000071727De22E5E9d8BAf0edAc6f37da032");
        console.log("");
        console.log("=== NEXT STEP ===");
        console.log("Transfer registry ownership to your Gnosis Safe multisig:");
        console.log("  cast send <REGISTRY> 'transferOwnership(address)' <SAFE> --rpc-url avalanche --private-key $DEPLOYER_PRIVATE_KEY");
    }
}

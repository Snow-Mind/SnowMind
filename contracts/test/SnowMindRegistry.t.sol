// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SnowMindRegistry.sol";

/**
 * @title SnowMindRegistryTest
 * @notice Comprehensive tests for SnowMindRegistry covering:
 *         - Registration / deregistration
 *         - Rebalance logging
 *         - Two-step ownership transfer
 *         - Auth failures
 *         - Edge cases (zero address, duplicates, zero amount)
 */
contract SnowMindRegistryTest is Test {
    SnowMindRegistry public registry;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public charlie = address(0xC4A2);

    address public aavePool = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address public benqiPool = 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C;
    address public sparkVault = 0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d;

    function setUp() public {
        registry = new SnowMindRegistry();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Registration Tests
    // ═══════════════════════════════════════════════════════════════════════

    function test_register_success() public {
        registry.register(alice);

        assertTrue(registry.isRegistered(alice));
        assertEq(registry.getActiveCount(), 1);
        assertEq(registry.getHistoricalCount(), 1);
        assertEq(registry.registeredAccounts(0), alice);

        (bool isReg, uint256 regAt) = registry.accounts(alice);
        assertTrue(isReg);
        assertGt(regAt, 0);
    }

    function test_register_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit SnowMindRegistry.AccountRegistered(alice, block.timestamp);
        registry.register(alice);
    }

    function test_register_multipleAccounts() public {
        registry.register(alice);
        registry.register(bob);
        registry.register(charlie);

        assertEq(registry.getActiveCount(), 3);
        assertEq(registry.getHistoricalCount(), 3);
        assertTrue(registry.isRegistered(alice));
        assertTrue(registry.isRegistered(bob));
        assertTrue(registry.isRegistered(charlie));
    }

    function test_register_revert_zeroAddress() public {
        vm.expectRevert("Zero address");
        registry.register(address(0));
    }

    function test_register_revert_duplicate() public {
        registry.register(alice);
        vm.expectRevert("Already registered");
        registry.register(alice);
    }

    function test_register_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert("Not owner");
        registry.register(bob);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Deregistration Tests
    // ═══════════════════════════════════════════════════════════════════════

    function test_deregister_success() public {
        registry.register(alice);
        registry.deregister(alice);

        assertFalse(registry.isRegistered(alice));
        assertEq(registry.getActiveCount(), 0);
        // Historical count stays at 1
        assertEq(registry.getHistoricalCount(), 1);
    }

    function test_deregister_emitsEvent() public {
        registry.register(alice);
        vm.expectEmit(true, false, false, true);
        emit SnowMindRegistry.AccountDeregistered(alice, block.timestamp);
        registry.deregister(alice);
    }

    function test_deregister_revert_notRegistered() public {
        vm.expectRevert("Not registered");
        registry.deregister(alice);
    }

    function test_deregister_revert_notOwner() public {
        registry.register(alice);
        vm.prank(alice);
        vm.expectRevert("Not owner");
        registry.deregister(alice);
    }

    function test_deregister_thenReRegister() public {
        registry.register(alice);
        registry.deregister(alice);

        // Cannot re-register: address still in mapping with isRegistered = false
        // But isRegistered is false so the require should pass
        // Actually the require is !accounts[account].isRegistered so false == !false → true
        registry.register(alice);
        assertTrue(registry.isRegistered(alice));
        assertEq(registry.getActiveCount(), 1);
        // Historical count increments again
        assertEq(registry.getHistoricalCount(), 2);
    }

    function test_activeCount_afterMultipleOps() public {
        registry.register(alice);
        registry.register(bob);
        registry.register(charlie);
        assertEq(registry.getActiveCount(), 3);

        registry.deregister(bob);
        assertEq(registry.getActiveCount(), 2);

        registry.deregister(alice);
        assertEq(registry.getActiveCount(), 1);

        registry.deregister(charlie);
        assertEq(registry.getActiveCount(), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Rebalance Logging Tests
    // ═══════════════════════════════════════════════════════════════════════

    function test_logRebalance_success() public {
        registry.register(alice);

        vm.expectEmit(true, true, true, true);
        emit SnowMindRegistry.RebalanceLogged(alice, aavePool, benqiPool, 1000e6, block.timestamp);

        registry.logRebalance(alice, aavePool, benqiPool, 1000e6);
    }

    function test_logRebalance_allProtocolPairs() public {
        registry.register(alice);

        // Aave → Benqi
        registry.logRebalance(alice, aavePool, benqiPool, 500e6);
        // Benqi → Spark
        registry.logRebalance(alice, benqiPool, sparkVault, 300e6);
        // Spark → Aave
        registry.logRebalance(alice, sparkVault, aavePool, 200e6);
    }

    function test_logRebalance_revert_accountNotRegistered() public {
        vm.expectRevert("Account not registered");
        registry.logRebalance(alice, aavePool, benqiPool, 1000e6);
    }

    function test_logRebalance_revert_deregisteredAccount() public {
        registry.register(alice);
        registry.deregister(alice);

        vm.expectRevert("Account not registered");
        registry.logRebalance(alice, aavePool, benqiPool, 1000e6);
    }

    function test_logRebalance_revert_zeroFromProtocol() public {
        registry.register(alice);
        vm.expectRevert("Invalid fromProtocol");
        registry.logRebalance(alice, address(0), benqiPool, 1000e6);
    }

    function test_logRebalance_revert_zeroToProtocol() public {
        registry.register(alice);
        vm.expectRevert("Invalid toProtocol");
        registry.logRebalance(alice, aavePool, address(0), 1000e6);
    }

    function test_logRebalance_revert_sameProtocol() public {
        registry.register(alice);
        vm.expectRevert("Same protocol");
        registry.logRebalance(alice, aavePool, aavePool, 1000e6);
    }

    function test_logRebalance_revert_zeroAmount() public {
        registry.register(alice);
        vm.expectRevert("Zero amount");
        registry.logRebalance(alice, aavePool, benqiPool, 0);
    }

    function test_logRebalance_revert_notOwner() public {
        registry.register(alice);
        vm.prank(alice);
        vm.expectRevert("Not owner");
        registry.logRebalance(alice, aavePool, benqiPool, 1000e6);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Two-Step Ownership Transfer Tests
    // ═══════════════════════════════════════════════════════════════════════

    function test_ownership_initialOwner() public view {
        assertEq(registry.owner(), owner);
        assertEq(registry.pendingOwner(), address(0));
    }

    function test_proposeOwnership_success() public {
        vm.expectEmit(true, true, false, false);
        emit SnowMindRegistry.OwnershipTransferProposed(owner, alice);

        registry.proposeOwnership(alice);
        assertEq(registry.pendingOwner(), alice);
        // Owner unchanged until acceptance
        assertEq(registry.owner(), owner);
    }

    function test_acceptOwnership_success() public {
        registry.proposeOwnership(alice);

        vm.expectEmit(true, true, false, false);
        emit SnowMindRegistry.OwnershipTransferred(owner, alice);

        vm.prank(alice);
        registry.acceptOwnership();

        assertEq(registry.owner(), alice);
        assertEq(registry.pendingOwner(), address(0));
    }

    function test_ownership_newOwnerCanOperate() public {
        registry.proposeOwnership(alice);
        vm.prank(alice);
        registry.acceptOwnership();

        // New owner can register
        vm.prank(alice);
        registry.register(bob);
        assertTrue(registry.isRegistered(bob));

        // Old owner cannot register
        vm.expectRevert("Not owner");
        registry.register(charlie);
    }

    function test_proposeOwnership_revert_zeroAddress() public {
        vm.expectRevert("Zero address");
        registry.proposeOwnership(address(0));
    }

    function test_proposeOwnership_revert_alreadyOwner() public {
        vm.expectRevert("Already owner");
        registry.proposeOwnership(owner);
    }

    function test_proposeOwnership_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert("Not owner");
        registry.proposeOwnership(bob);
    }

    function test_acceptOwnership_revert_notPendingOwner() public {
        registry.proposeOwnership(alice);
        vm.prank(bob);
        vm.expectRevert("Not pending owner");
        registry.acceptOwnership();
    }

    function test_acceptOwnership_revert_noPendingOwner() public {
        vm.prank(alice);
        vm.expectRevert("Not pending owner");
        registry.acceptOwnership();
    }

    function test_cancelOwnershipProposal() public {
        registry.proposeOwnership(alice);
        assertEq(registry.pendingOwner(), alice);

        registry.cancelOwnershipProposal();
        assertEq(registry.pendingOwner(), address(0));

        // Alice can no longer accept
        vm.prank(alice);
        vm.expectRevert("Not pending owner");
        registry.acceptOwnership();
    }

    function test_cancelOwnershipProposal_revert_notOwner() public {
        registry.proposeOwnership(alice);
        vm.prank(alice);
        vm.expectRevert("Not owner");
        registry.cancelOwnershipProposal();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // View Function Tests
    // ═══════════════════════════════════════════════════════════════════════

    function test_isRegistered_defaultFalse() public view {
        assertFalse(registry.isRegistered(alice));
    }

    function test_getActiveCount_initiallyZero() public view {
        assertEq(registry.getActiveCount(), 0);
    }

    function test_getHistoricalCount_initiallyZero() public view {
        assertEq(registry.getHistoricalCount(), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Fuzz Tests
    // ═══════════════════════════════════════════════════════════════════════

    function testFuzz_register(address account) public {
        vm.assume(account != address(0));
        registry.register(account);
        assertTrue(registry.isRegistered(account));
        assertEq(registry.getActiveCount(), 1);
    }

    function testFuzz_logRebalance_validAmount(uint256 amount) public {
        vm.assume(amount > 0);
        registry.register(alice);
        registry.logRebalance(alice, aavePool, benqiPool, amount);
    }
}

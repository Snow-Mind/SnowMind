// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
// SnowMindRegistry invariant test suite
//
// Written by the 2026-04-14 security audit. NOT imported by the main test
// tree — to run:
//
//     cp audit/invariants/SnowMindRegistryInvariant.t.sol contracts/test/
//     cd contracts && forge test --match-contract SnowMindRegistryInvariant -vvv
//     # Then clean up:
//     rm ../contracts/test/SnowMindRegistryInvariant.t.sol
//
// This file lives under audit/ so the tracked Solidity test tree stays
// pristine. Copy it into contracts/test/ only while you run forge.
// ─────────────────────────────────────────────────────────────────────────────

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/src/SnowMindRegistry.sol";

/// @notice Handler contract that wraps registry calls with owner pranking and
///         tracks a parallel shadow set of expected-active accounts. Foundry
///         invariant runner calls handler functions with fuzzed inputs; the
///         invariant contract (below) then asserts properties after each call.
contract RegistryHandler is Test {
    SnowMindRegistry public registry;
    address public owner;

    // Shadow set of addresses we have ever registered (duplicates allowed).
    address[] public everRegistered;
    // Shadow count of addresses currently isRegistered == true, maintained
    // in lockstep with the on-chain counter.
    uint256 public expectedActive;
    // Map of known addresses we've exercised, so invariants can iterate.
    mapping(address => bool) public knownAddress;
    address[] public knownAddressList;

    address internal constant _DEFAULT_PROTOCOL_A = 0x794a61358D6845594F94dc1DB02A252b5b4814aD; // Aave V3 pool
    address internal constant _DEFAULT_PROTOCOL_B = 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C; // Benqi qiUSDC

    constructor(SnowMindRegistry _registry, address _owner) {
        registry = _registry;
        owner = _owner;
    }

    // Pull a bounded, deterministic account address out of the fuzz seed.
    function _pick(uint256 seed) internal pure returns (address) {
        uint256 bounded = (seed % 32) + 1; // 1..32, avoids address(0)
        return address(uint160(bounded));
    }

    function handler_register(uint256 seed) external {
        address acct = _pick(seed);
        if (registry.isRegistered(acct)) return;

        vm.prank(owner);
        registry.register(acct);

        everRegistered.push(acct);
        expectedActive++;
        if (!knownAddress[acct]) {
            knownAddress[acct] = true;
            knownAddressList.push(acct);
        }
    }

    function handler_deregister(uint256 seed) external {
        address acct = _pick(seed);
        if (!registry.isRegistered(acct)) return;

        vm.prank(owner);
        registry.deregister(acct);

        expectedActive--;
    }

    function handler_logRebalance_happyPath(uint256 seed, uint256 amount) external {
        address acct = _pick(seed);
        if (!registry.isRegistered(acct)) return;
        if (amount == 0) amount = 1;
        if (amount > type(uint128).max) amount = type(uint128).max;

        vm.prank(owner);
        registry.logRebalance(acct, _DEFAULT_PROTOCOL_A, _DEFAULT_PROTOCOL_B, amount);
    }

    /// @notice A non-owner caller should NEVER be able to mutate state.
    ///         Handler swallows the expected revert so the fuzzer can keep
    ///         firing; the actual assertion happens in the invariant fn.
    function handler_unauthorized_register(address rogue, uint256 seed) external {
        if (rogue == owner || rogue == address(0)) return;
        address acct = _pick(seed);

        vm.prank(rogue);
        try registry.register(acct) {
            revert("INVARIANT_VIOLATED: non-owner registered");
        } catch {
            // expected
        }
    }

    function handler_unauthorized_deregister(address rogue, uint256 seed) external {
        if (rogue == owner || rogue == address(0)) return;
        address acct = _pick(seed);

        vm.prank(rogue);
        try registry.deregister(acct) {
            revert("INVARIANT_VIOLATED: non-owner deregistered");
        } catch {
            // expected
        }
    }

    function handler_unauthorized_setProtocol(address rogue, address protocol) external {
        if (rogue == owner || rogue == address(0)) return;
        if (protocol == address(0)) protocol = address(0x1);

        vm.prank(rogue);
        try registry.setProtocolAllowed(protocol, true) {
            revert("INVARIANT_VIOLATED: non-owner changed allowlist");
        } catch {
            // expected
        }
    }

    // ── Exposed getters for the invariant contract ──────────────────────────

    function knownAddressCount() external view returns (uint256) {
        return knownAddressList.length;
    }

    function knownAddressAt(uint256 i) external view returns (address) {
        return knownAddressList[i];
    }

    function everRegisteredLength() external view returns (uint256) {
        return everRegistered.length;
    }
}


contract SnowMindRegistryInvariant is StdInvariant, Test {
    SnowMindRegistry public registry;
    RegistryHandler public handler;
    address public immutable owner = address(this);

    function setUp() public {
        registry = new SnowMindRegistry();
        handler = new RegistryHandler(registry, owner);

        // Target only the handler so the fuzzer exercises registry through it.
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = RegistryHandler.handler_register.selector;
        selectors[1] = RegistryHandler.handler_deregister.selector;
        selectors[2] = RegistryHandler.handler_logRebalance_happyPath.selector;
        selectors[3] = RegistryHandler.handler_unauthorized_register.selector;
        selectors[4] = RegistryHandler.handler_unauthorized_deregister.selector;
        selectors[5] = RegistryHandler.handler_unauthorized_setProtocol.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ── Invariant 1: activeAccountCount equals number of isRegistered=true
    //                addresses we know about. We iterate the handler's
    //                knownAddressList (a superset of everRegistered) and count.
    function invariant_activeCountMatchesIsRegistered() public view {
        uint256 n = handler.knownAddressCount();
        uint256 counted;
        for (uint256 i = 0; i < n; i++) {
            address a = handler.knownAddressAt(i);
            if (registry.isRegistered(a)) counted++;
        }
        assertEq(
            counted,
            registry.activeAccountCount(),
            "activeAccountCount != sum(isRegistered)"
        );
    }

    // ── Invariant 2: activeAccountCount <= registeredAccounts.length ─────────
    function invariant_activeLeqHistorical() public view {
        assertLe(
            registry.activeAccountCount(),
            registry.getHistoricalCount(),
            "activeAccountCount > historical length"
        );
    }

    // ── Invariant 3: registeredAccounts is append-only (never shrinks).
    //                We rely on shadow-tracking the minimum observed length.
    uint256 internal _lastHistoricalCount;

    function invariant_historicalCountMonotonic() public {
        uint256 current = registry.getHistoricalCount();
        assertGe(current, _lastHistoricalCount, "registeredAccounts shrank");
        _lastHistoricalCount = current;
    }

    // ── Invariant 4: every entry in registeredAccounts has registeredAt > 0.
    //                registeredAt is a proxy for "was registered at least once".
    function invariant_allEntriesHaveRegisteredAt() public view {
        uint256 n = registry.getHistoricalCount();
        for (uint256 i = 0; i < n; i++) {
            address a = registry.registeredAccounts(i);
            (, uint256 regAt) = registry.accounts(a);
            assertGt(regAt, 0, "array entry has zero registeredAt");
        }
    }

    // ── Invariant 5: `owner` never silently changes. Only proposeOwnership +
    //                acceptOwnership can rotate it; none of our handler
    //                calls use those, so the owner must remain this test.
    function invariant_ownerStable() public view {
        assertEq(registry.owner(), owner, "owner mutated unexpectedly");
    }

    // ── Invariant 6: pendingOwner remains zero throughout this suite because
    //                no handler proposes ownership.
    function invariant_pendingOwnerZero() public view {
        assertEq(
            registry.pendingOwner(),
            address(0),
            "pendingOwner unexpectedly set"
        );
    }

    // ── Invariant 7: Documented F-09 finding — re-registering an address
    //                after deregister pushes a DUPLICATE into the array.
    //                Weak assertion: "historical length >= distinct active
    //                count" always holds. The bug footprint is visible
    //                whenever historical > distinct in forge output.
    function invariant_f09_duplicateGrowth() public view {
        uint256 historical = registry.getHistoricalCount();
        uint256 distinct;
        uint256 n = handler.knownAddressCount();
        for (uint256 i = 0; i < n; i++) {
            address a = handler.knownAddressAt(i);
            (, uint256 regAt) = registry.accounts(a);
            if (regAt != 0) distinct++;
        }
        assertGe(historical, distinct, "historical < distinct (should never happen)");
    }
}

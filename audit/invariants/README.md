# Foundry invariant suite — SnowMindRegistry

Self-contained invariant tests for `contracts/src/SnowMindRegistry.sol`.
Not imported by the main Foundry test tree on purpose — the audit brief
said not to modify the codebase, so the suite lives here and you copy it
over only when you want to run it.

## Run it

```sh
cp audit/invariants/SnowMindRegistryInvariant.t.sol contracts/test/
cd contracts && forge test --match-contract SnowMindRegistryInvariant -vvv
cd .. && rm contracts/test/SnowMindRegistryInvariant.t.sol
```

(If you forget the cleanup, `git clean -fd contracts/test/` will remove it.)

## Last run result

```
Suite result: ok. 7 passed; 0 failed; 0 skipped; finished in 31.95s
Ran 1 test suite: 7 tests passed, 0 failed, 0 skipped (7 total tests)
```

Each invariant ran **256 runs × 500 calls = 128 000 fuzzed handler
invocations** with 0 reverts on the expected paths. Forge version
`1.5.1-stable`.

| # | Invariant | Result |
|---|-----------|--------|
| 1 | `activeAccountCount == sum(isRegistered)` | PASS |
| 2 | `activeAccountCount <= registeredAccounts.length` | PASS |
| 3 | `registeredAccounts.length` monotonic | PASS |
| 4 | every array entry has `registeredAt > 0` | PASS |
| 5 | `owner` stable under non-owner fuzzed callers | PASS |
| 6 | `pendingOwner == address(0)` under handler-only calls | PASS |
| 7 | F-09 marker: `historical >= distinct` (weak assertion) | PASS |

The three `handler_unauthorized_*` functions make ~384 000 fuzzed
non-owner calls across the three invariants; the contract's `onlyOwner`
modifier holds on every one of them.

## What's deliberately NOT tested by these invariants

Invariant #7 uses a deliberately weak assertion so it does not fail on
the known F-09 duplicate-push bug. To confirm F-09 itself, add a unit
test in `contracts/test/SnowMindRegistry.t.sol`:

```solidity
function test_f09_reregister_creates_duplicate() public {
    registry.register(alice);
    registry.deregister(alice);
    registry.register(alice);
    // F-09 bug: alice appears twice in registeredAccounts
    assertEq(registry.getHistoricalCount(), 2);
    assertEq(registry.registeredAccounts(0), alice);
    assertEq(registry.registeredAccounts(1), alice);
    assertEq(registry.getActiveCount(), 1);
}
```

This test demonstrates the bug by passing. Once F-09 is fixed (e.g. via
de-dup on re-register), the test will need to be updated to assert the
new intended behavior.

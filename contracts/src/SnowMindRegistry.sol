// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SnowMindRegistry
 * @notice On-chain registry for SnowMind smart accounts.
 *         Tracks which accounts are registered and their whitelisted protocols.
 *         Used by the backend to verify account eligibility before rebalancing.
 */
contract SnowMindRegistry {
    struct AccountInfo {
        bool isRegistered;
        uint256 registeredAt;
    }

    mapping(address => AccountInfo) public accounts;
    address[] public registeredAccounts;

    event AccountRegistered(address indexed account, uint256 timestamp);
    event AccountDeregistered(address indexed account, uint256 timestamp);

    function register(address account) external {
        require(!accounts[account].isRegistered, "Already registered");
        accounts[account] = AccountInfo({
            isRegistered: true,
            registeredAt: block.timestamp
        });
        registeredAccounts.push(account);
        emit AccountRegistered(account, block.timestamp);
    }

    function deregister(address account) external {
        require(accounts[account].isRegistered, "Not registered");
        accounts[account].isRegistered = false;
        emit AccountDeregistered(account, block.timestamp);
    }

    function isRegistered(address account) external view returns (bool) {
        return accounts[account].isRegistered;
    }

    function getRegisteredCount() external view returns (uint256) {
        return registeredAccounts.length;
    }
}

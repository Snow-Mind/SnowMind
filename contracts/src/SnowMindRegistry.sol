// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SnowMindRegistry
 * @notice On-chain registry for SnowMind smart accounts.
 *         Tracks which accounts are registered and logs rebalance events.
 *         Owner-gated — only the deployer (or Gnosis Safe after transfer) can mutate state.
 */
contract SnowMindRegistry {
    // ── Storage ──────────────────────────────────────────────────────────────

    address public owner;

    struct AccountInfo {
        bool isRegistered;
        uint256 registeredAt;
    }

    mapping(address => AccountInfo) public accounts;
    address[] public registeredAccounts;

    // ── Events ───────────────────────────────────────────────────────────────

    event AccountRegistered(address indexed account, uint256 timestamp);
    event AccountDeregistered(address indexed account, uint256 timestamp);
    event RebalanceLogged(
        address indexed smartAccount,
        address indexed fromProtocol,
        address indexed toProtocol,
        uint256 amount,
        uint256 timestamp
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ── Account management (owner-gated) ─────────────────────────────────────

    function register(address account) external onlyOwner {
        require(!accounts[account].isRegistered, "Already registered");
        accounts[account] = AccountInfo({
            isRegistered: true,
            registeredAt: block.timestamp
        });
        registeredAccounts.push(account);
        emit AccountRegistered(account, block.timestamp);
    }

    function deregister(address account) external onlyOwner {
        require(accounts[account].isRegistered, "Not registered");
        accounts[account].isRegistered = false;
        emit AccountDeregistered(account, block.timestamp);
    }

    // ── Rebalance logging (owner-gated) ──────────────────────────────────────

    function logRebalance(
        address fromProtocol,
        address toProtocol,
        uint256 amount
    ) external onlyOwner {
        emit RebalanceLogged(msg.sender, fromProtocol, toProtocol, amount, block.timestamp);
    }

    // ── View functions ───────────────────────────────────────────────────────

    function isRegistered(address account) external view returns (bool) {
        return accounts[account].isRegistered;
    }

    function getRegisteredCount() external view returns (uint256) {
        return registeredAccounts.length;
    }

    // ── Ownership transfer ───────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}

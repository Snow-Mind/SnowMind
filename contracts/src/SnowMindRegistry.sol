// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SnowMindRegistry
 * @notice On-chain registry for SnowMind smart accounts.
 *         Tracks active accounts and logs rebalance events for transparency.
 *         Two-step ownership transfer prevents accidental bricking.
 * @dev Owner should be transferred to Gnosis Safe after deployment.
 */
contract SnowMindRegistry {

    // ── Storage ──────────────────────────────────────────────────────────────

    address public owner;
    address public pendingOwner;
    uint256 public activeAccountCount;

    struct AccountInfo {
        bool isRegistered;
        uint256 registeredAt;
    }

    mapping(address => AccountInfo) public accounts;
    address[] public registeredAccounts; // append-only historical list
    mapping(address => bool) public allowedProtocols;

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
    event OwnershipTransferProposed(address indexed currentOwner, address indexed proposedOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProtocolAllowlistUpdated(address indexed protocol, bool isAllowed);

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        // Avalanche mainnet protocol allowlist (owner can update later).
        allowedProtocols[0x794a61358D6845594F94dc1DB02A252b5b4814aD] = true; // Aave V3 pool
        allowedProtocols[0xB715808a78F6041E46d61Cb123C9B4A27056AE9C] = true; // Benqi qiUSDC
        allowedProtocols[0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d] = true; // Spark spUSDC
        allowedProtocols[0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e] = true; // Euler vault
        allowedProtocols[0x606fe9a70338e798a292CA22C1F28C829F24048E] = true; // Silo savUSD/USDC
        allowedProtocols[0x8AD697A333569Ca6F04c8c063e9807747ef169C1] = true; // Silo sUSDp/USDC
    }

    // ── Account management (owner-gated) ─────────────────────────────────────

    /// @notice Register a smart account in the SnowMind system.
    /// @param account The Kernel v3.1 smart account address to register.
    function register(address account) external onlyOwner {
        require(account != address(0), "Zero address");
        require(!accounts[account].isRegistered, "Already registered");
        accounts[account] = AccountInfo({ isRegistered: true, registeredAt: block.timestamp });
        registeredAccounts.push(account);
        activeAccountCount++;
        emit AccountRegistered(account, block.timestamp);
    }

    /// @notice Deregister a smart account from the SnowMind system.
    /// @param account The smart account address to deregister.
    function deregister(address account) external onlyOwner {
        require(account != address(0), "Zero address");
        require(accounts[account].isRegistered, "Not registered");
        accounts[account].isRegistered = false;
        activeAccountCount--;
        emit AccountDeregistered(account, block.timestamp);
    }

    /// @notice Configure a protocol address for on-chain rebalance logging.
    /// @param protocol Protocol contract address.
    /// @param isAllowed True to allow logging with this protocol, false to block.
    function setProtocolAllowed(address protocol, bool isAllowed) external onlyOwner {
        require(protocol != address(0), "Zero protocol");
        allowedProtocols[protocol] = isAllowed;
        emit ProtocolAllowlistUpdated(protocol, isAllowed);
    }

    /// @notice Batch configure protocol allowlist entries.
    /// @param protocols Protocol contract addresses to update.
    /// @param isAllowed True to allow all supplied protocols, false to block.
    function setProtocolAllowlist(address[] calldata protocols, bool isAllowed) external onlyOwner {
        for (uint256 i = 0; i < protocols.length; i++) {
            address protocol = protocols[i];
            require(protocol != address(0), "Zero protocol");
            allowedProtocols[protocol] = isAllowed;
            emit ProtocolAllowlistUpdated(protocol, isAllowed);
        }
    }

    // ── Rebalance logging (owner-gated) ──────────────────────────────────────

    /// @notice Log a rebalance event on-chain for transparency.
    /// @param smartAccount The user's Kernel smart account. Must be registered.
    /// @param fromProtocol Protocol funds are leaving.
    /// @param toProtocol Protocol funds are entering.
    /// @param amount USDC amount (6 decimals).
    function logRebalance(
        address smartAccount,
        address fromProtocol,
        address toProtocol,
        uint256 amount
    ) external onlyOwner {
        require(smartAccount != address(0), "Invalid account");
        require(accounts[smartAccount].isRegistered, "Account not registered");
        require(fromProtocol != address(0), "Invalid fromProtocol");
        require(toProtocol != address(0), "Invalid toProtocol");
        require(allowedProtocols[fromProtocol], "fromProtocol not allowed");
        require(allowedProtocols[toProtocol], "toProtocol not allowed");
        require(fromProtocol != toProtocol, "Same protocol");
        require(amount > 0, "Zero amount");
        emit RebalanceLogged(smartAccount, fromProtocol, toProtocol, amount, block.timestamp);
    }

    // ── View functions ───────────────────────────────────────────────────────

    /// @notice Check if an account is currently registered.
    /// @param account The address to check.
    /// @return True if the account is registered.
    function isRegistered(address account) external view returns (bool) {
        return accounts[account].isRegistered;
    }

    /// @notice Live count of currently active accounts (deregistered = excluded).
    /// @return The number of active accounts.
    function getActiveCount() external view returns (uint256) {
        return activeAccountCount;
    }

    /// @notice Total accounts ever registered including deregistered.
    /// @return The length of the historical registeredAccounts array.
    function getHistoricalCount() external view returns (uint256) {
        return registeredAccounts.length;
    }

    // ── Two-step ownership transfer ──────────────────────────────────────────

    /// @notice Step 1: propose ownership transfer. Does not take effect immediately.
    /// @param newOwner The proposed new owner address.
    function proposeOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        require(newOwner != owner, "Already owner");
        pendingOwner = newOwner;
        emit OwnershipTransferProposed(owner, newOwner);
    }

    /// @notice Step 2: new owner accepts. Only callable by pendingOwner.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /// @notice Cancel a pending ownership proposal. Only callable by current owner.
    function cancelOwnershipProposal() external onlyOwner {
        pendingOwner = address(0);
    }
}

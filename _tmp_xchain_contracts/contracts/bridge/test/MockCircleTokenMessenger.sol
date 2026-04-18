// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "wormhole-sdk/interfaces/cctp/ITokenMessenger.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockCircleTokenMessenger is ITokenMessenger {
    event DepositForBurnWithCaller(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller
    );

    uint64 private _nonce;

    function setNonce(uint64 newNonce) external {
        _nonce = newNonce;
    }

    function transferOwnership(address) external {}

    function acceptOwnership() external override {}

    function owner() external pure returns (address) {
        return address(0);
    }

    function pendingOwner() external pure returns (address) {
        return address(0);
    }

    function messageBodyVersion() external pure returns (uint32) {
        return 0;
    }

    function localMessageTransmitter() external pure returns (IMessageTransmitter) {
        return IMessageTransmitter(address(0));
    }

    function localMinter() external pure returns (ITokenMinter) {
        return ITokenMinter(address(0));
    }

    function remoteTokenMessengers(uint32) external pure returns (bytes32) {
        return bytes32(0);
    }

    function depositForBurn(uint256, uint32, bytes32, address) external pure returns (uint64) {
        return 0;
    }

    function depositForBurnWithCaller(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller
    ) external override returns (uint64 nonce) {
        SafeERC20.safeTransferFrom(IERC20(burnToken), msg.sender, address(this), amount);
        emit DepositForBurnWithCaller(amount, destinationDomain, mintRecipient, burnToken, destinationCaller);
        nonce = _nonce;
    }

    function replaceDepositForBurn(bytes calldata, bytes calldata, bytes32, bytes32) external {}

    function handleReceiveMessage(uint32, bytes32, bytes calldata) external pure returns (bool) {
        return false;
    }

    function addRemoteTokenMessenger(uint32, bytes32) external {}

    function removeRemoteTokenMessenger(uint32) external {}

    function addLocalMinter(address newLocalMinter) external {}

    function removeLocalMinter() external {}
}

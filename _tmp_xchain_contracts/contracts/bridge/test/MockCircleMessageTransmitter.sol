// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "wormhole-sdk/interfaces/cctp/IMessageTransmitter.sol";

contract MockCircleMessageTransmitter is IMessageTransmitter {
    event ReceiveMessage(bytes message, bytes attestation);

    bool private _success = true;
    address private _token;
    address private _recipient;
    uint256 private _amount;

    function setSuccess(bool newSuccess) external {
        _success = newSuccess;
    }

    function setToken(address newToken) external {
        _token = newToken;
    }

    function setRecipient(address newRecipient) external {
        _recipient = newRecipient;
    }

    function setAmount(uint256 newAmount) external {
        _amount = newAmount;
    }

    function attesterManager() external pure returns (address) {
        return address(0);
    }

    function isEnabledAttester(address) external pure returns (bool) {
        return false;
    }

    function getNumEnabledAttesters() external pure returns (uint256) {
        return 0;
    }

    function getEnabledAttester(uint256) external pure returns (address) {
        return address(0);
    }

    function updateAttesterManager(address) external {}

    function setSignatureThreshold(uint256) external {}

    function enableAttester(address) external {}

    function disableAttester(address) external {}

    function paused() external pure returns (bool) {
        return false;
    }

    function pauser() external pure returns (address) {
        return address(0);
    }

    function pause() external {}

    function unpause() external {}

    function updatePauser(address) external {}

    function transferOwnership(address) external {}

    function acceptOwnership() external override {}

    function owner() external pure returns (address) {
        return address(0);
    }

    function pendingOwner() external pure returns (address) {
        return address(0);
    }

    function localDomain() external pure returns (uint32) {
        return 0;
    }

    function version() external pure returns (uint32) {
        return 0;
    }

    function maxMessageBodySize() external pure returns (uint256) {
        return 0;
    }

    function nextAvailableNonce() external pure returns (uint64) {
        return 0;
    }

    function usedNonces(bytes32) external pure returns (bool) {
        return false;
    }

    function sendMessage(uint32, bytes32, bytes calldata) external pure override returns (uint64) {
        return 0;
    }

    function sendMessageWithCaller(uint32, bytes32, bytes32, bytes calldata) external pure override returns (uint64) {
        return 0;
    }

    function replaceMessage(bytes calldata, bytes calldata, bytes calldata, bytes32) external override {}

    function receiveMessage(
        bytes calldata message,
        bytes calldata attestation
    ) external override returns (bool success) {
        SafeERC20.safeTransfer(IERC20(_token), _recipient, _amount);
        emit ReceiveMessage(message, attestation);
        success = _success;
    }

    function setMaxMessageBodySize(uint256 newMaxMessageBodySize) external {}
}

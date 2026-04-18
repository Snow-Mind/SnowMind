// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "wormhole-sdk/interfaces/ICoreBridge.sol";

contract MockWormhole is ICoreBridge {
    uint256 private _messageFee;
    uint64 private _sequence;
    uint16 private _chainId;
    GuardianSet private _guardianSet;

    event PublishMessage(uint256 msgValue, uint32 nonce, bytes payload, uint8 consistencyLevel);

    function setMessageFee(uint256 newMessageFee) external {
        _messageFee = newMessageFee;
    }

    function setSequence(uint64 newSequence) external {
        _sequence = newSequence;
    }

    function setChainId(uint16 newChainId) external {
        _chainId = newChainId;
    }

    function setGuardianSet(GuardianSet memory newGuardianSet) external {
        _guardianSet = newGuardianSet;
    }

    function messageFee() external view returns (uint256) {
        return _messageFee;
    }

    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence) {
        sequence = _sequence;
        emit PublishMessage(msg.value, nonce, payload, consistencyLevel);
    }

    function parseAndVerifyVM(
        bytes calldata
    ) external pure returns (CoreBridgeVM memory vm, bool valid, string memory reason) {}

    function chainId() external view returns (uint16) {
        return _chainId;
    }

    function nextSequence(address) external pure returns (uint64) {
        return 0;
    }

    function getGuardianSet(uint32) external view returns (GuardianSet memory) {
        return _guardianSet;
    }

    function getCurrentGuardianSetIndex() external pure returns (uint32) {
        return 1;
    }
}

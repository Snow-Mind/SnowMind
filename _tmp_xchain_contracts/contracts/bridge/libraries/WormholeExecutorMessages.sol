// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@solidity-bytes-utils/contracts/BytesLib.sol";

import "./Messages.sol";

library WormholeExecutorMessages {
    using BytesLib for bytes;

    struct WormholeExecutorMetadata {
        uint16 wormholeTargetChainId;
        uint128 receiverValue;
        Messages.MessageMetadata messageMetadata;
    }

    function encodePayloadWithWormholeExecutorMetadata(
        uint16 wormholeTargetChainId,
        uint128 receiverValue,
        Messages.MessageToSend memory message
    ) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                wormholeTargetChainId,
                receiverValue,
                message.params.returnAdapterId,
                message.params.returnGasLimit,
                message.sender,
                message.handler,
                message.payload
            );
    }

    function decodePayloadWithWormholeExecutorMetadata(
        bytes memory serialized
    ) internal pure returns (WormholeExecutorMetadata memory wormholeExecutorMetadata, bytes memory payload) {
        uint256 index = 0;
        wormholeExecutorMetadata.wormholeTargetChainId = serialized.toUint16(index);
        index += 2;
        wormholeExecutorMetadata.receiverValue = serialized.toUint128(index);
        index += 16;

        Messages.MessageMetadata memory metadata;
        metadata.returnAdapterId = serialized.toUint16(index);
        index += 2;
        metadata.returnGasLimit = serialized.toUint256(index);
        index += 32;
        metadata.sender = serialized.toBytes32(index);
        index += 32;
        metadata.handler = serialized.toBytes32(index);
        index += 32;
        wormholeExecutorMetadata.messageMetadata = metadata;

        payload = serialized.slice(index, serialized.length - index);
    }
}

import { ethers } from "hardhat";
import { BYTES32_LENGTH, UINT128_LENGTH, UINT16_LENGTH, UINT256_LENGTH, convertNumberToBytes } from "../bytes";
import { MessageToSend, MessageMetadata } from "./messages";

export function encodePayloadWithWormholeExecutorMetadata(
  wormholeTargetChainId: number | bigint,
  message: MessageToSend
): string {
  return ethers.concat([
    convertNumberToBytes(wormholeTargetChainId, UINT16_LENGTH),
    convertNumberToBytes(message.params.receiverValue, UINT128_LENGTH),
    convertNumberToBytes(message.params.returnAdapterId, UINT16_LENGTH),
    convertNumberToBytes(message.params.returnGasLimit, UINT256_LENGTH),
    message.sender,
    message.handler,
    message.payload,
  ]);
}

export interface WormholeExecutorMetadata {
  wormholeTargetChainId: bigint;
  receiverValue: bigint;
  messageMetadata: MessageMetadata;
}

export interface PayloadWithWormholeExecutorMetadata {
  metadata: WormholeExecutorMetadata;
  payload: string;
}

export function decodePayloadWithWormholeExecutorMetadata(serialised: string): PayloadWithWormholeExecutorMetadata {
  let index = 0;
  const wormholeTargetChainId = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT16_LENGTH), 16));
  index += UINT16_LENGTH;
  const receiverValue = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT128_LENGTH), 16));
  index += UINT128_LENGTH;
  const returnAdapterId = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT16_LENGTH), 16));
  index += UINT16_LENGTH;
  const returnGasLimit = BigInt(parseInt(ethers.dataSlice(serialised, index, index + UINT256_LENGTH), 16));
  index += UINT256_LENGTH;
  const sender = ethers.dataSlice(serialised, index, index + BYTES32_LENGTH);
  index += BYTES32_LENGTH;
  const handler = ethers.dataSlice(serialised, index, index + BYTES32_LENGTH);
  index += BYTES32_LENGTH;
  const payload = ethers.dataSlice(serialised, index);
  return {
    metadata: {
      wormholeTargetChainId,
      receiverValue,
      messageMetadata: { returnAdapterId, returnGasLimit, sender, handler },
    },
    payload,
  };
}

import { ethers } from "hardhat";
import {
  BYTES32_LENGTH,
  UINT128_LENGTH,
  UINT16_LENGTH,
  UINT64_LENGTH,
  UINT8_LENGTH,
  convertNumberToBytes,
  convertStringToBytes,
} from "../bytes";

const REQ_VAA_V1 = convertStringToBytes("ERV1");
const RECV_INST_TYPE_GAS = convertNumberToBytes(1, UINT8_LENGTH);

export function encodeVaaMultiSigRequest(
  emitterChainId: number | bigint,
  emitterAddress: string,
  sequence: number | bigint
): string {
  return ethers.concat([
    REQ_VAA_V1,
    convertNumberToBytes(emitterChainId, UINT16_LENGTH),
    emitterAddress,
    convertNumberToBytes(sequence, UINT64_LENGTH),
  ]);
}

export function encodeGas(gasLimit: number | bigint, msgValue: number | bigint): string {
  return ethers.concat([
    RECV_INST_TYPE_GAS,
    convertNumberToBytes(gasLimit, UINT128_LENGTH),
    convertNumberToBytes(msgValue, UINT128_LENGTH),
  ]);
}

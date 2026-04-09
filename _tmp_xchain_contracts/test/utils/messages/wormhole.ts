import { ethers } from "hardhat";
import { BaseWallet } from "ethers";
import {
  UINT16_LENGTH,
  UINT32_LENGTH,
  UINT64_LENGTH,
  UINT8_LENGTH,
  convertNumberToBytes,
  getRandomBytes,
} from "../bytes";
import { WormholeFinality } from "../wormhole";

const NUM_SIGNATURES = 1;
const SIGNATURE_RECOVERY_MAGIC = 27;

// only supports 1 signature
export function encodeWormholeVAA(
  guardian: BaseWallet,
  emitterChainId: number | bigint,
  emitterAddress: string,
  sequence: number | bigint,
  consistencyLevel: WormholeFinality,
  payload: string,
  vaaVersion = 1,
  skipSignatures = false,
  incorrectSignature = false
): { digest: string; vaa: string } {
  const body = ethers.concat([
    convertNumberToBytes(0, UINT32_LENGTH), // timestamp
    convertNumberToBytes(0, UINT32_LENGTH), // nonce
    convertNumberToBytes(emitterChainId, UINT16_LENGTH),
    emitterAddress,
    convertNumberToBytes(sequence, UINT64_LENGTH),
    convertNumberToBytes(consistencyLevel, UINT8_LENGTH),
    payload,
  ]);

  const digest = ethers.keccak256(ethers.keccak256(body));
  const signature = guardian.signingKey.sign(digest);
  const signatureBytes = incorrectSignature
    ? getRandomBytes(65)
    : ethers.concat([
        signature.r,
        signature.s,
        // https://github.com/wormhole-foundation/wormhole/blob/c35940ae9689f6df9e983d51425763509b74a80f/ethereum/contracts/Messages.sol#L174
        convertNumberToBytes(signature.v - SIGNATURE_RECOVERY_MAGIC, UINT8_LENGTH),
      ]);
  const signaturesBytes = skipSignatures
    ? convertNumberToBytes(0, UINT8_LENGTH)
    : ethers.concat([
        convertNumberToBytes(NUM_SIGNATURES, UINT8_LENGTH),
        convertNumberToBytes(0, UINT8_LENGTH), // index of guardian in the guardian set
        signatureBytes,
      ]);

  const header = ethers.concat([
    convertNumberToBytes(vaaVersion, UINT8_LENGTH), // version
    convertNumberToBytes(1, UINT32_LENGTH), // guardian set index
    signaturesBytes,
  ]);

  const vaa = ethers.concat([header, body]);
  return { digest, vaa };
}

import {
  createWalletClient,
  custom,
  parseUnits,
  type EIP1193Provider,
} from "viem";

import { CHAIN } from "@/lib/constants";

type WalletLike = {
  getEthereumProvider: () => Promise<unknown>;
};

export type WithdrawalSignaturePayload = {
  ownerSignature: string;
  signatureMessage: string;
  signatureTimestamp: number;
  ownerAddress: string;
};

export function buildWithdrawalAuthorizationMessage(params: {
  smartAccountAddress: string;
  ownerAddress: string;
  withdrawAmount: string;
  isFullWithdrawal: boolean;
  signatureTimestamp: number;
}): string {
  const withdrawAmountRaw = parseUnits(params.withdrawAmount, 6).toString();

  return [
    "SnowMind Withdrawal Authorization",
    `Smart Account: ${params.smartAccountAddress.toLowerCase()}`,
    `Owner: ${params.ownerAddress.toLowerCase()}`,
    `Withdraw Amount (microUSDC): ${withdrawAmountRaw}`,
    `Full Withdrawal: ${params.isFullWithdrawal ? "true" : "false"}`,
    `Chain ID: ${CHAIN.id}`,
    `Timestamp: ${params.signatureTimestamp}`,
  ].join("\n");
}

export async function signWithdrawalAuthorization(
  wallet: WalletLike,
  params: {
    smartAccountAddress: string;
    withdrawAmount: string;
    isFullWithdrawal: boolean;
  },
): Promise<WithdrawalSignaturePayload> {
  const provider = await wallet.getEthereumProvider() as EIP1193Provider;

  const walletClient = createWalletClient({
    chain: CHAIN,
    transport: custom(provider),
  });

  const [ownerAddress] = await walletClient.getAddresses();
  const signatureTimestamp = Math.floor(Date.now() / 1000);

  const signatureMessage = buildWithdrawalAuthorizationMessage({
    smartAccountAddress: params.smartAccountAddress,
    ownerAddress,
    withdrawAmount: params.withdrawAmount,
    isFullWithdrawal: params.isFullWithdrawal,
    signatureTimestamp,
  });

  const ownerSignature = await walletClient.signMessage({
    account: ownerAddress,
    message: signatureMessage,
  });

  return {
    ownerSignature,
    signatureMessage,
    signatureTimestamp,
    ownerAddress,
  };
}

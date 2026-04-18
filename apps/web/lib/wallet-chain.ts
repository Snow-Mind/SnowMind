import { AVALANCHE_RPC_URLS, CHAIN, EXPLORER } from "@/lib/constants";

type ProviderRequestArgs = {
  method: string;
  params?: unknown[];
};

export type Eip1193Provider = {
  request: (args: ProviderRequestArgs) => Promise<unknown>;
};

export type WalletRequestRunner = <T>(request: Promise<T>, actionLabel: string) => Promise<T>;

const CHAIN_MISSING_ERROR_HINTS = [
  "unrecognized chain id",
  "unknown chain",
  "chain not added",
  "try adding the chain",
  "wallet_addethereumchain",
  "does not exist",
];

function errorCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const value = (err as { code: unknown }).code;
  return typeof value === "number" ? value : null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isChainMissingError(err: unknown): boolean {
  const code = errorCode(err);
  if (code === 4902 || code === -32603) return true;

  const message = errorMessage(err).toLowerCase();
  return CHAIN_MISSING_ERROR_HINTS.some((hint) => message.includes(hint));
}

function isChainAlreadyAddedError(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return message.includes("already") && message.includes("chain");
}

async function runProviderRequest<T>(
  provider: Eip1193Provider,
  args: ProviderRequestArgs,
  actionLabel: string,
  runner?: WalletRequestRunner,
): Promise<T> {
  const request = provider.request(args) as Promise<T>;
  if (runner) return runner(request, actionLabel);
  return request;
}

export async function ensureWalletOnAvalancheChain(
  provider: Eip1193Provider,
  runner?: WalletRequestRunner,
): Promise<void> {
  const hexChainId = `0x${CHAIN.id.toString(16)}` as const;

  try {
    await runProviderRequest(
      provider,
      {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexChainId }],
      },
      "Network switch",
      runner,
    );
    return;
  } catch (switchErr: unknown) {
    if (!isChainMissingError(switchErr)) {
      throw switchErr;
    }
  }

  try {
    await runProviderRequest(
      provider,
      {
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexChainId,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: AVALANCHE_RPC_URLS,
          blockExplorerUrls: [EXPLORER.base],
        }],
      },
      "Add Avalanche network",
      runner,
    );
  } catch (addErr: unknown) {
    if (!isChainAlreadyAddedError(addErr)) {
      throw addErr;
    }
  }

  try {
    await runProviderRequest(
      provider,
      {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexChainId }],
      },
      "Network switch",
      runner,
    );
  } catch {
    throw new Error(
      "Failed to switch to Avalanche network. Please manually switch your wallet to Avalanche C-Chain and retry.",
    );
  }
}

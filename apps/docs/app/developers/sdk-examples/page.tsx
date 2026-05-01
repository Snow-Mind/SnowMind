import type { Metadata } from "next";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "SDK Examples",
  description: "Code examples for integrating SnowMind. TypeScript and Python samples.",
};

export default function SDKExamplesPage() {
  return (
    <article className="prose max-w-none">
      <h1>SDK & Code Examples</h1>
      <p className="lead">
        Example integrations for agents or backend services. These snippets show how to deposit and withdraw using the SnowMind API.
      </p>

      <h2>TypeScript / JavaScript</h2>

      <h3>Basic Client</h3>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`import axios from "axios";

const SNOWMIND_API = "https://api.snowmind.xyz/api/v1";

export class SnowMindClient {
  constructor(private authToken: string) {}

  private headers() {
    return {
      Authorization: \`Bearer \${this.authToken}\`,
      "Content-Type": "application/json",
    };
  }

  async deposit(address: string, payload: {
    allowedProtocols: string[];
    fundingTxHash: string;
    fundingAmountUsdc: string;
    allocationCaps?: Record<string, number>;
    triggerRebalance?: boolean;
  }) {
    return axios.post(
      \`\${SNOWMIND_API}/accounts/\${address}/deposit\`,
      {
        ...payload,
        triggerRebalance: payload.triggerRebalance !== false,
      },
      { headers: this.headers() }
    ).then((res) => res.data);
  }

  async previewWithdrawal(address: string, payload: {
    smartAccountAddress: string;
    withdrawAmount: string;
    isFullWithdrawal: boolean;
  }) {
    return axios.post(
      \`\${SNOWMIND_API}/withdrawals/preview\`,
      payload,
      { headers: this.headers() }
    ).then((res) => res.data);
  }

  async executeWithdrawal(payload: {
    smartAccountAddress: string;
    withdrawAmount: string;
    isFullWithdrawal: boolean;
    ownerSignature: string;
    signatureMessage: string;
    signatureTimestamp: number;
  }) {
    return axios.post(
      \`\${SNOWMIND_API}/withdrawals/execute\`,
      payload,
      { headers: this.headers() }
    ).then((res) => res.data);
  }
}`}</code>
      </pre>

      <h3>Withdrawal Signature Flow</h3>
      <p>
        The owner wallet must sign the authorization message each time. The agent can request a signature from the user wallet and then call the execute endpoint.
      </p>

      <Callout variant="warning" title="Signatures Are Required">
        A withdrawal cannot be executed without an owner signature. Agents need access to wallet signing (WalletConnect, extension, or user approval).
      </Callout>

      <h2>Python</h2>

      <h3>Basic Client</h3>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`import requests

class SnowMindClient:
    def __init__(self, token: str):
        self.base = "https://api.snowmind.xyz/api/v1"
        self.headers = {"Authorization": f"Bearer {token}"}

    def deposit(self, address, payload):
        url = f"{self.base}/accounts/{address}/deposit"
        res = requests.post(url, json=payload, headers=self.headers)
        res.raise_for_status()
        return res.json()

    def preview_withdrawal(self, payload):
        url = f"{self.base}/withdrawals/preview"
        res = requests.post(url, json=payload, headers=self.headers)
        res.raise_for_status()
        return res.json()

    def execute_withdrawal(self, payload):
        url = f"{self.base}/withdrawals/execute"
        res = requests.post(url, json=payload, headers=self.headers)
        res.raise_for_status()
        return res.json()`}</code>
      </pre>

      <h2>Getting the Privy Token</h2>
      <p>
        The agent needs a valid Privy session token for the user. You can obtain it after login from your app backend or from the browser session.
      </p>

      <Callout variant="info" title="Security Tip">
        Never store tokens or wallet keys in plaintext. Use secure storage and rotate tokens regularly.
      </Callout>
    </article>
  );
}

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
        Get started with SnowMind integration using TypeScript or Python. Copy and adapt these examples for your use case.
      </p>

      <h2>TypeScript / JavaScript</h2>

      <h3>Setup</h3>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`npm install axios
# or yarn add axios`}</code>
      </pre>

      <h3>Basic Client</h3>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`import axios from 'axios';

const SNOWMIND_API = 'https://api.snowmind.xyz/api/v1';

class SnowMindClient {
  private authToken: string;

  constructor(authToken: string) {
    this.authToken = authToken;
  }

  private headers() {
    return {
      'Authorization': \`Bearer \${this.authToken}\`,
      'Content-Type': 'application/json',
    };
  }

  async getPortfolio(address: string) {
    const res = await axios.get(
      \`\${SNOWMIND_API}/portfolio/\${address}\`,
      { headers: this.headers() }
    );
    return res.data;
  }

  async deposit(
    address: string,
    req: {
      allowedProtocols: string[];
      fundingTxHash: string;
      fundingAmountUsdc: string;
      allocationCaps?: Record<string, number>;
      triggerRebalance?: boolean;
    }
  ) {
    const res = await axios.post(
      \`\${SNOWMIND_API}/accounts/\${address}/deposit\`,
      {
        allowedProtocols: req.allowedProtocols,
        fundingTxHash: req.fundingTxHash,
        fundingAmountUsdc: req.fundingAmountUsdc,
        allocationCaps: req.allocationCaps || {},
        triggerRebalance: req.triggerRebalance !== false,
      },
      { headers: this.headers() }
    );
    return res.data;
  }

  async previewWithdrawal(
    address: string,
    withdrawAmountUsdc: string,
    withdrawAll: boolean = false
  ) {
    const res = await axios.post(
      \`\${SNOWMIND_API}/accounts/\${address}/withdraw/preview\`,
      { withdrawAmountUsdc, withdrawAll },
      { headers: this.headers() }
    );
    return res.data;
  }

  async executeWithdrawal(
    address: string,
    req: {
      withdrawAmountUsdc?: string;
      withdrawAll?: boolean;
      ownerSignature: string;
    }
  ) {
    const res = await axios.post(
      \`\${SNOWMIND_API}/accounts/\${address}/withdraw\`,
      req,
      { headers: this.headers() }
    );
    return res.data;
  }

  async updateProtocols(address: string, allowedProtocols: string[]) {
    const res = await axios.put(
      \`\${SNOWMIND_API}/accounts/\${address}/allowed-protocols\`,
      { allowedProtocols },
      { headers: this.headers() }
    );
    return res.data;
  }

  async updateAllocationCaps(
    address: string,
    allocationCaps: Record<string, number>
  ) {
    const res = await axios.put(
      \`\${SNOWMIND_API}/accounts/\${address}/allocation-caps\`,
      { allocationCaps },
      { headers: this.headers() }
    );
    return res.data;
  }
}

export default SnowMindClient;`}</code>
      </pre>

      <h3>Usage Example</h3>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`// Initialize client with Privy auth token
const client = new SnowMindClient(PRIVY_AUTH_TOKEN);

// Fetch portfolio
const portfolio = await client.getPortfolio('0x...');
console.log(\`Total Yield: $\${portfolio.totalYieldUsd}\`);

// Deposit 1000 USDC split between Aave and Benqi
const depositRes = await client.deposit('0x...', {
  allowedProtocols: ['aave', 'benqi'],
  fundingTxHash: '0xabcd1234...',
  fundingAmountUsdc: '1000.00',
  allocationCaps: {
    aave: 60,
    benqi: 40,
  },
});
console.log('Protocols updated:', depositRes.allowedProtocols);

// Preview a withdrawal
const preview = await client.previewWithdrawal('0x...', '500.00');
console.log(\`Fee: $\${preview.feeAmountUsdc}\`);
console.log(\`Net Proceeds: $\${preview.netProceeds}\`);`}</code>
      </pre>

      <h2>Python</h2>

      <h3>Setup</h3>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`pip install requests`}</code>
      </pre>

      <h3>Basic Client</h3>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`import requests
import json
from typing import Optional, Dict, Any

class SnowMindClient:
    def __init__(self, auth_token: str):
        self.auth_token = auth_token
        self.base_url = 'https://api.snowmind.xyz/api/v1'
        self.headers = {
            'Authorization': f'Bearer {auth_token}',
            'Content-Type': 'application/json',
        }

    def get_portfolio(self, address: str) -> Dict[str, Any]:
        url = f'{self.base_url}/portfolio/{address}'
        res = requests.get(url, headers=self.headers)
        res.raise_for_status()
        return res.json()

    def deposit(
        self,
        address: str,
        allowed_protocols: list,
        funding_tx_hash: str,
        funding_amount_usdc: str,
        allocation_caps: Optional[Dict[str, int]] = None,
        trigger_rebalance: bool = True,
    ) -> Dict[str, Any]:
        url = f'{self.base_url}/accounts/{address}/deposit'
        payload = {
            'allowedProtocols': allowed_protocols,
            'fundingTxHash': funding_tx_hash,
            'fundingAmountUsdc': funding_amount_usdc,
            'allocationCaps': allocation_caps or {},
            'triggerRebalance': trigger_rebalance,
        }
        res = requests.post(url, json=payload, headers=self.headers)
        res.raise_for_status()
        return res.json()

    def preview_withdrawal(
        self,
        address: str,
        withdraw_amount_usdc: str,
        withdraw_all: bool = False,
    ) -> Dict[str, Any]:
        url = f'{self.base_url}/accounts/{address}/withdraw/preview'
        payload = {
            'withdrawAmountUsdc': withdraw_amount_usdc,
            'withdrawAll': withdraw_all,
        }
        res = requests.post(url, json=payload, headers=self.headers)
        res.raise_for_status()
        return res.json()

    def update_protocols(
        self,
        address: str,
        allowed_protocols: list,
    ) -> Dict[str, Any]:
        url = f'{self.base_url}/accounts/{address}/allowed-protocols'
        payload = {'allowedProtocols': allowed_protocols}
        res = requests.put(url, json=payload, headers=self.headers)
        res.raise_for_status()
        return res.json()

    def update_allocation_caps(
        self,
        address: str,
        allocation_caps: Dict[str, int],
    ) -> Dict[str, Any]:
        url = f'{self.base_url}/accounts/{address}/allocation-caps'
        payload = {'allocationCaps': allocation_caps}
        res = requests.put(url, json=payload, headers=self.headers)
        res.raise_for_status()
        return res.json()


# Usage
if __name__ == '__main__':
    PRIVY_AUTH_TOKEN = 'YOUR_TOKEN_HERE'
    client = SnowMindClient(PRIVY_AUTH_TOKEN)

    # Get portfolio
    portfolio = client.get_portfolio('0x...')
    print(f"Total Yield: \${portfolio['totalYieldUsd']}")

    # Deposit
    result = client.deposit(
        '0x...',
        allowed_protocols=['aave', 'benqi'],
        funding_tx_hash='0xabcd1234...',
        funding_amount_usdc='1000.00',
        allocation_caps={'aave': 60, 'benqi': 40},
    )
    print('Deposit recorded:', result['fundingRecorded'])`}</code>
      </pre>

      <h2>Getting Your Privy Auth Token</h2>
      <p>
        After logging into SnowMind with Privy, extract your token from the browser:
      </p>
      <ol>
        <li>Open DevTools (F12)</li>
        <li>Go to <strong>Application</strong> → <strong>Cookies</strong></li>
        <li>Find the cookie that starts with <code>privy-</code> and contains your JWT</li>
        <li>Alternatively, check <strong>Application</strong> → <strong>Local Storage</strong> for <code>privy_session</code></li>
      </ol>

      <Callout variant="warning" title="Never Share Your Token">
        Your auth token grants full access to your account. Never hardcode it in production. Use environment variables or a secrets manager.
      </Callout>

      <h2>Error Handling</h2>
      <p>
        Always wrap API calls in try-catch and implement retry logic:
      </p>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.response?.status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
      } else if (err.response?.status >= 400 && err.response?.status < 500) {
        throw err; // Don't retry client errors
      } else {
        throw err;
      }
    }
  }
}

// Usage
const portfolio = await withRetry(() => client.getPortfolio(address));`}</code>
      </pre>

      <h2>Next Steps</h2>
      <ul>
        <li>Check the <strong>API Endpoints Reference</strong> for all available methods</li>
        <li>Join our Discord for support and updates</li>
        <li>Submit feedback or bug reports on GitHub</li>
      </ul>
    </article>
  );
}

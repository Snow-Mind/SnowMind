import { createPublicClient, http } from 'viem';
import { avalanche } from 'viem/chains';

const client = createPublicClient({ chain: avalanche, transport: http('https://api.avax.network/ext/bc/C/rpc') });
const ACCOUNT = '0x6d6F6eE22f627f9406E4922970de12f9949be0A6';

// Read the raw accountId
const accountIdAbi = [{name: 'accountId', type: 'function', stateMutability: 'view', inputs: [], outputs: [{type: 'string'}]}];
const accountId = await client.readContract({ address: ACCOUNT, abi: accountIdAbi, functionName: 'accountId' });
console.log('Raw accountId:', JSON.stringify(accountId));

// Now import and test accountMetadata
try {
  const { accountMetadata } = await import('@zerodev/sdk/accounts');
  const result = await accountMetadata(client, ACCOUNT, '0.3.1');
  console.log('accountMetadata result:', JSON.stringify(result));
} catch(e) {
  console.log('accountMetadata import error:', e.message);
  // Try alternative import
  try {
    const sdk = await import('@zerodev/sdk');
    console.log('SDK exports:', Object.keys(sdk).filter(k => k.includes('Meta') || k.includes('meta') || k.includes('account')));
  } catch(e2) {
    console.log('SDK import error:', e2.message);
  }
}

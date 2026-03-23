import { createPublicClient, http } from 'viem';
import { avalanche } from 'viem/chains';

const ACCOUNT = '0x6d6F6eE22f627f9406E4922970de12f9949be0A6';
const RPC = 'https://api.avax.network/ext/bc/C/rpc';

const client = createPublicClient({ chain: avalanche, transport: http(RPC) });

const accountIdAbi = [{ name: 'accountId', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }];
const currentNonceAbi = [{ name: 'currentNonce', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] }];
const rootValidatorAbi = [{ name: 'rootValidator', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes21' }] }];
const validNonceFromAbi = [{ name: 'validNonceFrom', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] }];

try {
  const [accountId, currentNonce, rootValidator, validNonceFrom, code] = await Promise.all([
    client.readContract({ address: ACCOUNT, abi: accountIdAbi, functionName: 'accountId' }),
    client.readContract({ address: ACCOUNT, abi: currentNonceAbi, functionName: 'currentNonce' }),
    client.readContract({ address: ACCOUNT, abi: rootValidatorAbi, functionName: 'rootValidator' }),
    client.readContract({ address: ACCOUNT, abi: validNonceFromAbi, functionName: 'validNonceFrom' }),
    client.getBytecode({ address: ACCOUNT }),
  ]);
  const deployed = (code && code.length > 2) ? 'YES' : 'NO';
  console.log('=== On-Chain Smart Account State ===');
  console.log('Address:', ACCOUNT);
  console.log('Deployed:', deployed);
  console.log('Account ID:', accountId);
  console.log('Current Nonce:', currentNonce.toString());
  console.log('Valid Nonce From:', validNonceFrom.toString());
  console.log('Root Validator (hex):', rootValidator);
} catch (e) {
  console.error('Error:', e.message);
}

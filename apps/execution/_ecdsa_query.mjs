import { createPublicClient, http, keccak256, encodePacked } from 'viem';
import { avalanche } from 'viem/chains';

const ACCOUNT = '0x6d6F6eE22f627f9406E4922970de12f9949be0A6';
const ECDSA_VALIDATOR = '0x845adb2c711129d4f3966735ed98a9f09fc4ce57';
const RPC = 'https://api.avax.network/ext/bc/C/rpc';

const client = createPublicClient({ chain: avalanche, transport: http(RPC) });

const abi = [
  { name: 'ecdsaValidatorStorage', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'address' }] }
];

try {
  const owner = await client.readContract({ address: ECDSA_VALIDATOR, abi, functionName: 'ecdsaValidatorStorage', args: [ACCOUNT] });
  console.log('=== ECDSA Validator Owner Query ===');
  console.log('Smart Account:', ACCOUNT);
  console.log('ECDSA Validator Module:', ECDSA_VALIDATOR);
  console.log('Stored Owner:', owner);
} catch (e) {
  console.log('ecdsaValidatorStorage failed:', e.message?.slice(0, 500));
  try {
    const abi2 = [{ name: 'getOwner', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'address' }] }];
    const owner = await client.readContract({ address: ECDSA_VALIDATOR, abi: abi2, functionName: 'getOwner', args: [ACCOUNT] });
    console.log('getOwner result:', owner);
  } catch(e2) {
    console.log('getOwner also failed:', e2.message?.slice(0, 500));
    const slot = keccak256(encodePacked(['address', 'uint256'], [ACCOUNT, 0n]));
    const raw = await client.getStorageAt({ address: ECDSA_VALIDATOR, slot });
    console.log('Raw storage slot 0 mapping for account:', raw);
    const zeroVal = '0x0000000000000000000000000000000000000000000000000000000000000000';
    if (raw && raw !== zeroVal) {
      const ownerAddr = '0x' + raw.slice(26);
      console.log('Extracted owner address:', ownerAddr);
    }
  }
}

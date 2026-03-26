import { createPublicClient, http, keccak256, encodePacked, parseAbi } from 'viem';
import { avalanche } from 'viem/chains';

const ACCOUNT = '0x6d6F6eE22f627f9406E4922970de12f9949be0A6';
const EOA = '0x97950A98980a2Fc61ea7eb043bb7666845f77071';
const ECDSA_VALIDATOR = '0x845adb2c711129d4f3966735ed98a9f09fc4ce57';
const USDC = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const RPC = 'https://api.avax.network/ext/bc/C/rpc';

// Protocol vaults
const AAVE_POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const BENQI_QIUSDC = '0xB715808a78F6041E46d61Cb123C9B4A27056AE9C';
const SPARK_VAULT = '0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d';
const EULER_VAULT = '0x7AC1DF3d75BE6Ab65052e5AF1e54f1e5F4D990e4';
const SILO_SAVUSD = '0x606fe9a70338e798a292CA22C1F28C829F24048E';
const SILO_SUSDP = '0x8ad697a333569ca6f04c8c063e9807747ef169c1';

const client = createPublicClient({ chain: avalanche, transport: http(RPC) });

console.log('=== On-Chain Diagnostic for', ACCOUNT, '===');
console.log('Expected EOA owner:', EOA);
console.log('');

// 1. Check if account is deployed
const code = await client.getBytecode({ address: ACCOUNT });
console.log('1. Account deployed:', (code && code.length > 2) ? 'YES' : 'NO');

// 2. Check ECDSA validator owner
try {
  const abi = parseAbi(['function ecdsaValidatorStorage(address) view returns (address)']);
  const owner = await client.readContract({ address: ECDSA_VALIDATOR, abi, functionName: 'ecdsaValidatorStorage', args: [ACCOUNT] });
  console.log('2. ECDSA validator owner:', owner);
  console.log('   Owner matches EOA:', owner.toLowerCase() === EOA.toLowerCase() ? 'YES ✓' : 'NO ✗ (MISMATCH!)');
} catch (e) {
  console.log('2. ECDSA validator query failed:', e.message?.slice(0, 200));
}

// 3. Check kernel state
try {
  const accountIdAbi = parseAbi(['function accountId() view returns (string)']);
  const nonceAbi = parseAbi(['function currentNonce() view returns (uint32)']);
  const rootValAbi = parseAbi(['function rootValidator() view returns (bytes21)']);
  
  const [accountId, currentNonce, rootValidator] = await Promise.all([
    client.readContract({ address: ACCOUNT, abi: accountIdAbi, functionName: 'accountId' }),
    client.readContract({ address: ACCOUNT, abi: nonceAbi, functionName: 'currentNonce' }),
    client.readContract({ address: ACCOUNT, abi: rootValAbi, functionName: 'rootValidator' }),
  ]);
  console.log('3. Account ID:', accountId);
  console.log('   Current nonce:', currentNonce.toString());
  console.log('   Root validator:', rootValidator);
} catch (e) {
  console.log('3. Kernel state query failed:', e.message?.slice(0, 200));
}

// 4. USDC balance
try {
  const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const balance = await client.readContract({ address: USDC, abi, functionName: 'balanceOf', args: [ACCOUNT] });
  console.log('4. USDC balance:', balance.toString(), `($${(Number(balance) / 1e6).toFixed(6)})`);
} catch (e) {
  console.log('4. USDC balance query failed:', e.message?.slice(0, 200));
}

// 5. Check protocol balances
console.log('5. Protocol positions:');

// Aave
try {
  const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const aUsdc = '0x625E7708f30cA75bfd92586e17077590C60eb4cD'; // aUSDC on Avalanche
  const balance = await client.readContract({ address: aUsdc, abi, functionName: 'balanceOf', args: [ACCOUNT] });
  console.log('   AAVE aUSDC:', balance.toString(), `($${(Number(balance) / 1e6).toFixed(6)})`);
} catch (e) {
  console.log('   AAVE aUSDC: error -', e.message?.slice(0, 100));
}

// Benqi
try {
  const abi = parseAbi(['function balanceOfUnderlying(address) view returns (uint256)']);
  const balance = await client.readContract({ address: BENQI_QIUSDC, abi, functionName: 'balanceOfUnderlying', args: [ACCOUNT] });
  console.log('   Benqi qiUSDC underlying:', balance.toString(), `($${(Number(balance) / 1e6).toFixed(6)})`);
} catch (e) {
  // Try balanceOf for cToken
  try {
    const abi2 = parseAbi(['function balanceOf(address) view returns (uint256)']);
    const shares = await client.readContract({ address: BENQI_QIUSDC, abi: abi2, functionName: 'balanceOf', args: [ACCOUNT] });
    console.log('   Benqi qiUSDC shares:', shares.toString());
  } catch(e2) {
    console.log('   Benqi: error -', e.message?.slice(0, 100));
  }
}

// Spark
try {
  const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const shares = await client.readContract({ address: SPARK_VAULT, abi, functionName: 'balanceOf', args: [ACCOUNT] });
  const convertAbi = parseAbi(['function convertToAssets(uint256) view returns (uint256)']);
  const assets = shares > 0n ? await client.readContract({ address: SPARK_VAULT, abi: convertAbi, functionName: 'convertToAssets', args: [shares] }) : 0n;
  console.log('   Spark shares:', shares.toString(), `assets: $${(Number(assets) / 1e6).toFixed(6)}`);
} catch (e) {
  console.log('   Spark: error -', e.message?.slice(0, 100));
}

// Euler
try {
  const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const shares = await client.readContract({ address: EULER_VAULT, abi, functionName: 'balanceOf', args: [ACCOUNT] });
  const convertAbi = parseAbi(['function convertToAssets(uint256) view returns (uint256)']);
  const assets = shares > 0n ? await client.readContract({ address: EULER_VAULT, abi: convertAbi, functionName: 'convertToAssets', args: [shares] }) : 0n;
  console.log('   Euler shares:', shares.toString(), `assets: $${(Number(assets) / 1e6).toFixed(6)}`);
} catch (e) {
  console.log('   Euler: error -', e.message?.slice(0, 100));
}

// Silo savUSD
try {
  const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const shares = await client.readContract({ address: SILO_SAVUSD, abi, functionName: 'balanceOf', args: [ACCOUNT] });
  const convertAbi = parseAbi(['function convertToAssets(uint256) view returns (uint256)']);
  const assets = shares > 0n ? await client.readContract({ address: SILO_SAVUSD, abi: convertAbi, functionName: 'convertToAssets', args: [shares] }) : 0n;
  console.log('   Silo savUSD shares:', shares.toString(), `assets: $${(Number(assets) / 1e6).toFixed(6)}`);
} catch (e) {
  console.log('   Silo savUSD: error -', e.message?.slice(0, 100));
}

// Silo sUSDp
try {
  const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const shares = await client.readContract({ address: SILO_SUSDP, abi, functionName: 'balanceOf', args: [ACCOUNT] });
  const convertAbi = parseAbi(['function convertToAssets(uint256) view returns (uint256)']);
  const assets = shares > 0n ? await client.readContract({ address: SILO_SUSDP, abi: convertAbi, functionName: 'convertToAssets', args: [shares] }) : 0n;
  console.log('   Silo sUSDp shares:', shares.toString(), `assets: $${(Number(assets) / 1e6).toFixed(6)}`);
} catch (e) {
  console.log('   Silo sUSDp: error -', e.message?.slice(0, 100));
}

// 6. EntryPoint nonce for the permissionId
console.log('6. EntryPoint nonces:');
const permissionId = '0x98eece19'; // from execution logs
try {
  // Regular mode nonce key: 0x0000 + 2-byte-prefix + permissionId (first 4 bytes) + padding
  // The nonce key for regular mode uses the permissionId embedded in the key
  const nonceAbi = parseAbi(['function getNonce(address sender, uint192 key) view returns (uint256)']);
  
  // Regular mode nonce (key = 0x0000 02 <permissionId-4bytes> <18-bytes-zero>)
  // From logs: regularNonceKey = 0x00000298eece190000000000000000000000000000000000
  const regularKey = BigInt('0x00000298eece190000000000000000000000000000000000');
  const regularNonce = await client.readContract({ 
    address: ENTRY_POINT, abi: nonceAbi, functionName: 'getNonce', 
    args: [ACCOUNT, regularKey] 
  });
  console.log('   Regular mode nonce (permId 0x98eece19):', regularNonce.toString());
  
  // Enable mode nonce key uses 0x0001 prefix
  const enableKey = BigInt('0x00010298eece190000000000000000000000000000000000');
  const enableNonce = await client.readContract({ 
    address: ENTRY_POINT, abi: nonceAbi, functionName: 'getNonce', 
    args: [ACCOUNT, enableKey] 
  });
  console.log('   Enable mode nonce (permId 0x98eece19):', enableNonce.toString());
} catch (e) {
  console.log('   Nonce query failed:', e.message?.slice(0, 200));
}

// 7. Check USDC allowances for known spenders
console.log('7. USDC allowances:');
const allowanceAbi = parseAbi(['function allowance(address owner, address spender) view returns (uint256)']);
const spenders = [
  ['AAVE Pool', AAVE_POOL],
  ['Benqi qiUSDC', BENQI_QIUSDC],
  ['Spark Vault', SPARK_VAULT],
  ['Euler Vault', EULER_VAULT],
  ['Silo savUSD', SILO_SAVUSD],
  ['Silo sUSDp', SILO_SUSDP],
  ['Permit2', '0x000000000022D473030F116dDEE9F6B43aC78BA3'],
];
for (const [name, spender] of spenders) {
  try {
    const allowance = await client.readContract({ 
      address: USDC, abi: allowanceAbi, functionName: 'allowance', 
      args: [ACCOUNT, spender] 
    });
    console.log(`   ${name}: ${allowance.toString()} (${Number(allowance) > 0 ? 'approved' : 'zero'})`);
  } catch(e) {
    console.log(`   ${name}: error`);
  }
}

console.log('\n=== Diagnosis Complete ===');

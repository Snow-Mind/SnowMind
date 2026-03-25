import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath('.')))
os.chdir(r'e:\SnowMind\apps\backend')

from web3 import Web3

rpc = "https://api.avax.network/ext/bc/C/rpc"
w3 = Web3(Web3.HTTPProvider(rpc))
sa = Web3.to_checksum_address("0x6d6F6eE22f627f9406E4922970de12f9949be0A6")

usdc_abi = [{"constant": True, "inputs": [{"name": "account", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "type": "function"}]

tokens = {
    "USDC": ("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 6),
    "Aave aToken (aAvaUSDC)": ("0x625E7708f30cA75bfd92586e17077590C60eb4cD", 6),
    "Benqi qiUSDC": ("0xB715808a78F6041E46d61Cb123C9B4A27056AE9C", 6),
    "Spark sAvaUSDC": ("0x7c307e128efA31f540F2E2d976C995E0B65F51F6", 6),
    "Euler V2 shares": ("0xb8741F5F24569FadcdF0fC478f2E8Bd3b1F367F5", 6),
}

for name, (addr, dec) in tokens.items():
    try:
        c = w3.eth.contract(address=Web3.to_checksum_address(addr), abi=usdc_abi)
        bal = c.functions.balanceOf(sa).call()
        print(f"{name} balance: {bal / (10**dec)}  (raw: {bal})")
    except Exception as e:
        # Check if there's any code at the address
        code = w3.eth.get_code(Web3.to_checksum_address(addr))
        print(f"{name}: ERROR - {type(e).__name__}: {e}")
        print(f"  Contract code length at {addr}: {len(code)} bytes")

print("\n--- Checking Silo adapter for vault address ---")
print("(No Silo vault address provided in this script)")

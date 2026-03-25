import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath('.')))
os.chdir(r'e:\SnowMind\apps\backend')

from web3 import Web3

rpc = "https://api.avax.network/ext/bc/C/rpc"
w3 = Web3(Web3.HTTPProvider(rpc))
sa = Web3.to_checksum_address("0x6d6F6eE22f627f9406E4922970de12f9949be0A6")

# USDC balance
usdc_addr = Web3.to_checksum_address("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E")
usdc_abi = [{"constant": True, "inputs": [{"name": "account", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "type": "function"}]
usdc = w3.eth.contract(address=usdc_addr, abi=usdc_abi)
print(f"USDC balance: {usdc.functions.balanceOf(sa).call() / 1e6}")

# Aave aToken (aAvaUSDC)
atoken = Web3.to_checksum_address("0x625E7708f30cA75bfd92586e17077590C60eb4cD")
atoken_c = w3.eth.contract(address=atoken, abi=usdc_abi)
print(f"Aave aToken balance: {atoken_c.functions.balanceOf(sa).call() / 1e6}")

# Benqi qiUSDC
qi = Web3.to_checksum_address("0xB715808a78F6041E46d61Cb123C9B4A27056AE9C")
qi_c = w3.eth.contract(address=qi, abi=usdc_abi)
print(f"Benqi qiUSDC balance: {qi_c.functions.balanceOf(sa).call() / 1e6}")

# Spark sAvaUSDC
spark = Web3.to_checksum_address("0x7c307e128efA31f540F2E2d976C995E0B65F51F6")
spark_c = w3.eth.contract(address=spark, abi=usdc_abi)
spark_bal = spark_c.functions.balanceOf(sa).call()
print(f"Spark shares balance: {spark_bal / 1e6}")

# Euler V2
euler = Web3.to_checksum_address("0xb8741F5F24569FadcdF0fC478f2E8Bd3b1F367F5")
euler_c = w3.eth.contract(address=euler, abi=usdc_abi)
print(f"Euler V2 shares balance: {euler_c.functions.balanceOf(sa).call() / 1e6}")

# Silo savUSD/USDC
print("--- Checking Silo adapter for vault address ---")

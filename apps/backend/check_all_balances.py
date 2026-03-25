from web3 import Web3

rpc = "https://api.avax.network/ext/bc/C/rpc"
w3 = Web3(Web3.HTTPProvider(rpc))
sa = Web3.to_checksum_address("0x6d6F6eE22f627f9406E4922970de12f9949be0A6")

erc20_abi = [{"constant":True,"inputs":[{"name":"account","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"type":"function"}]
erc4626_abi = erc20_abi + [
    {"constant":True,"inputs":[{"name":"shares","type":"uint256"}],"name":"convertToAssets","outputs":[{"name":"","type":"uint256"}],"type":"function"},
    {"constant":True,"inputs":[{"name":"owner","type":"address"}],"name":"maxWithdraw","outputs":[{"name":"","type":"uint256"}],"type":"function"},
]

vaults = {
    "Spark spUSDC": "0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d",
    "Euler V2": "0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e",
    "Silo savUSD bUSDC": "0x606fe9a70338e798a292CA22C1F28C829F24048E",
    "Silo sUSDp bUSDC": "0x8ad697a333569ca6f04c8c063e9807747ef169c1",
}

print("=== ERC4626 Vaults ===")
for name, addr in vaults.items():
    try:
        addr_cs = Web3.to_checksum_address(addr)
        code = w3.eth.get_code(addr_cs)
        if len(code) == 0:
            print(f"{name} ({addr}): NO CONTRACT")
            continue
        c = w3.eth.contract(address=addr_cs, abi=erc4626_abi)
        shares = c.functions.balanceOf(sa).call()
        if shares > 0:
            assets = c.functions.convertToAssets(shares).call()
            print(f"{name}: {shares} shares = {assets / 1e6} USDC")
        else:
            print(f"{name}: 0 shares")
    except Exception as e:
        print(f"{name}: ERROR - {e}")

print("\n=== Direct Tokens ===")
# USDC directly
usdc = w3.eth.contract(address=Web3.to_checksum_address("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"), abi=erc20_abi)
print(f"USDC: {usdc.functions.balanceOf(sa).call() / 1e6}")

# Aave aToken
atoken = w3.eth.contract(address=Web3.to_checksum_address("0x625E7708f30cA75bfd92586e17077590C60eb4cD"), abi=erc20_abi)
print(f"Aave aUSDC: {atoken.functions.balanceOf(sa).call() / 1e6}")

# Benqi
benqi = w3.eth.contract(address=Web3.to_checksum_address("0xB715808a78F6041E46d61Cb123C9B4A27056AE9C"), abi=erc20_abi)
print(f"Benqi qiUSDC: {benqi.functions.balanceOf(sa).call() / 1e6}")

print("\n=== EOA ===")
eoa = Web3.to_checksum_address("0x97950A98980a2Fc61ea7eb043bb7666845f77071")
print(f"EOA USDC: {usdc.functions.balanceOf(eoa).call() / 1e6}")

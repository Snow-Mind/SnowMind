from web3 import Web3
w3 = Web3(Web3.HTTPProvider('http://127.0.0.1:8545'))
USDC = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
WHALE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
ERC20_ABI = [
    {'inputs':[{'name':'account','type':'address'}],'name':'balanceOf','outputs':[{'name':'','type':'uint256'}],'stateMutability':'view','type':'function'},
    {'inputs':[{'name':'to','type':'address'},{'name':'amount','type':'uint256'}],'name':'transfer','outputs':[{'name':'','type':'bool'}],'stateMutability':'nonpayable','type':'function'}
]
usdc = w3.eth.contract(address=w3.to_checksum_address(USDC), abi=ERC20_ABI)
whale_addr = '0x625E7708f30cA75bfd92586e17077590C60eb4cD'
test_account = w3.to_checksum_address(WHALE)
amount_needed = 100_000 * 10**6

try:
    balance = usdc.functions.balanceOf(w3.to_checksum_address(whale_addr)).call()
    print(f'Whale balance: {balance / 10**6:,.2f} USDC')
    w3.provider.make_request('anvil_impersonateAccount', [whale_addr])
    print('Impersonation started')
    tx = usdc.functions.transfer(
        test_account, amount_needed
    ).build_transaction({
        'from': w3.to_checksum_address(whale_addr),
        'gas': 100_000,
        'gasPrice': w3.eth.gas_price,
        'nonce': w3.eth.get_transaction_count(w3.to_checksum_address(whale_addr)),
    })
    tx_hash = w3.eth.send_transaction(tx)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    print('TX status:', receipt.status)
    w3.provider.make_request('anvil_stopImpersonatingAccount', [whale_addr])
    new_balance = usdc.functions.balanceOf(test_account).call()
    print(f'Test account balance: {new_balance / 10**6:,.2f} USDC')
except Exception as e:
    import traceback; traceback.print_exc()

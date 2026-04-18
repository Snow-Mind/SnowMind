from web3 import Web3
from decimal import Decimal

rpc = 'https://api.avax.network/ext/bc/C/rpc'
w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={'timeout': 30}))
usdc = Web3.to_checksum_address('0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E')
smart = '0x6d6f6ee22f627f9406e4922970de12f9949be0a6'
eoa = '0x97950a98980a2fc61ea7eb043bb7666845f77071'

topic0 = Web3.to_hex(Web3.keccak(text='Transfer(address,address,uint256)'))
latest = w3.eth.block_number
start = max(0, latest - 120000)
chunk = 2000

def topic_addr(address: str) -> str:
    return '0x' + ('0' * 24) + address[2:].lower()

def collect(topics):
    out = []
    frm = start
    while frm <= latest:
        to = min(latest, frm + chunk - 1)
        try:
            part = w3.eth.get_logs({'fromBlock': frm, 'toBlock': to, 'address': usdc, 'topics': topics})
            out.extend(part)
        except Exception as exc:
            print('chunk_failed', frm, to, str(exc)[:160])
        frm = to + 1
    return out

for label, addr in [('smart', smart), ('eoa', eoa)]:
    t = topic_addr(addr)
    logs = collect([topic0, t, None]) + collect([topic0, None, t])
    uniq = {(lg['transactionHash'].hex(), lg['logIndex']): lg for lg in logs}
    rows = []
    for lg in uniq.values():
        from_addr = '0x' + lg['topics'][1].hex()[-40:]
        to_addr = '0x' + lg['topics'][2].hex()[-40:]
        raw = lg['data']
        amount = int.from_bytes(raw, 'big') if isinstance(raw, (bytes, bytearray)) else int(raw, 16)
        rows.append((lg['blockNumber'], lg['transactionHash'].hex(), from_addr, to_addr, amount))
    rows.sort(key=lambda r: (r[0], r[1], r[4]))
    print('---', label, 'events', len(rows), 'window', start, 'to', latest)
    for block, txh, from_addr, to_addr, amount in rows[-40:]:
        print(block, txh, from_addr, to_addr, Decimal(amount) / Decimal(10**6))

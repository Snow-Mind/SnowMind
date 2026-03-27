import requests

SA = '0x6d6F6eE22f627f9406E4922970de12f9949be0A6'
API_KEY = 'QGMIFTTGVT7G29EK7T3NFNFZRPSIMV3DRZ'

# Check internal transactions (UserOps show as internal txs from EntryPoint)
url = f'https://api.snowtrace.io/api?module=account&action=txlistinternal&address={SA}&startblock=0&endblock=99999999&sort=desc&apikey={API_KEY}'
r = requests.get(url, timeout=15)
data = r.json()
results = data.get('result', [])
if isinstance(results, list):
    print('Internal txs:', len(results))
    for tx in results[:10]:
        blk = tx.get('blockNumber', '?')
        frm = tx.get('from', '?')[:16]
        to = tx.get('to', '?')[:16]
        val = tx.get('value', '?')
        tp = tx.get('type', '?')
        print(f'  block={blk} from={frm} to={to} value={val} type={tp}')
else:
    print('Internal txs result:', results)

# Check normal transactions
url2 = f'https://api.snowtrace.io/api?module=account&action=txlist&address={SA}&startblock=0&endblock=99999999&sort=desc&apikey={API_KEY}'
r2 = requests.get(url2, timeout=15)
data2 = r2.json()
results2 = data2.get('result', [])
if isinstance(results2, list):
    print(f'\nNormal txs: {len(results2)}')
    for tx in results2[:10]:
        h = tx.get('hash', '?')[:20]
        frm = tx.get('from', '?')[:16]
        to = tx.get('to', '?')[:16]
        method = tx.get('methodId', '?')
        print(f'  hash={h} from={frm} to={to} method={method}')
else:
    print('Normal txs result:', results2)

# Check ERC-20 transfers
url3 = f'https://api.snowtrace.io/api?module=account&action=tokentx&address={SA}&startblock=0&endblock=99999999&sort=desc&apikey={API_KEY}'
r3 = requests.get(url3, timeout=15)
data3 = r3.json()
results3 = data3.get('result', [])
if isinstance(results3, list):
    print(f'\nToken txs: {len(results3)}')
    for tx in results3[:10]:
        h = tx.get('hash', '?')[:20]
        frm = tx.get('from', '?')[:16]
        to = tx.get('to', '?')[:16]
        sym = tx.get('tokenSymbol', '?')
        val = tx.get('value', '?')
        print(f'  hash={h} from={frm} to={to} token={sym} value={val}')
else:
    print('Token txs result:', results3)

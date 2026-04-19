2026-04-19T20:58:28.210613345Z [inf]  Starting Container
2026-04-19T20:58:28.782722145Z [err]  Installed 6 packages in 18ms
2026-04-19T20:58:28.782726006Z [err]  Bytecode compiled 2150 files in 174ms
2026-04-19T20:58:28.862289048Z [inf]  
2026-04-19T20:58:31.446939934Z [err]  INFO:     Started server process [54]
2026-04-19T20:58:31.446944381Z [err]  INFO:     Waiting for application startup.
2026-04-19T20:58:31.520589816Z [inf]  Sentry initialized [environment=production, traces_sample_rate=0.050]
2026-04-19T20:58:31.520596590Z [inf]  Environment validation passed
2026-04-19T20:58:31.520601173Z [inf]  SnowMind API v1.0.0 started (chain=43114 mainnet, debug=False)
2026-04-19T20:58:31.532656438Z [inf]  RPC manager initialized with 3 providers. Active: primary
2026-04-19T20:58:31.532666904Z [inf]  Scheduler started [instance=ae3e4737, interval=3600s]
2026-04-19T20:58:31.533466640Z [inf]  Utilization monitor started [instance=150604ee interval=30s threshold=92.0%]
2026-04-19T20:58:31.959843252Z [err]  INFO:     Application startup complete.
2026-04-19T20:58:32.093628599Z [err]  INFO:     Uvicorn running on http://0.0.0.0:8080 (Press CTRL+C to quit)
2026-04-19T20:58:32.337979893Z [inf]  GET /api/v1/health → 200 (2.3ms)
2026-04-19T20:58:32.337985972Z [inf]  INFO:     100.64.0.2:47403 - "GET /api/v1/health HTTP/1.1" 200 OK
2026-04-19T20:58:33.675244802Z [inf]  Skipping 9 active account(s) with no valid session key
2026-04-19T20:58:35.700415778Z [inf]  Deferred 4 account(s) by deposit-tier cadence
2026-04-19T20:58:35.700421473Z [inf]  Processing 4 due account(s) out of 8 eligible (17 active)
2026-04-19T20:58:41.762544076Z [inf]  euler_v2 snapshot table has valid data — skipping seed
2026-04-19T20:58:41.775789199Z [inf]  spark snapshot table has valid data — skipping seed
2026-04-19T20:58:41.900275233Z [inf]  silo_susdp_usdc snapshot table has valid data — skipping seed
2026-04-19T20:58:42.234297483Z [inf]  silo_savusd_usdc snapshot table has valid data — skipping seed
2026-04-19T20:58:45.780492100Z [inf]  aave_v3: spot=2.75% twap=2.75%
2026-04-19T20:58:45.780499350Z [err]  SANITY BOUND EXCEEDED: benqi reporting 31.4% APY. Halting rebalancing.
2026-04-19T20:58:45.854253748Z [wrn]  Excluding benqi from this cycle due to sanity bound
2026-04-19T20:58:45.854259527Z [inf]  spark: spot=3.75% twap=3.75%
2026-04-19T20:58:45.854263208Z [err]  SANITY BOUND EXCEEDED: euler_v2 reporting 48.0% APY. Halting rebalancing.
2026-04-19T20:58:45.854266984Z [wrn]  Excluding euler_v2 from this cycle due to sanity bound
2026-04-19T20:58:45.854270588Z [inf]  silo_savusd_usdc: spot=19.07% twap=19.07%
2026-04-19T20:58:45.854274611Z [inf]  silo_susdp_usdc: spot=1.79% twap=1.79%
2026-04-19T20:58:46.714688131Z [inf]  Daily risk snapshot already present for 2026-04-19; skipping seed
2026-04-19T20:58:51.945113203Z [inf]  Silo silo_savusd_usdc utilization 100.0% > 90% — marking HIGH_UTILIZATION
2026-04-19T20:58:51.945116899Z [inf]  Candidate silo_savusd_usdc failed health check: Utilization > 90% — exclude from new deposits; Liquidity stress: utilization 100.0% > 90.0% — trying next
2026-04-19T20:58:54.643026522Z [inf]  Candidate aave_v3 passed health check (TWAP APY: 2.75%)
2026-04-19T20:58:56.687750332Z [inf]  Candidate silo_susdp_usdc passed health check (TWAP APY: 1.79%)
2026-04-19T20:58:56.687753579Z [wrn]  Health check exclusions for silo_savusd_usdc: Utilization > 90% — exclude from new deposits; Liquidity stress: utilization 100.0% > 90.0%
2026-04-19T20:58:56.687756729Z [inf]  BEAT-MARGIN SKIP for 0xE61EaBDF5a87E4810CB8998a3030c389fEc75d0B: current_wAPY=3.7500%, proposed_wAPY=3.7500%, improvement=0.0000%, margin=0.0100%, is_initial=False, idle=$0.01, current_allocs={'spark': '$1.49'}, proposed={'spark': '$1.49'}, allowed=['aave_v3', 'silo_savusd_usdc', 'silo_susdp_usdc', 'spark'], all_twap_rates={'aave_v3': '2.75%', 'spark': '3.75%', 'silo_savusd_usdc': '19.07%', 'silo_susdp_usdc': '1.79%'}
2026-04-19T20:58:56.871220970Z [inf]  Rebalance skipped for 9e2b628d-fa3f-4cc4-8812-39b772a1f0f0: APY improvement below beat margin | gate=beat_margin | observed=0.0000% | threshold=0.0100% Skipped markets: Silo sAVUSD/USDC (Utilization > 90% — exclude from new deposits).
2026-04-19T20:58:59.376807255Z [inf]  aave_v3: spot=2.75% twap=2.75%
2026-04-19T20:58:59.376813405Z [err]  SANITY BOUND EXCEEDED: benqi reporting 31.4% APY. Halting rebalancing.
2026-04-19T20:58:59.376820248Z [wrn]  Excluding benqi from this cycle due to sanity bound
2026-04-19T20:58:59.376824358Z [inf]  spark: spot=3.75% twap=3.75%
2026-04-19T20:58:59.376827882Z [err]  SANITY BOUND EXCEEDED: euler_v2 reporting 48.0% APY. Halting rebalancing.
2026-04-19T20:58:59.376831843Z [wrn]  Excluding euler_v2 from this cycle due to sanity bound
2026-04-19T20:58:59.376835302Z [inf]  silo_savusd_usdc: spot=19.07% twap=19.07%
2026-04-19T20:58:59.376839445Z [inf]  silo_susdp_usdc: spot=1.79% twap=1.79%
2026-04-19T20:58:59.376843181Z [inf]  Session key for 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268 excludes protocols: silo_susdp_usdc
2026-04-19T20:59:05.777650211Z [inf]  Silo silo_savusd_usdc utilization 100.0% > 90% — marking HIGH_UTILIZATION
2026-04-19T20:59:05.777655150Z [inf]  Candidate silo_savusd_usdc failed health check: Utilization > 90% — exclude from new deposits; Liquidity stress: utilization 100.0% > 90.0% — trying next
2026-04-19T20:59:08.326985697Z [inf]  GET / → 200 (1.6ms)
2026-04-19T20:59:08.326991398Z [inf]  INFO:     100.64.0.3:43712 - "GET / HTTP/1.1" 200 OK
2026-04-19T20:59:08.520446914Z [inf]  Candidate aave_v3 passed health check (TWAP APY: 2.75%)
2026-04-19T20:59:08.520463862Z [wrn]  Health check exclusions for silo_savusd_usdc: Utilization > 90% — exclude from new deposits; Liquidity stress: utilization 100.0% > 90.0%
2026-04-19T20:59:08.520470360Z [inf]  BEAT-MARGIN SKIP for 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268: current_wAPY=3.7500%, proposed_wAPY=3.7500%, improvement=0.0000%, margin=0.0100%, is_initial=False, idle=$0.01, current_allocs={'spark': '$6.00'}, proposed={'spark': '$6.00'}, allowed=['aave_v3', 'silo_savusd_usdc', 'spark'], all_twap_rates={'aave_v3': '2.75%', 'spark': '3.75%', 'silo_savusd_usdc': '19.07%'}
2026-04-19T20:59:08.633467840Z [inf]  Rebalance skipped for b6038b74-dcb3-44ae-aa4c-16dca0b2e26a: APY improvement below beat margin | gate=beat_margin | observed=0.0000% | threshold=0.0100% Skipped markets: Silo sAVUSD/USDC (Utilization > 90% — exclude from new deposits).
2026-04-19T20:59:28.635207805Z [inf]  aave_v3: spot=2.75% twap=2.75%
2026-04-19T20:59:28.635215448Z [err]  SANITY BOUND EXCEEDED: benqi reporting 31.4% APY. Halting rebalancing.
2026-04-19T20:59:28.635221493Z [wrn]  Excluding benqi from this cycle due to sanity bound
2026-04-19T20:59:28.635227071Z [inf]  spark: spot=3.75% twap=3.75%
2026-04-19T20:59:28.635232456Z [err]  SANITY BOUND EXCEEDED: euler_v2 reporting 48.0% APY. Halting rebalancing.
2026-04-19T20:59:28.635237816Z [wrn]  Excluding euler_v2 from this cycle due to sanity bound
2026-04-19T20:59:28.635242387Z [inf]  silo_savusd_usdc: spot=19.07% twap=19.07%
2026-04-19T20:59:28.635246807Z [inf]  silo_susdp_usdc: spot=1.79% twap=1.79%
2026-04-19T20:59:28.635251525Z [inf]  Detected 0.10 idle USDC in 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 (protocol-deployed: 99.92)
2026-04-19T20:59:28.635898903Z [inf]  Silo silo_savusd_usdc utilization 100.0% > 90% — marking HIGH_UTILIZATION
2026-04-19T20:59:28.635904433Z [inf]  Candidate silo_savusd_usdc failed health check: Utilization > 90% — exclude from new deposits; Liquidity stress: utilization 100.0% > 90.0% — trying next
2026-04-19T20:59:28.635909070Z [inf]  Candidate aave_v3 passed health check (TWAP APY: 2.75%)
2026-04-19T20:59:30.171785978Z [inf]  Candidate silo_susdp_usdc passed health check (TWAP APY: 1.79%)
2026-04-19T20:59:30.171792021Z [wrn]  Health check exclusions for silo_savusd_usdc: Utilization > 90% — exclude from new deposits; Liquidity stress: utilization 100.0% > 90.0%
2026-04-19T20:59:30.171796507Z [inf]  BEAT-MARGIN SKIP for 0xea5e76244dcAE7b17d9787b804F76dAaF6923184: current_wAPY=3.7463%, proposed_wAPY=3.7500%, improvement=0.0037%, margin=0.0100%, is_initial=False, idle=$0.10, current_allocs={'spark': '$99.92'}, proposed={'spark': '$100.02'}, allowed=['aave_v3', 'silo_savusd_usdc', 'silo_susdp_usdc', 'spark'], all_twap_rates={'aave_v3': '2.75%', 'spark': '3.75%', 'silo_savusd_usdc': '19.07%', 'silo_susdp_usdc': '1.79%'}
2026-04-19T20:59:30.583433281Z [inf]  Rebalance skipped for 4d646cc1-b8c9-4dee-9d83-6f2bba3b3f14: APY improvement below beat margin | gate=beat_margin | observed=0.0037% | threshold=0.0100% Skipped markets: Silo sAVUSD/USDC (Utilization > 90% — exclude from new deposits).
2026-04-19T20:59:33.062286576Z [inf]  aave_v3: spot=2.75% twap=2.75%
2026-04-19T20:59:33.062290065Z [err]  SANITY BOUND EXCEEDED: benqi reporting 31.4% APY. Halting rebalancing.
2026-04-19T20:59:33.062293665Z [wrn]  Excluding benqi from this cycle due to sanity bound
2026-04-19T20:59:33.062297196Z [inf]  spark: spot=3.75% twap=3.75%
2026-04-19T20:59:33.062300503Z [err]  SANITY BOUND EXCEEDED: euler_v2 reporting 48.0% APY. Halting rebalancing.
2026-04-19T20:59:33.062303948Z [wrn]  Excluding euler_v2 from this cycle due to sanity bound
2026-04-19T20:59:33.062308345Z [inf]  silo_savusd_usdc: spot=19.07% twap=19.07%
2026-04-19T20:59:33.062311637Z [inf]  silo_susdp_usdc: spot=1.79% twap=1.79%
2026-04-19T20:59:39.183077845Z [inf]  Silo silo_savusd_usdc utilization 100.0% > 90% — marking HIGH_UTILIZATION
2026-04-19T20:59:39.183084274Z [inf]  Candidate silo_savusd_usdc failed health check: Utilization > 90% — exclude from new deposits; Liquidity stress: utilization 100.0% > 90.0% — trying next
2026-04-19T20:59:41.809167941Z [inf]  Candidate aave_v3 passed health check (TWAP APY: 2.75%)
2026-04-19T20:59:43.836263094Z [inf]  Candidate silo_susdp_usdc passed health check (TWAP APY: 1.79%)
2026-04-19T20:59:43.836275154Z [wrn]  Health check exclusions for silo_savusd_usdc: Utilization > 90% — exclude from new deposits; Liquidity stress: utilization 100.0% > 90.0%
2026-04-19T20:59:43.836284084Z [inf]  BEAT-MARGIN SKIP for 0x6d6F6eE22f627f9406E4922970de12f9949be0A6: current_wAPY=3.7500%, proposed_wAPY=3.7500%, improvement=0.0000%, margin=0.0100%, is_initial=False, idle=$0.01, current_allocs={'spark': '$0.99'}, proposed={'spark': '$0.99'}, allowed=['aave_v3', 'silo_savusd_usdc', 'silo_susdp_usdc', 'spark'], all_twap_rates={'aave_v3': '2.75%', 'spark': '3.75%', 'silo_savusd_usdc': '19.07%', 'silo_susdp_usdc': '1.79%'}
2026-04-19T20:59:43.982678909Z [inf]  Rebalance skipped for cd1da5dd-f9a1-4b6d-bae4-13f8cae75ba8: APY improvement below beat margin | gate=beat_margin | observed=0.0000% | threshold=0.0100% Skipped markets: Silo sAVUSD/USDC (Utilization > 90% — exclude from new deposits).
2026-04-19T20:59:43.982691074Z [inf]  Scheduler tick done — {'checked': 4, 'rebalanced': 0, 'skipped': 8, 'errors': 0, 'no_session_key': 9, 'cadence_deferred': 4}
2026-04-19T21:00:13.796849337Z [inf]  GET / → 200 (1.8ms)
2026-04-19T21:00:13.796857391Z [inf]  INFO:     100.64.0.4:19194 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:01:14.201310699Z [inf]  GET / → 200 (2.4ms)
2026-04-19T21:01:14.201317746Z [inf]  INFO:     100.64.0.5:56036 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:02:14.622515901Z [inf]  GET / → 200 (2.2ms)
2026-04-19T21:02:14.622522564Z [inf]  INFO:     100.64.0.6:46234 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:03:14.678972863Z [inf]  GET / → 200 (1.6ms)
2026-04-19T21:03:14.678978191Z [inf]  INFO:     100.64.0.7:40994 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:04:15.086848569Z [inf]  GET / → 200 (1.6ms)
2026-04-19T21:04:15.086857619Z [inf]  INFO:     100.64.0.8:32884 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:05:15.136062304Z [inf]  GET / → 200 (1.6ms)
2026-04-19T21:05:15.136066078Z [inf]  INFO:     100.64.0.9:29522 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:06:15.319576006Z [inf]  GET / → 200 (1.5ms)
2026-04-19T21:06:15.319579702Z [inf]  INFO:     100.64.0.7:48732 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:07:15.621604849Z [inf]  GET / → 200 (1.6ms)
2026-04-19T21:07:15.621610115Z [inf]  INFO:     100.64.0.4:11856 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:08:15.777319672Z [inf]  GET / → 200 (2.1ms)
2026-04-19T21:08:15.777323766Z [inf]  INFO:     100.64.0.10:41752 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:09:15.991226151Z [inf]  GET / → 200 (2.0ms)
2026-04-19T21:09:15.991234376Z [inf]  INFO:     100.64.0.11:40122 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:09:56.252218302Z [inf]  OPTIONS /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (5.1ms)
2026-04-19T21:09:56.252221773Z [inf]  INFO:     100.64.0.12:14448 - "OPTIONS /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=false HTTP/1.1" 200 OK
2026-04-19T21:09:56.252225426Z [inf]  OPTIONS /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (5.1ms)
2026-04-19T21:09:56.252229423Z [inf]  INFO:     100.64.0.12:14454 - "OPTIONS /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=true HTTP/1.1" 200 OK
2026-04-19T21:09:56.252232791Z [inf]  OPTIONS /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (4.9ms)
2026-04-19T21:09:56.252237026Z [inf]  INFO:     100.64.0.13:39726 - "OPTIONS /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:09:56.252240784Z [inf]  OPTIONS /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (3.7ms)
2026-04-19T21:09:56.252244600Z [inf]  INFO:     100.64.0.12:14456 - "OPTIONS /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:09:56.252248546Z [inf]  OPTIONS /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (1.0ms)
2026-04-19T21:09:56.252645447Z [inf]  INFO:     100.64.0.14:51958 - "OPTIONS /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:09:56.252651066Z [inf]  Refreshed Privy JWKS cache from https://auth.privy.io/api/v1/apps/cmmf92rhz008x0bl3s16q73wt/jwks.json
2026-04-19T21:09:56.252654870Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (3227.4ms)
2026-04-19T21:09:56.252658189Z [inf]  INFO:     100.64.0.12:14456 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=true HTTP/1.1" 200 OK
2026-04-19T21:09:56.252661474Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (3228.4ms)
2026-04-19T21:09:56.252665115Z [inf]  INFO:     100.64.0.14:51958 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=false HTTP/1.1" 200 OK
2026-04-19T21:09:56.252668373Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (3224.6ms)
2026-04-19T21:09:56.252671608Z [inf]  INFO:     100.64.0.12:14454 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:09:56.252674716Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (4547.5ms)
2026-04-19T21:09:56.253292751Z [inf]  INFO:     100.64.0.15:35788 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:10:01.002237395Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (11491.3ms)
2026-04-19T21:10:01.002242553Z [inf]  INFO:     100.64.0.13:39726 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:10:08.548196534Z [inf]  GET / → 200 (1.7ms)
2026-04-19T21:10:08.548200295Z [inf]  INFO:     100.64.0.16:15448 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:10:16.901351839Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (1558.6ms)
2026-04-19T21:10:16.901358505Z [inf]  INFO:     100.64.0.14:59692 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=true HTTP/1.1" 200 OK
2026-04-19T21:10:16.901364657Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (1554.3ms)
2026-04-19T21:10:16.901371115Z [inf]  INFO:     100.64.0.13:31350 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=false HTTP/1.1" 200 OK
2026-04-19T21:10:16.901378790Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1553.1ms)
2026-04-19T21:10:16.901385437Z [inf]  INFO:     100.64.0.17:37866 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:10:17.583015277Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2360.3ms)
2026-04-19T21:10:17.583022750Z [inf]  INFO:     100.64.0.13:31334 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:10:18.271410334Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (3685.1ms)
2026-04-19T21:10:18.271418941Z [inf]  INFO:     100.64.0.12:11534 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:10:22.193781103Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (1133.4ms)
2026-04-19T21:10:22.193787012Z [inf]  INFO:     100.64.0.18:37170 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=false HTTP/1.1" 200 OK
2026-04-19T21:10:22.193791258Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1132.9ms)
2026-04-19T21:10:22.193795398Z [inf]  INFO:     100.64.0.14:58210 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:10:22.193799168Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (1494.3ms)
2026-04-19T21:10:22.193802848Z [inf]  INFO:     100.64.0.12:11534 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=true HTTP/1.1" 200 OK
2026-04-19T21:10:22.193806832Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1132.6ms)
2026-04-19T21:10:22.193810514Z [inf]  INFO:     100.64.0.19:13326 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:10:22.862791130Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2071.3ms)
2026-04-19T21:10:22.862796114Z [inf]  INFO:     100.64.0.14:59692 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:10:29.601618704Z [inf]  GET /api/v1/optimizer/rates → 200 (7245.8ms)
2026-04-19T21:10:29.601622179Z [inf]  INFO:     100.64.0.14:58210 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:11:09.869186605Z [inf]  GET / → 200 (3.7ms)
2026-04-19T21:11:09.869190997Z [inf]  INFO:     100.64.0.20:49108 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:12:10.211065943Z [inf]  GET / → 200 (1.6ms)
2026-04-19T21:12:10.211069733Z [inf]  INFO:     100.64.0.21:38352 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:12:30.112427360Z [inf]  INFO:     100.64.0.14:18104 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:12:30.112479597Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1247.6ms)
2026-04-19T21:12:30.112484458Z [inf]  INFO:     100.64.0.17:24580 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:12:30.112489272Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2793.1ms)
2026-04-19T21:12:35.594466466Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (9219.8ms)
2026-04-19T21:12:35.594471195Z [inf]  INFO:     100.64.0.19:18012 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:13:15.595079469Z [inf]  GET / → 200 (1.5ms)
2026-04-19T21:13:15.595083845Z [inf]  INFO:     100.64.0.21:61034 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:13:16.602750325Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (656.3ms)
2026-04-19T21:13:16.602754634Z [inf]  INFO:     100.64.0.14:34840 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:13:17.984307849Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2139.5ms)
2026-04-19T21:13:17.984315904Z [inf]  INFO:     100.64.0.22:35716 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:13:23.230515899Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (348.5ms)
2026-04-19T21:13:23.230519924Z [inf]  INFO:     100.64.0.19:17200 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:13:25.706561178Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (10344.1ms)
2026-04-19T21:13:25.706566567Z [inf]  INFO:     100.64.0.12:13928 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:13:25.706571539Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (3116.6ms)
2026-04-19T21:13:25.706575762Z [inf]  INFO:     100.64.0.14:41984 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:13:26.294571755Z [inf]  GET /api/v1/optimizer/rates → 200 (162.1ms)
2026-04-19T21:13:26.294577377Z [inf]  INFO:     100.64.0.17:11024 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:13:27.943347921Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (1167.8ms)
2026-04-19T21:13:27.943351697Z [inf]  INFO:     100.64.0.22:35216 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:13:32.995402071Z [inf]  INFO:     100.64.0.15:57050 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:13:32.995411019Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (642.7ms)
2026-04-19T21:13:32.995415987Z [inf]  INFO:     100.64.0.19:23544 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:13:32.995445671Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (643.0ms)
2026-04-19T21:13:33.762991841Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (1454.2ms)
2026-04-19T21:13:33.762996096Z [inf]  INFO:     100.64.0.17:11026 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:14:13.758716786Z [inf]  GET / → 200 (1.7ms)
2026-04-19T21:14:13.758721665Z [inf]  INFO:     100.64.0.6:43818 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:15:04.060111580Z [inf]  OPTIONS /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (1.4ms)
2026-04-19T21:15:04.060118506Z [inf]  INFO:     100.64.0.23:62034 - "OPTIONS /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:15:04.060127403Z [inf]  OPTIONS /api/v1/accounts/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (1.5ms)
2026-04-19T21:15:04.060133641Z [inf]  INFO:     100.64.0.24:45568 - "OPTIONS /api/v1/accounts/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:15:04.060138749Z [inf]  GET /api/v1/accounts/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (1682.2ms)
2026-04-19T21:15:04.060143681Z [inf]  INFO:     100.64.0.25:11590 - "GET /api/v1/accounts/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:15:05.280634957Z [inf]  GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (10450.4ms)
2026-04-19T21:15:05.280638628Z [inf]  INFO:     100.64.0.23:62034 - "GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:15:05.672221674Z [inf]  GET /api/v1/optimizer/rates → 200 (133.5ms)
2026-04-19T21:15:05.672226932Z [inf]  INFO:     100.64.0.26:30384 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:15:06.300705026Z [inf]  OPTIONS /api/v1/rebalance/0x6d6F6eE22f627f9406E4922970de12f9949be0A6/status → 200 (1.5ms)
2026-04-19T21:15:06.300709259Z [inf]  INFO:     100.64.0.27:25416 - "OPTIONS /api/v1/rebalance/0x6d6F6eE22f627f9406E4922970de12f9949be0A6/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:15:07.491470619Z [inf]  GET /api/v1/rebalance/0x6d6F6eE22f627f9406E4922970de12f9949be0A6/status → 200 (1189.1ms)
2026-04-19T21:15:07.491480647Z [inf]  INFO:     100.64.0.27:25416 - "GET /api/v1/rebalance/0x6d6F6eE22f627f9406E4922970de12f9949be0A6/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:15:08.325908321Z [inf]  GET / → 200 (2.0ms)
2026-04-19T21:15:08.325913275Z [inf]  INFO:     100.64.0.28:11988 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:15:17.645410271Z [inf]  GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (1919.8ms)
2026-04-19T21:15:17.645416538Z [inf]  INFO:     100.64.0.27:33232 - "GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:15:20.608524806Z [inf]  GET /api/v1/accounts/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (759.8ms)
2026-04-19T21:15:20.608531660Z [inf]  INFO:     100.64.0.27:33232 - "GET /api/v1/accounts/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:15:20.608536956Z [inf]  GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (757.7ms)
2026-04-19T21:15:20.608541987Z [inf]  INFO:     100.64.0.27:33236 - "GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:15:21.396841270Z [inf]  GET /api/v1/rebalance/0x6d6F6eE22f627f9406E4922970de12f9949be0A6/status → 200 (1558.9ms)
2026-04-19T21:15:21.396849063Z [inf]  INFO:     100.64.0.25:29082 - "GET /api/v1/rebalance/0x6d6F6eE22f627f9406E4922970de12f9949be0A6/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:15:41.421649105Z [inf]  GET /api/v1/optimizer/rates → 200 (9283.4ms)
2026-04-19T21:15:41.421652922Z [inf]  INFO:     100.64.0.25:29098 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:15:41.421656709Z [inf]  GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (4860.3ms)
2026-04-19T21:15:41.421660277Z [inf]  INFO:     100.64.0.25:47070 - "GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:15:47.643335346Z [inf]  GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (2039.6ms)
2026-04-19T21:15:47.643373168Z [inf]  INFO:     100.64.0.25:59044 - "GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:15:51.189917157Z [inf]  GET /api/v1/accounts/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (357.3ms)
2026-04-19T21:15:51.189928695Z [inf]  INFO:     100.64.0.23:46944 - "GET /api/v1/accounts/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:16:11.119044054Z [inf]  GET /api/v1/optimizer/rates → 200 (8488.6ms)
2026-04-19T21:16:11.119053325Z [inf]  INFO:     100.64.0.23:46946 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:16:11.119060085Z [inf]  GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 → 200 (6306.2ms)
2026-04-19T21:16:11.119064651Z [inf]  INFO:     100.64.0.24:29760 - "GET /api/v1/portfolio/0x6d6F6eE22f627f9406E4922970de12f9949be0A6 HTTP/1.1" 200 OK
2026-04-19T21:16:11.119069583Z [inf]  GET /api/v1/rebalance/0x6d6F6eE22f627f9406E4922970de12f9949be0A6/status → 200 (2107.6ms)
2026-04-19T21:16:11.119074298Z [inf]  INFO:     100.64.0.29:39390 - "GET /api/v1/rebalance/0x6d6F6eE22f627f9406E4922970de12f9949be0A6/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:16:11.119078187Z [inf]  GET / → 200 (1.9ms)
2026-04-19T21:16:11.119082793Z [inf]  INFO:     100.64.0.30:33208 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:16:11.119086579Z [inf]  GET /api/v1/optimizer/rates → 200 (7.2ms)
2026-04-19T21:16:11.119090996Z [inf]  INFO:     100.64.0.18:48890 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:16:11.159414688Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1407.3ms)
2026-04-19T21:16:11.159418385Z [inf]  INFO:     100.64.0.14:34956 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:16:11.978338262Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2229.4ms)
2026-04-19T21:16:11.978346725Z [inf]  INFO:     100.64.0.12:23610 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:16:12.544851329Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (345.6ms)
2026-04-19T21:16:12.544857649Z [inf]  INFO:     100.64.0.14:34956 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:16:13.595540213Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (3533.9ms)
2026-04-19T21:16:13.595547806Z [inf]  INFO:     100.64.0.15:42576 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:16:14.681750026Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (2261.3ms)
2026-04-19T21:16:14.681761823Z [inf]  INFO:     100.64.0.12:23612 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:16:14.968839735Z [inf]  GET /api/v1/optimizer/rates → 200 (4.3ms)
2026-04-19T21:16:14.968846145Z [inf]  INFO:     100.64.0.12:23612 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:16:16.922193869Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (1170.9ms)
2026-04-19T21:16:16.922199449Z [inf]  INFO:     100.64.0.12:23612 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:16:36.793425676Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (383.4ms)
2026-04-19T21:16:36.793432262Z [inf]  INFO:     100.64.0.12:43070 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:16:36.793436457Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (1106.5ms)
2026-04-19T21:16:36.793446202Z [inf]  INFO:     100.64.0.15:42348 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:16:36.793451182Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (8838.1ms)
2026-04-19T21:16:36.793455437Z [inf]  INFO:     100.64.0.17:19530 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:16:36.793459429Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (127.1ms)
2026-04-19T21:16:36.793463619Z [inf]  INFO:     100.64.0.13:45822 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:16:36.793468121Z [inf]  GET /api/v1/optimizer/rates → 200 (133.1ms)
2026-04-19T21:16:36.793472203Z [inf]  INFO:     100.64.0.12:43076 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:16:38.237550920Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (535.9ms)
2026-04-19T21:16:38.237558557Z [inf]  INFO:     100.64.0.12:43076 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=false HTTP/1.1" 200 OK
2026-04-19T21:16:38.604298811Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (373.5ms)
2026-04-19T21:16:38.604307195Z [inf]  INFO:     100.64.0.19:27672 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=true HTTP/1.1" 200 OK
2026-04-19T21:16:58.606736016Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (2108.1ms)
2026-04-19T21:16:58.606741343Z [inf]  INFO:     100.64.0.12:28604 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=false HTTP/1.1" 200 OK
2026-04-19T21:16:58.606745690Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1436.4ms)
2026-04-19T21:16:58.606750029Z [inf]  INFO:     100.64.0.17:42844 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:16:58.606754282Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (1431.9ms)
2026-04-19T21:16:58.606758220Z [inf]  INFO:     100.64.0.19:15166 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=true HTTP/1.1" 200 OK
2026-04-19T21:16:58.606762071Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2893.3ms)
2026-04-19T21:16:58.606768031Z [inf]  INFO:     100.64.0.15:27020 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:16:58.606772963Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (4486.9ms)
2026-04-19T21:16:58.606985765Z [inf]  INFO:     100.64.0.13:42172 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:17:08.319998061Z [inf]  GET / → 200 (1.5ms)
2026-04-19T21:17:08.320002155Z [inf]  INFO:     100.64.0.31:53764 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:17:48.465244533Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (1955.1ms)
2026-04-19T21:17:48.465249317Z [inf]  INFO:     100.64.0.13:62090 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=true HTTP/1.1" 200 OK
2026-04-19T21:17:48.465253210Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (1953.6ms)
2026-04-19T21:17:48.465257796Z [inf]  INFO:     100.64.0.12:40378 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=false HTTP/1.1" 200 OK
2026-04-19T21:17:48.465261776Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1548.4ms)
2026-04-19T21:17:48.465265581Z [inf]  INFO:     100.64.0.22:43090 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:17:48.465269265Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2530.4ms)
2026-04-19T21:17:48.465274029Z [inf]  INFO:     100.64.0.13:62086 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:17:55.715647298Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (9543.7ms)
2026-04-19T21:17:55.715650662Z [inf]  INFO:     100.64.0.12:40392 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:18:15.551955486Z [inf]  GET / → 200 (1.8ms)
2026-04-19T21:18:15.551959928Z [inf]  INFO:     100.64.0.16:61796 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:18:55.717812925Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (1161.7ms)
2026-04-19T21:18:55.717819179Z [inf]  INFO:     100.64.0.14:37754 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=false HTTP/1.1" 200 OK
2026-04-19T21:18:55.717823817Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (936.7ms)
2026-04-19T21:18:55.717828982Z [inf]  INFO:     100.64.0.17:17680 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:18:55.717833343Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history → 200 (923.5ms)
2026-04-19T21:18:55.717837025Z [inf]  INFO:     100.64.0.19:16946 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/history?limit=10&offset=0&transactionsOnly=true HTTP/1.1" 200 OK
2026-04-19T21:18:55.717840380Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2769.1ms)
2026-04-19T21:18:55.717843715Z [inf]  INFO:     100.64.0.15:34560 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:18:56.051354751Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (366.3ms)
2026-04-19T21:18:56.051358568Z [inf]  INFO:     100.64.0.12:26962 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:19:02.393936455Z [inf]  GET /api/v1/optimizer/rates → 200 (9632.8ms)
2026-04-19T21:19:02.393946587Z [inf]  INFO:     100.64.0.14:37754 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:19:02.393953587Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (11590.8ms)
2026-04-19T21:19:02.393960952Z [inf]  INFO:     100.64.0.14:37774 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:19:02.393968038Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (7303.5ms)
2026-04-19T21:19:02.393975028Z [inf]  INFO:     100.64.0.19:16946 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:19:02.809722491Z [inf]  GET /api/v1/optimizer/rates → 200 (4.6ms)
2026-04-19T21:19:02.809727029Z [inf]  INFO:     100.64.0.19:16946 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:19:04.954281630Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (1178.3ms)
2026-04-19T21:19:04.954287476Z [inf]  INFO:     100.64.0.15:16292 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:19:08.468071695Z [inf]  GET / → 200 (1.7ms)
2026-04-19T21:19:08.468076482Z [inf]  INFO:     100.64.0.4:59890 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:20:08.697130049Z [inf]  GET / → 200 (1.8ms)
2026-04-19T21:20:08.697137251Z [inf]  INFO:     100.64.0.32:15390 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:20:28.851207876Z [inf]  OPTIONS /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (1.4ms)
2026-04-19T21:20:28.851212423Z [inf]  INFO:     100.64.0.12:15426 - "OPTIONS /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:20:28.851217540Z [inf]  OPTIONS /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1.5ms)
2026-04-19T21:20:28.851221733Z [inf]  INFO:     100.64.0.17:50542 - "OPTIONS /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:20:28.851225653Z [inf]  OPTIONS /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1.1ms)
2026-04-19T21:20:28.851229861Z [inf]  INFO:     100.64.0.19:33742 - "OPTIONS /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:20:28.851233811Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1310.3ms)
2026-04-19T21:20:28.851237426Z [inf]  INFO:     100.64.0.17:50542 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:20:28.851241482Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2791.4ms)
2026-04-19T21:20:28.851245797Z [inf]  INFO:     100.64.0.12:15426 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:20:35.967588191Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (10311.8ms)
2026-04-19T21:20:35.967593563Z [inf]  INFO:     100.64.0.19:33742 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:20:39.310094076Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (821.6ms)
2026-04-19T21:20:39.310103831Z [inf]  INFO:     100.64.0.13:34248 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:20:39.310109773Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (818.6ms)
2026-04-19T21:20:39.310123366Z [inf]  INFO:     100.64.0.12:38202 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:20:40.153480810Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (1615.6ms)
2026-04-19T21:20:40.153486123Z [inf]  INFO:     100.64.0.22:10480 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:20:47.323531799Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (639.8ms)
2026-04-19T21:20:47.323535818Z [inf]  INFO:     100.64.0.17:20010 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:20:48.157358915Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (1446.2ms)
2026-04-19T21:20:48.157364493Z [inf]  INFO:     100.64.0.19:28854 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:20:48.803233668Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (2535.6ms)
2026-04-19T21:20:48.803239741Z [inf]  INFO:     100.64.0.14:60642 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:21:08.769610603Z [inf]  GET / → 200 (1.7ms)
2026-04-19T21:21:08.769616831Z [inf]  INFO:     100.64.0.5:15270 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:21:38.996875382Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1439.9ms)
2026-04-19T21:21:38.996879332Z [inf]  INFO:     100.64.0.14:32728 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:21:38.996883576Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2243.7ms)
2026-04-19T21:21:38.996887107Z [inf]  INFO:     100.64.0.12:56676 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:21:46.060862979Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (9814.0ms)
2026-04-19T21:21:46.060867780Z [inf]  INFO:     100.64.0.15:51414 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:22:15.993622614Z [inf]  GET / → 200 (1.5ms)
2026-04-19T21:22:15.993629152Z [inf]  INFO:     100.64.0.30:49854 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:23:16.534959563Z [inf]  GET / → 200 (1.6ms)
2026-04-19T21:23:16.534965055Z [inf]  INFO:     100.64.0.5:11944 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:24:17.035413226Z [inf]  GET / → 200 (1.5ms)
2026-04-19T21:24:17.035418078Z [inf]  INFO:     100.64.0.33:23800 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:24:17.035424534Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (707.6ms)
2026-04-19T21:24:17.035431027Z [inf]  INFO:     100.64.0.12:35110 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:24:17.035437130Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2238.5ms)
2026-04-19T21:24:17.035441553Z [inf]  INFO:     100.64.0.13:48794 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:24:20.672435114Z [inf]  GET /api/v1/optimizer/rates → 200 (9283.0ms)
2026-04-19T21:24:20.672449943Z [inf]  INFO:     100.64.0.17:51104 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:24:20.672456181Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (9282.9ms)
2026-04-19T21:24:20.672462162Z [inf]  INFO:     100.64.0.17:51114 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:25:10.821756394Z [inf]  GET / → 200 (1.5ms)
2026-04-19T21:25:10.821768082Z [inf]  INFO:     100.64.0.21:29014 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:26:11.099335503Z [inf]  GET / → 200 (1.7ms)
2026-04-19T21:26:11.099340619Z [inf]  INFO:     100.64.0.33:37104 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:27:11.202243651Z [inf]  GET / → 200 (1.5ms)
2026-04-19T21:27:11.202247501Z [inf]  INFO:     100.64.0.16:50308 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:27:51.002884228Z [inf]  GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (1493.2ms)
2026-04-19T21:27:51.002892497Z [inf]  INFO:     100.64.0.12:11444 - "GET /api/v1/accounts/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:27:51.990701408Z [inf]  GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status → 200 (2993.8ms)
2026-04-19T21:27:51.990705892Z [inf]  INFO:     100.64.0.18:54012 - "GET /api/v1/rebalance/0xea5e76244dcAE7b17d9787b804F76dAaF6923184/status?limit=20&offset=0 HTTP/1.1" 200 OK
2026-04-19T21:27:57.517856206Z [inf]  GET /api/v1/optimizer/rates → 200 (8693.7ms)
2026-04-19T21:27:57.517863130Z [inf]  INFO:     100.64.0.15:18274 - "GET /api/v1/optimizer/rates HTTP/1.1" 200 OK
2026-04-19T21:27:57.517867203Z [inf]  GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 → 200 (8689.5ms)
2026-04-19T21:27:57.517870720Z [inf]  INFO:     100.64.0.19:53886 - "GET /api/v1/portfolio/0xea5e76244dcAE7b17d9787b804F76dAaF6923184 HTTP/1.1" 200 OK
2026-04-19T21:28:17.490682507Z [inf]  GET / → 200 (1.6ms)
2026-04-19T21:28:17.490690195Z [inf]  INFO:     100.64.0.34:17020 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:29:17.340902665Z [inf]  GET / → 200 (1.9ms)
2026-04-19T21:29:17.340906982Z [inf]  INFO:     100.64.0.16:60904 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:30:17.475077161Z [inf]  GET / → 200 (1.7ms)
2026-04-19T21:30:17.475081687Z [inf]  INFO:     100.64.0.7:54676 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:31:17.707638950Z [inf]  GET / → 200 (1.6ms)
2026-04-19T21:31:17.707645652Z [inf]  INFO:     100.64.0.28:31612 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:32:17.828147325Z [inf]  GET / → 200 (1.5ms)
2026-04-19T21:32:17.828152966Z [inf]  INFO:     100.64.0.31:34326 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:33:17.989223267Z [inf]  GET / → 200 (1.9ms)
2026-04-19T21:33:17.989227161Z [inf]  INFO:     100.64.0.9:54190 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:34:17.917533568Z [inf]  GET / → 200 (1.9ms)
2026-04-19T21:34:17.917537781Z [inf]  INFO:     100.64.0.9:22454 - "GET / HTTP/1.1" 200 OK
2026-04-19T21:35:08.574110332Z [inf]  GET / → 200 (2.5ms)
2026-04-19T21:35:08.574116449Z [inf]  INFO:     100.64.0.35:45796 - "GET / HTTP/1.1" 200 OK
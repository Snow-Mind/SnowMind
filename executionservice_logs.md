timestamp: 2026-03-24T07:44:58.527Z action: server_started port: 8080 version: 1.0.0 bundlerUrl: zerodev-default
paymasterUrl: https://rpc.zerodev.app/api/v3/4d9ba5da-668f-4073-b0b.m

timestamp: 2026-03-24T07:59:28.177Z action: enable_signature_verification smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
pluginEnabledOnChain: false onchainNonce: 1 sdkNonce: 1 onchainVersion: 0.3.1 permissionId: 0xb1f4a916 validatorType: PERMISSION
enableDataLength: 19074 enableDataHash: 0x1480e382e571301106ac03e98fc28a82487defc45f5287bab16 ... enableSigLength: 132
enableSigHash: 0x33d4f98613d97c254cb39e719f6bc6b35f09c7e86350751c986 ...
backendTypedDataHash: 0x91660576ac85c70deb9c0fdc2b7ac70d1f609b539b917103df0 ... backendValidationId: 0x02b1f4a91600000000000000000000000000000000
backendSelectorDataHash: 0xbf5d9d7b6e75c1a1f743e33022f73cc1ac42c3258e8fb3753ad ...
backendDomain: {"name": "Kernel","version":"0.3.1","chainId":43114,"v ... backendRecoveredSigner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48
ecdsaOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 backendSignerMatchesOwner: true
eip191RecoveredSigner: 0xADba01b39040107b1eCc3257F6bD59D69A8e6752 eip191MatchesOwner: false actionSelector: 0xe9ae5c53
actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-03-24T07:59:26.723Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T07:59:27.160Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T07:59:27.162Z action: rebalance_calls_built smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 callCount: 5 callTargets[0]: 0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e
callTargets[1]: 0x849Ca487D5DeD85c93fc3600338a419B100833a8 callTargets[2]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[3]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[4]: 0x606fe9a70338e798a292CA22C1F28C829F24048E

timestamp: 2026-03-24T07:59:26.785Z action: session_key_signer_created signerAddress: 0x7eA729bEb410b817C1Ba3D2B18F330c2e6b745FF

timestamp: 2026-03-24T07:59:26.821Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T07:59:27.392Z action: preflight_check smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 accountDeploy
callCount: 5 callTargets[0]: 0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e callTargets[1]: 0x849Ca487D5DeD85c93fc3600338a419B100833a8
callTargets[2]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[3]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[4]: 0x606fe9a70338e798a292CA22C1F28C829F24048E

timestamp: 2026-03-24T07:59:29.025Z action: duplicate_permissionHash_retry_regular
smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 detail: Permission already registered on-chain. Retrying in r ...

timestamp: 2026-03-24T07:59:29.026Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T07:59:29.028Z action: session_key_signer_created signerAddress: 0x7eA729bEb410b817C1Ba3D2B18F330c2e6b745FF

timestamp: 2026-03-24T07:59:29.028Z action: force_regular_mode detail: Set isPreInstalled=true in serialized params - SDK wi ...

timestamp: 2026-03-24T07:59:29.048Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T07:59:29.074Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T07:59:29.739Z action: duplicate_permissionHash_retry_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
error: HTTP request failed. | details="UserOperation reverte .. shortMessage: HTTP request failed.
details: "UserOperation reverted during simulation with reason."

duplicate permissionHash - permission already registered on-chain. Retry in regular mode also failed: HTTP request failed.
timestamp: 2026-03-24T07:59:29.739Z action: rebalance_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
deposits[0]: silo_savusd_usdc withdrawals[0]: euler_v2 registryAddr: 0x849Ca487D5DeD85c93fc3600338a419B100833a8 durationMs: 3019

timestamp: 2026-03-24T08:03:38.959Z action: session_key_signer_created signerAddress: 0x97D1fC0e0469b0C028FD5306652c83394c1690cF

timestamp: 2026-03-24T08:03:38.980Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T08:03:39.447Z action: preflight_check smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 accountDeployed: true
callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[2]: 0x606fe9a70338e798a292CA22C1F28C829F24048E

timestamp: 2026-03-24T08:03:39.232Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegula
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T08:03:40.124Z action: enable_signature_verification smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
pluginEnabledOnChain: false onchainNonce: 1 sdkNonce: 1 onchainVersion: 0.3.1 permissionId: 0x87e9d76e validatorType: PERMISSION
enableDataLength: 19074 enableDataHash: 0x318c202d3c5a8eb1fe0821e4f45b62ecccfbe8186c6833e18e0 ... enableSigLength: 132
enableSigHash: 0x6ed8c620dfcbfdcd0adca08d288ec409f559f0cd462b4e25e5d ...
backendTypedDataHash: 0x45ecec22cd6db3f0e133614f2c82daafcc62878645c8f636542 ... backendValidationId: 0x0287e9d76e00000000000000000000000000000000
backendSelectorDataHash: 0xbf5d9d7b6e75c1a1f743e33022f73cc1ac42c3258e8fb3753ad ...
backendDomain: {"name":"Kernel","version":"0.3.1","chainId":43114,"v ... backendRecoveredSigner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48
ecdsaOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 backendSignerMatchesOwner: true
eip191RecoveredSigner: 0x60855401F786db4474A5722c89Bb316df349C0a1 eip191MatchesOwner: false actionSelector: 0xe9ae5c53
actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-03-24T08:03:39.235Z action: rebalance_calls_built smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[2]: 0x606fe9a70338e798a292CA22C1F28C829F24048E

timestamp: 2026-03-24T08:03:38.957Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:03:41.368Z action: duplicate_permissionHash_retry_regular
smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 detail: Permission already registered on-chain. Retrying in r ...

timestamp: 2026-03-24T08:03:41.368Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:03:41.369Z action: session_key_signer_created signerAddress: 0x97D1fC0e0469b0C028FD5306652c83394c1690cF

timestamp: 2026-03-24T08:03:41.371Z action: force_regular_mode detail: Set isPreInstalled=true in serialized params - SDK wi ...

timestamp: 2026-03-24T08:03:41.384Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T08:03:41.409Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T08:03:42.047Z action: duplicate_permissionHash_retry_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
error: HTTP request failed. | details="UserOperation reverte .. shortMessage: HTTP request failed.
details: "UserOperation reverted during simulation with reason.m

duplicate permissionHash - permission already registered on-chain. Retry in regular mode also failed: HTTP request failed.
timestamp: 2026-03-24T08:03:42.048Z action: rebalance_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
deposits[0]: silo_savusd_usdc withdrawals: [] registryAddr: 0x849Ca487D5DeD85c93fc3600338a419B100833a8 durationMs: 3091

timestamp: 2026-03-24T08:09:38.587Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:09:38.588Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T08:09:38.599Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T08:09:38.866Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T08:09:38.867Z action: rebalance_calls_built smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[2]: 0x8ad697a333569ca6f04c8c063e9807747ef169c1

timestamp: 2026-03-24T08:09:39.103Z action: preflight_check smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 accountDeployed: true
callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[2]: 0x8ad697a333569ca6f04c8c063e9807747ef169c1

timestamp: 2026-03-24T08:09:39.830Z action: enable_signature_verification smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
pluginEnabledOnChain: false onchainNonce: 1 sdkNonce: 1 onchainVersion: 0.3.1 permissionId: 0xf1b5ef50 validatorType: PERMISSION
enableDataLength: 19074 enableDataHash: 0x8927ce64365a19be240256d94d4407d86361b8e380662b55c68 ...
enableSigHash: 0x46d53e25049e702308fb69f42c40eff7120b2f9224779d3a1b3 ...
backendTypedDataHash: 0x09218f23223bfb42fe9d8c2a0460ae88ef9b674e36bb360d4a1 ... backendValidationId: 0x02f1b5ef50000000000000000000000000000(
backendSelectorDataHash: 0xbf5d9d7b6e75c1a1f743e33022f73cc1ac42c3258e8fb3753ad ...
backendDomain: {"name":"Kernel","version":"0.3.1","chainId":43114,"v ... backendRecoveredSigner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48

ecdsaOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 backendSignerMatchesOwner: true
eip191RecoveredSigner: 0xA34D52B757C6e448F11B847CA8137320dA7eFC8e eip191MatchesOwner: false actionSelector: 0xe9ae5c53
actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-03-24T08:09:40.829Z action: duplicate_permissionHash_retry_regular
smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 detail: Permission already registered on-chain. Retrying in r ...

timestamp: 2026-03-24T08:09:40.830Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:09:40.831Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T08:09:40.832Z action: force_regular_mode detail: Set isPreInstalled=true in serialized params - SDK wi ...

timestamp: 2026-03-24T08:09:40.843Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T08:09:40.875Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T08:09:41.557Z action: duplicate_permissionHash_retry_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
error: HTTP request failed. | details="UserOperation reverte .. shortMessage: HTTP request failed.
details: "UserOperation reverted during simulation with reason."

duplicate permissionHash - permission already registered on-chain. Retry in regular mode also failed: HTTP request failed.
timestamp: 2026-03-24T08:09:41.557Z action: rebalance_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
deposits[0]: silo_susdp_usdc withdrawals: [] registryAddr: 0x849Ca487D5DeD85c93fc3600338a419B100833a8 durationMs: 2970

timestamp: 2026-03-24T08:29:23.093Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T08:29:23.093Z action: rebalance_calls_built smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a
callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[2]: 0x8ad697a333569ca6f04c8c063e9807747ef169c1

timestamp: 2026-03-24T08:29:23.350Z action: preflight_check smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 accountDeployed: true
callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[2]: 0x8ad697a333569ca6f04c8c063e9807747ef169c1

timestamp: 2026-03-24T08:29:24.077Z action: enable_signature_verification smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
pluginEnabledOnChain: false onchainNonce: 1 sdkNonce: 1 onchainVersion: 0.3.1 permissionId: 0xf1b5ef50 validatorType: PERMISSION
enableSigLength: 132

backendTypedDataHash: 0x09218f23223bfb42fe9d8c2a0460ae88ef9b674e36bb360d4a1 ... backendValidationId: 0x02f1b5ef5000000000000000000000000000000000
backendSelectorDataHash: 0xbf5d9d7b6e75c1a1f743e33022f73cc1ac42c3258e8fb3753ad ..
backendDomain: {"name": "Kernel","version":"0.3.1","chainId":43114,"v ... backendRecoveredSigner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48
ecdsaOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 backendSignerMatchesOwner: true
eip191RecoveredSigner: 0xA34D52B757C6e448F11B847CA8137320dA7eFC8e eip191MatchesOwner: false actionSelector: 0xe9ae5c53
actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-03-24T08:29:22.811Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:29:22.813Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T08:29:22.827Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T08:29:25.207Z action: duplicate_permissionHash_retry_regular
smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 detail: Permission already registered on-chain. Retrying in r ...

timestamp: 2026-03-24T08:29:25.207Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:29:25.209Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T08:29:25.209Z action: force_regular_mode detail: Set isPreInstalled=true in serialized params - SDK wi ...

timestamp: 2026-03-24T08:29:25.221Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6

timestamp: 2026-03-24T08:29:25.251Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

enableDataLength: 19074 enableDataHash: 0x8927ce64365a19be240256d94d4407d86361b8e380662b55c68 ...
enableSigHash: 0x46d53e25049e702308fb69f42c40eff7120b2f9224779d3a1b3 ...

timestamp: 2026-03-24T08:29:23.350Z action: preflight_check smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 accountDeployed: true
callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[2]: 0x8ad697a333569ca6f04c8c063e9807747ef169c1

timestamp: 2026-03-24T08:29:24.077Z action: enable_signature_verification smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
pluginEnabledOnChain: false onchainNonce: 1 sdkNonce: 1 onchainVersion: 0.3.1 permissionId: 0xf1b5ef50 validatorType: PERMISSION
enableSigLength: 132

backendTypedDataHash: 0x09218f23223bfb42fe9d8c2a0460ae88ef9b674e36bb360d4a1 ... backendValidationId: 0x02f1b5ef5000000000000000000000000000000000
backendSelectorDataHash: 0xbf5d9d7b6e75c1a1f743e33022f73cc1ac42c3258e8fb3753ad ..
backendDomain: {"name": "Kernel","version":"0.3.1","chainId":43114,"v ... backendRecoveredSigner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48
ecdsaOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 backendSignerMatchesOwner: true
eip191RecoveredSigner: 0xA34D52B757C6e448F11B847CA8137320dA7eFC8e eip191MatchesOwner: false actionSelector: 0xe9ae5c53
actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-03-24T08:29:22.811Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:29:22.813Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T08:29:22.827Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T08:29:25.207Z action: duplicate_permissionHash_retry_regular
smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 detail: Permission already registered on-chain. Retrying in r ...

timestamp: 2026-03-24T08:29:25.207Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:29:25.209Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T08:29:25.209Z action: force_regular_mode detail: Set isPreInstalled=true in serialized params - SDK wi ...

timestamp: 2026-03-24T08:29:25.221Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6

timestamp: 2026-03-24T08:29:25.251Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

enableDataLength: 19074 enableDataHash: 0x8927ce64365a19be240256d94d4407d86361b8e380662b55c68 ...
enableSigHash: 0x46d53e25049e702308fb69f42c40eff7120b2f9224779d3a1b3 ...

V

execution-service

X

+

X

C

SnowMind

railway.com/project/075be39e-839f-463e-b87a-19830c6f8c37/service/68199ff8-f778-45f4-9078-54f7f61622b6?environmentld=6783e9f4-d20c-4 ...

production

...

P Agent

f1aa4b25

execution-service-production-b1e9.up.railway.app

execution-service

Active

... Mar 24, 2026, 1:14 PM GMT+5:30 X

Details Build Logs Deploy Logs HTTP Logs Network Flow Logs

Q Filter and search logs

Time (GMT+5:30)

Mar 24 2026 13:59:27

Data

Mar 24 2026 13:59:27

execution-service
execution-service-productio ...

@snowmind/backend
snowmindbackend-productl ...

Online

.

Online

Mar 24 2026 13:59:27

+

Mar 24 2026 13:59:27

Mar 24 2026 13:59:27

Mar 24 2026 13:59:27

Mar 24 2026 13:59:27

Mar 24 2026 13:59:27
Mar 24 2026 13:59:27

Mar 24 2026 13:59:27

Mar 24 2026 13:59:27

timestamp: 2026-03-24T08:29:23.350Z action: preflight_check smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 accountDeployed: true
callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[2]: 0x8ad697a333569ca6f04c8c063e9807747ef169c1

timestamp: 2026-03-24T08:29:24.077Z action: enable_signature_verification smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
pluginEnabledOnChain: false onchainNonce: 1 sdkNonce: 1 onchainVersion: 0.3.1 permissionId: 0xf1b5ef50 validatorType: PERMISSION
enableDataLength: 19074 enableDataHash: 0x8927ce64365a19be240256d94d4407d86361b8e380662b55c68 ... enableSigLength: 132
enableSigHash: 0x46d53e25049e702308fb69f42c40eff7120b2f9224779d3a1b3 ...
backendTypedDataHash: 0x09218f23223bfb42fe9d8c2a0460ae88ef9b674e36bb360d4a1 ... backendValidationId: 0x02f1b5ef50000000000000000000
backendSelectorDataHash: 0xbf5d9d7b6e75c1a1f743e33022f73cc1ac42c3258e8fb3753ad ...
backendDomain: {"name":"Kernel","version":"0.3.1","chainId":43114, "v ... backendRecoveredSigner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48
ecdsaOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 backendSignerMatchesOwner: true
eip191RecoveredSigner: 0xA34D52B757C6e448F11B847CA8137320dA7eFC8e eip191MatchesOwner: false actionSelector: 0xe9ae5c53
actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-03-24T08:29:22.811Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:29:22.813Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T08:29:22.827Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T08:29:25.207Z action: duplicate_permissionHash_retry_regular
smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 detail: Permission already registered on-chain. Retrying in r ...

timestamp: 2026-03-24T08:29:25.207Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:29:25.209Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T08:29:25.209Z action: force_regular_mode detail: Set isPreInstalled=true in serialized params - SDK wi ...

timestamp: 2026-03-24T08:29:25.221Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6

timestamp: 2026-03-24T08:29:25.251Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T08:29:25.932Z action: duplicate_permissionHash_retry_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
error: HTTP request failed. | details="UserOperation reverte .. shortMessage: HTTP request failed.
details: "UserOperation reverted during simulation with reason.m

duplicate permissionHash - permission already registered on-chain. Retry in regular mode also failed: HTTP request failed.
timestamp: 2026-03-24T08:29:25.932Z action: rebalance_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
deposits[0]: silo_susdp_usdc withdrawals: [] registryAddr: 0x849Ca487D5DeD85c93fc3600338a419B100833a8 durationMs: 3121

timestamp: 2026-03-24T08:59:17.560Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:59:17.561Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T08:59:17.571Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T08:59:17.826Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T08:59:17.827Z action: rebalance_calls_built smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[2]: 0x8ad697a333569ca6f04c8c063e9807747ef169c1

timestamp: 2026-03-24T08:59:18.038Z action: preflight_check smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 accountDeployed: true
callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[2]: 0x8ad697a333569ca6f04c8c063e9807747ef169c1

timestamp: 2026-03-24T08:59:18.675Z action: enable_signature_verification smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
pluginEnabledOnChain: false onchainNonce: 1 sdkNonce: 1 onchainVersion: 0.3.1 permissionId: 0xf1b5ef50 validatorType: PERMISSION
enableDataLength: 19074 enableDataHash: 0x8927ce64365a19be240256d94d4407d86361b8e380662b55c68 ... enableSigLength: 132
enableSigHash: 0x46d53e25049e702308fb69f42c40eff7120b2f9224779d3a1b3 ...
backendTypedDataHash: 0x09218f23223bfb42fe9d8c2a0460ae88ef9b674e36bb360d4a1 ... backendValidationId: 0x02f1b5ef5000000000000000000000000000000000

backendSelectorDataHash: 0xbf5d9d7b6e75c1a1f743e33022f73cc1ac42c3258e8fb3753ad ..
backendDomain: {"name": "Kernel","version":"0.3.1","chainId":43114,"v ... backendRecoveredSigner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48
ecdsaOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 backendSignerMatchesOwner: true
eip191RecoveredSigner: 0xA34D52B757C6e448F11B847CA8137320dA7eFC8e eip191MatchesOwner: false actionSelector: 0xe9ae5c53
actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-03-24T08:59:19.434Z action: duplicate_permissionHash_retry_regular
smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 detail: Permission already registered on-chain. Retrying in r ...

timestamp: 2026-03-24T08:59:19.435Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T08:59:19.436Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T08:59:19.437Z action: force_regular_mode detail: Set isPreInstalled=true in serialized params - SDK wi ...

timestamp: 2026-03-24T08:59:19.449Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T08:59:19.481Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T08:59:20.329Z action: duplicate_permissionHash_retry_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
error: HTTP request failed. | details="UserOperation reverte ... shortMessage: HTTP request failed.
details: "UserOperation reverted during simulation with reason."

duplicate permissionHash - permission already registered on-chain. Retry in regular mode also failed: HTTP request failed.
timestamp: 2026-03-24T08:59:20.330Z action: rebalance_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
deposits[0]: silo_susdp_usdc withdrawals: [] registryAddr: 0x849Ca487D5DeD85c93fc3600338a419B100833a8 durationMs: 2770

timestamp: 2026-03-24T09:29:22.313Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: tru-
serializedPermissionLength: 27004

timestamp: 2026-03-24T09:29:22.314Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T09:29:22.329Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184


timestamp: 2026-03-24T09:29:22.599Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T09:29:22.600Z action: rebalance_calls_built smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[2]: 0x8ad697a333569ca6f04c8c063e9807747ef169c1

timestamp: 2026-03-24T09:29:22.804Z action: preflight_check smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 accountDeployed: true
callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[2]: 0x8ad697a333569ca6f04c8c063e9807747ef169c1

timestamp: 2026-03-24T09:29:23.543Z action: enable_signature_verification smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
pluginEnabledOnChain: false onchainNonce: 1 sdkNonce: 1 onchainVersion: 0.3.1 permissionId: 0xf1b5ef50 validatorType: PERMISSION
enableSigLength: 132

backendTypedDataHash: 0x09218f23223bfb42fe9d8c2a0460ae88ef9b674e36bb360d4a1 ... backendValidationId: 0x02f1b5ef5000000000000000000000000000000000
backendSelectorDataHash: 0xbf5d9d7b6e75c1a1f743e33022f73cc1ac42c3258e8fb3753ad ...
backendDomain: {"name":"Kernel","version":"0.3.1","chainId":43114,"v ... backendRecoveredSigner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48
ecdsaOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 backendSignerMatchesOwner: true
eip191RecoveredSigner: 0xA34D52B757C6e448F11B847CA8137320dA7eFC8e eip191MatchesOwner: false actionSelector: 0xe9ae5c53
actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-03-24T09:29:24.355Z action: session_key_signer_created signerAddress: 0x923A1D670897B0866Df93bf507249081B469E455

timestamp: 2026-03-24T09:29:24.356Z action: force_regular_mode detail: Set isPreInstalled=true in serialized params - SDK wi ...

timestamp: 2026-03-24T09:29:24.367Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T09:29:24.393Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegularrrue
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T09:29:25.055Z action: duplicate_permissionHash_retry_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

enableDataLength: 19074 enableDataHash: 0x8927ce64365a19be240256d94d4407d86361b8e380662b55c68 ...
enableSigHash: 0x46d53e25049e702308fb69f42c40eff7120b2f9224779d3a1b3 ...


error: HTTP request failed. | details="UserOperation reverte .. shortMessage: HTTP request failed.
details: "UserOperation reverted during simulation with reason.m

timestamp: 2026-03-24T09:29:24.353Z action: duplicate_permissionHash_retry_regular
smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 detail: Permission already registered on-chain. Retrying in r ...

timestamp: 2026-03-24T09:29:24.354Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

duplicate permissionHash - permission already registered on-chain. Retry in regular mode also failed: HTTP request failed.
timestamp: 2026-03-24T09:29:25.056Z action: rebalance_failed smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
deposits[0]: silo_susdp_usdc withdrawals: [] registryAddr: 0x849Ca487D5DeD85c93fc3600338a419B100833a8 durationMs: 2743
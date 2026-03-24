timestamp: 2026-03-24T07:22:02.486Z action: server_started port: 8080 version: 1.0.0 bundlerUrl: zerodev-default
paymasterUrl: https://rpc.zerodev.app/api/v3/4d9ba5da-668f-4073-b0b ..

timestamp: 2026-03-24T07:29:24.850Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T07:29:24.917Z action: session_key_signer_created signerAddress: 0x7eA729bEb410b817C1Ba3D2B18F330c2e6b745FF

timestamp: 2026-03-24T07:29:24.954Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T07:29:25.241Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-03-24T07:29:25.243Z action: rebalance_calls_built smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 callCount: 5 callTargets[0]: 0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e
callTargets[1]: 0x849Ca487D5DeD85c93fc3600338a419B100833a8 callTargets[2]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[3]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[4]: 0x606fe9a70338e798a292CA22C1F28C829F24048E

timestamp: 2026-03-24T07:29:25.454Z action: preflight_check smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 accountDeployed: true
callCount: 5 callTargets[0]: 0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e callTargets[1]: 0x849Ca487D5DeD85c93fc3600338a419B100833a8
callTargets[2]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[3]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[4]: 0x606fe9a70338e798a292CA22C1F28C829F24048E

timestamp: 2026-03-24T07:29:26.185Z action: enable_signature_verification smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
pluginEnabledOnChain: false onchainNonce: 1 sdkNonce: 1 onchainVersion: 0.3.1 permissionId: 0xb1f4a916 validatorType: PERMISSION
enableDataLength: 19074 enableDataHash: 0x1480e382e571301106ac03e98fc28a82487defc45f5287bab16 ... enableSigLength: 132
enableSigHash: 0x33d4f98613d97c254cb39e719f6bc6b35f09c7e86350751c986 ...
backendTypedDataHash: 0x91660576ac85c70deb9c0fdc2b7ac70d1f609b539b917103df0 .. backendValidationId: 0x02b1f4a91600000000000000000000000000000000
backendSelectorDataHash: 0xbf5d9d7b6e75c1a1f743e33022f73cc1ac42c3258e8fb3753ad ...
backendDomain: {"name": "Kernel","version":"0.3.1","chainId":43114,"v ... backendRecoveredSigner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48
ecdsaOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 backendSignerMatchesOwner: true
eip191RecoveredSigner: 0xADba01b39040107b1eCc3257F6bD59D69A8e6752 eip191MatchesOwner: false actionSelector: 0xe9ae5c53
actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-03-24T07:29:27.593Z action: duplicate_permissionHash_retry_regular
smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 detail: Permission already registered on-chain. Retrying in r ...

timestamp: 2026-03-24T07:29:27.594Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 27004

timestamp: 2026-03-24T07:29:27.595Z action: session_key_signer_created signerAddress: 0x7eA729bEb410b817C1Ba3D2B18F330c2e6b745FF

timestamp: 2026-03-24T07:29:27.608Z action: permission_account_deserialized permissionAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T07:29:27.608Z action: force_regular_mode detail: Cleared enable signature - using regular validation m ...
smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184

timestamp: 2026-03-24T07:29:27.641Z action: onchain_state_diagnostic smartAccount: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184
ecdsaValidatorOwner: 0xE476858Cf5fBa6D45Bc6F7c082edC5D3C4737a48 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

extractErrorComponents is not defined timestamp: 2026-03-24T07:29:28.474Z action: rebalance_failed
smartAccountAddress: 0xea5e76244dcAE7b17d9787b804F76dAaF6923184 deposits[0]: silo_savusd_usdc withdrawals[0]: euler_v2
registryAddr: 0x849Ca487D5DeD85c93fc3600338a419B100833a8 durationMs: 3626
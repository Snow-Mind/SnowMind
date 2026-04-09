timestamp: 2026-04-07T23:32:21.054Z action: rebalance_calls_built smartAccountAddress: 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268
permissionAccountAddress: 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268 callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[2]: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C callDetails[0].index: 0
callDetails[0].target: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callDetails[0].selector: 0x095ea7b3
callDetails[0].decoded: approve(address, spender,uint256,amount) callDetails[0].dataLength: 138 callDetails[1].index: 1
callDetails[1].target: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callDetails[1].selector: 0x095ea7b3
callDetails[1].decoded: approve(address, spender,uint256,amount) callDetails[1].dataLength: 138 callDetails[2].index: 2
callDetails[2].target: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C callDetails[2].selector: 0xa0712d68 callDetails[2].decoded: mint(uint256)
callDetails[2].dataLength: 74

timestamp: 2026-04-07T23:32:21.242Z action: preflight_check smartAccountAddress: 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268 accountDeployed: true
callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[2]: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C

timestamp: 2026-04-07T23:32:21.427Z action: call_simulation_ok smartAccountAddress: 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268 callIndex: 0
target: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E selector: 0x095ea7b3

timestamp: 2026-04-07T23:32:21.621Z action: call_simulation_ok smartAccountAddress: 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268 callIndex: 1
target: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E selector: 0x095ea7b3

timestamp: 2026-04-07T23:32:21.811Z action: call_simulation_reverted_nonfatal smartAccountAddress: 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268
callIndex: 2 target: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C selector: 0xa0712d68
note: Individual call simulation can fail for state-depende .. error: Execution reverted with reason: ERC20: transfer amoun ...
shortMessage: Execution reverted with reason: ERC20: transfer amoun .. details: execution reverted: ERC20: transfer amount exceeds al ..
causeMessage: Execution reverted with reason: ERC20: transfer amoun.m

timestamp: 2026-04-07T23:32:22.004Z action: batch_simulation_ok smartAccountAddress: 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268 callCount: 3

timestamp: 2026-04-07T23:32:22.241Z action: enable_signature_verification smartAccountAddress: 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268
pluginEnabledOnChain: true pluginEnabledOnChainNote: WARNING: checks action selector only, not specific pe .. onchainNonce: 1 sdkNonce: 1
onchainVersion: 0.3.1 permissionId: 0x58023dd4 validatorType: PERMISSION enableDataLength: 15362
enableDataHash: 0x4e3bd06da53b2d9f9c10877dea9fe9bf4fe178a75f3bd216d7e ... enableSigLength: 0
enableSigLengthNote: Expected 0 - forceRegularMode deletes enableSig from .. blobEnableSigLength: 132

blobEnableSigNote: From ORIGINAL blob before any modification - authorit .. enableSigHash: none backendTypedDataHash: none
backendValidationId: none backendSelectorDataHash: none backendDomain: none backendRecoveredSigner: unable_to_recover
ecdsaOwner: 0xDf73bdD7D30D4C97AD35d14Cb551fDcF57aCdCBA backendSignerMatchesOwner: false eip191RecoveredSigner: not_computed
eip191MatchesOwner: false actionSelector: 0xe9ae5c53 actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-04-07T23:32:27.455Z action: rebalance_executed smartAccountAddress: 0xF8Ea69DbAf7E0ada970d91A168A4eC85DE6fF268
txHash: 0x4384d79c87795122ebce4474fa0be85d5ad5f92a2782ca7708e ... deposits: 1 withdrawals: 0 durationMs: 7068

timestamp: 2026-04-08T15:15:06.164Z action: blob_enable_sig_check smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6
blobHasEnableSig: true blobEnableSigLength: 132 blobIsPreInstalled: false

timestamp: 2026-04-08T15:15:06.439Z action: mode_selection_entrypoint_nonce_zero smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6
permissionId: 0x1da8c510 regularSeq: 0 enableSeq: 0 detail: EntryPoint nonce = 0 for BOTH enable and regular keys ..

timestamp: 2026-04-08T15:15:06.439Z action: mode_selection smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6
useEnableModeFirst: true initialForceRegular: false permissionId: 0x1da8c510 entryPointSequence: 0
reason: Blob contains enableSignature + EntryPoint sequence=0 ...

timestamp: 2026-04-08T15:15:06.439Z action: getKernelClient_init hasSessionPrivateKey: true sessionPrivateKeyLength: 66 withPaymaster: true
serializedPermissionLength: 24624

timestamp: 2026-04-08T15:15:06.441Z action: session_key_signer_created signerAddress: 0xEB7026eDB699978AeeBf620986CC73F38644579E

timestamp: 2026-04-08T15:15:06.449Z action: permission_account_deserialized permissionAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6

timestamp: 2026-04-08T15:15:06.659Z action: onchain_state_diagnostic smartAccount: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6
ecdsaValidatorOwner: 0xD0ec8BBf8C84153d077DD7D7f707f48723a9B942 currentNonce: 1 pluginManager.activeMode: regular pluginManager.hasRegular: true
pluginManager.hasSudo: false pluginManager.hasPluginEnableSig: true

timestamp: 2026-04-08T15:15:06.659Z action: enable_data_diagnostic_skipped reason: sudo validator not set in current plugin mode

timestamp: 2026-04-08T15:15:06.863Z action: preflight_usdc_balance smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6
usdcBalance: 1000000 usdcBalanceFormatted: $1.000000

timestamp: 2026-04-08T15:15:06.863Z action: rebalance_calls_built smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6
permissionAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6 callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[2]: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C callDetails[0].index: 0
callDetails[0].target: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callDetails[0].selector: 0x095ea7b3
callDetails[0].decoded: approve(address,spender,uint256, amount) callDetails[0].dataLength: 138 callDetails[1].index: 1
callDetails[1].target: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callDetails[1].selector: 0x095ea7b3
callDetails[1].decoded: approve(address,spender,uint256,amount) callDetails[1].dataLength: 138 callDetails[2].index: 2
callDetails[2].target: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C callDetails[2].selector: 0xa0712d68 callDetails[2].decoded: mint(uint256)
callDetails[2].dataLength: 74

timestamp: 2026-04-08T15:15:07.065Z action: preflight_check smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6 accountDeployed: true
callCount: 3 callTargets[0]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E callTargets[1]: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
callTargets[2]: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C

timestamp: 2026-04-08T15:15:07.275Z action: call_simulation_ok smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6 callIndex: 0
target: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E selector: 0x095ea7b3

timestamp: 2026-04-08T15:15:07.493Z action: call_simulation_ok smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6 callIndex: 1
target: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E selector: 0x095ea7b3

timestamp: 2026-04-08T15:15:07.710Z action: call_simulation_reverted_nonfatal smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6
callIndex: 2 target: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C selector: 0xa0712d68
note: Individual call simulation can fail for state-depende .. error: Execution reverted with reason: ERC20: transfer amoun ...
shortMessage: Execution reverted with reason: ERC20: transfer amoun .. details: execution reverted: ERC20: transfer amount exceeds al ...
causeMessage: Execution reverted with reason: ERC20: transfer amoun ..

timestamp: 2026-04-08T15:15:07.922Z action: batch_simulation_ok smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6 callCount: 3

timestamp: 2026-04-08T15:15:08.618Z action: enable_signature_verification smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6
pluginEnabledOnChain: false pluginEnabledOnChainNote: WARNING: checks action selector only, not specific pe ... onchainNonce: 1 sdkNonce: 1
onchainVersion: 0.3.1 permissionId: 0x1da8c510 validatorType: PERMISSION enableDataLength: 15362
enableDataHash: 0xcd15a5ca5c441b70e39bdec94f6f09c1c90416daba83c62ecb9 ... enableSigLength: 132
enableSigLengthNote: From deserialized blob (enable mode) blobEnableSigLength: 132
blobEnableSigNote: From ORIGINAL blob before any modification - authorit .. enableSigHash: 0xe2662ba9b267de526310c1d4e2e90df876d7074304c78cl
backendTypedDataHash: 0x1508512f4cc1a4ef069f783f0f6ff83419fa60ba894f458004d ... backendValidationId: 0x021da8c51000000000000000000000000000000000
backendSelectorDataHash: 0xbf5d9d7b6e75c1a1f743e33022f73cc1ac42c3258e8fb3753ad ...
backendDomain: {"name":"Kernel","version":"0.3.1","chainId":43114,"v ... backendRecoveredSigner: 0xD0ec8BBf8C84153d077DD7D7f707f48723a9B942
ecdsaOwner: 0xD0ec8BBf8C84153d077DD7D7f707f48723a9B942 backendSignerMatchesOwner: true
eip191RecoveredSigner: 0xE7E103521253E6fB087fDc65b8cEe4eca887d398 eip191MatchesOwner: false actionSelector: 0xe9ae5c53
actionAddress: 0x0000000000000000000000000000000000000000 actionHookAddress: none

timestamp: 2026-04-08T15:15:14.563Z action: enable_mode_succeeded smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6
detail: Permission enabled on-chain via first UserOp. Future ...

timestamp: 2026-04-08T15:15:14.563Z action: rebalance_executed smartAccountAddress: 0x714503E5ccDBFfbb58B11FF0d321737DC54738E6
txHash: 0xe4349657ef5bc1b4060346f903791f0dc9a13a4746c6439bc9a ... deposits: 1 withdrawals: 0 durationMs: 8399


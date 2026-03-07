---
name: Protocol Integration Request
about: Request support for a new lending protocol
title: "[Protocol] Add <protocol name>"
labels: enhancement, protocol
assignees: ''
---

## Protocol Details

- **Name**: 
- **Chain**: Avalanche C-Chain
- **Type**: Lending / Vault / Other
- **Contract Address**: 
- **Documentation**: 

## Supply/Withdraw Interface

Describe the functions used to supply and withdraw:

```solidity
// Supply function signature
function supply(address asset, uint256 amount, ...) external;

// Withdraw function signature
function withdraw(address asset, uint256 amount, ...) external;
```

## APY Data Source

How to read the current supply APY on-chain:
- Contract function: 
- Units: (e.g., RAY for Aave = divide by 1e27)
- DefiLlama pool ID: (if available)

## Risk Assessment

- **Audit status**: 
- **TVL**: 
- **Time live on Avalanche**: 
- **Suggested risk score** (1-10): 
- **Suggested max allocation** (%): 

## Additional Context

Any other information about the protocol integration.

# Folks Finance Integration Plan

## Context

SnowMind is adding Folks Finance xChain as a new USDC lending protocol on Avalanche. Folks Finance uses a **Hub-and-Spoke architecture** — all lending logic (pools, oracles, liquidations) lives on Avalanche (the hub). Other chains are "spokes" that relay actions to the hub.

**Key difference from existing protocols:** Folks is NOT ERC-4626. It has a **custom Account + Loan system**. Users must create a Folks Account and a Loan before depositing. This is more complex than Aave/Benqi but fully compatible with smart accounts (no EOA restrictions). The closest existing pattern is Benqi (custom lending pool with receipt tokens).

**Risk scores from report.md:** Oracle 2/2, Collateral 1/2, Architecture 1/1 (static total: 4/5)

---

## How Folks Finance Works (Architecture Overview)

### Contract Architecture

Folks has 3 layers. Users interact with **Spoke contracts** (layer 1), which relay messages to the **Hub** (layer 2), which manages state in **Managers** (layer 3):

```
User (SnowMind smart account)
  │
  ├─ SpokeCommon ──────────► Hub ──────────► AccountManager (creates accounts)
  │   (createAccount,                        LoanManager (manages loans/positions)
  │    withdraw)
  │
  └─ SpokeErc20Token ─────► Hub ──────────► HubPool (fToken, holds USDC)
      (deposit,                              OracleManager (price feeds)
       createLoanAndDeposit)
```

### User-Facing Contracts (what we call)

| Contract | Address | Purpose | Snowtrace |
|---|---|---|---|
| **SpokeCommon** | `0xc03094C4690F3844EA17ef5272Bf6376e0CF2AC6` | Create account, withdraw | [View](https://snowtrace.io/address/0xc03094C4690F3844EA17ef5272Bf6376e0CF2AC6) |
| **SpokeErc20Token (USDC)** | `0xcD68014c002184707eaE7218516cB0762A44fDDF` | Deposit USDC, create loan + deposit | [View](https://snowtrace.io/address/0xcD68014c002184707eaE7218516cB0762A44fDDF) |

### Data-Reading Contracts (what we read from)

| Contract | Address | Purpose | Snowtrace |
|---|---|---|---|
| **USDC HubPool (fToken)** | `0x88f15e36308ED060d8543DA8E2a5dA0810Efded2` | APY, TVL, utilization, balances | [View](https://snowtrace.io/address/0x88f15e36308ED060d8543DA8E2a5dA0810Efded2) |
| **Hub** | `0xb39c03297E87032fF69f4D42A6698e4c4A934449` | Internal routing (don't call directly) | [View](https://snowtrace.io/address/0xb39c03297E87032fF69f4D42A6698e4c4A934449) |
| **Loan Manager** | `0xF4c542518320F09943c35Db6773b2f9FeB2F847e` | Read loan positions | [View](https://snowtrace.io/address/0xF4c542518320F09943c35Db6773b2f9FeB2F847e) |
| **Account Manager** | `0x12Db9758c4D9902334C523b94e436258EB54156f` | Check if account exists | [View](https://snowtrace.io/address/0x12Db9758c4D9902334C523b94e436258EB54156f) |
| **Oracle Manager** | `0x7218Bd1050D41A9ECfc517abdd294FB8116aEe81` | Price feeds (Chainlink + Pyth) | [View](https://snowtrace.io/address/0x7218Bd1050D41A9ECfc517abdd294FB8116aEe81) |
| **Node Manager** | `0x802063A23E78D0f5D158feaAc605028Ee490b03b` | Oracle node graph | [View](https://snowtrace.io/address/0x802063A23E78D0f5D158feaAc605028Ee490b03b) |

### References

- **SDK repo:** https://github.com/Folks-Finance/xchain-js-sdk
- **Contracts repo:** https://github.com/Folks-Finance/xchain-contracts
- **Docs:** https://docs.xapp.folks.finance/
- **Architecture docs:** https://docs.xapp.folks.finance/xlending/architecture
- **Contract addresses:** https://docs.xapp.folks.finance/developers/contracts
- **Security / Audits:** https://docs.xapp.folks.finance/technical-details/security-measures
- **Audit reports:** https://github.com/Folks-Finance/audits (OtterSec xChain audit: May 2024)
- **DefiLlama:** https://defillama.com/protocol/folks-finance-xchain

---

## Deposit / Withdraw Flow (IMPORTANT)

Unlike Aave (just call `supply()`) or ERC-4626 vaults (just call `deposit()`), Folks requires a **3-step setup** for first-time users, then simple calls after that.

### First-Time User (One-Time Setup)

**Step 1: Create a Folks Account**
```solidity
// Call SpokeCommon (0xc03094C4690F3844EA17ef5272Bf6376e0CF2AC6)
function createAccount(
    Messages.MessageParams memory params,  // {adapterId: 1, returnAdapterId: 1, returnGasLimit: 0}
    bytes32 accountId,                      // deterministic: keccak256(abi.encodePacked(bytes32(uint256(uint160(msg.sender))), chainId, nonce))
    bytes4 nonce,                           // 4 random bytes (e.g., 0x00000001)
    bytes32 refAccountId                    // bytes32(0) for no referrer
) external payable
```
- `accountId` is deterministic from the smart account address + chain ID + nonce
- `params.adapterId = 1` for HubAdapter (same-chain Avalanche)
- `msg.value` = small adapter fee (minimal/zero for same-chain)
- **This only needs to happen ONCE per smart account**

**Step 2: Create Loan + First Deposit (combined)**
```solidity
// First approve USDC to SpokeErc20Token
USDC.approve(0xcD68014c002184707eaE7218516cB0762A44fDDF, amount)

// Call SpokeErc20Token (0xcD68014c002184707eaE7218516cB0762A44fDDF)
function createLoanAndDeposit(
    Messages.MessageParams memory params,  // {adapterId: 1, returnAdapterId: 1, returnGasLimit: 0}
    bytes32 accountId,                      // same accountId from step 1
    bytes4 nonce,                           // 4 random bytes for loan ID
    uint256 amount,                         // USDC amount (6 decimals)
    uint16 loanTypeId,                      // loan type (check docs for USDC lending type ID)
    bytes32 loanName                        // human-readable name (e.g., "snowmind-usdc")
) external payable
```
- This creates a Loan position AND deposits USDC in one transaction
- The `loanId` is deterministic: `keccak256(abi.encodePacked(accountId, chainId, nonce))`
- **Save the `accountId` and `loanId` — needed for all future operations**

### Subsequent Deposits (After Setup)
```solidity
// Approve USDC to SpokeErc20Token
USDC.approve(0xcD68014c002184707eaE7218516cB0762A44fDDF, amount)

// Call SpokeErc20Token (0xcD68014c002184707eaE7218516cB0762A44fDDF)
function deposit(
    Messages.MessageParams memory params,
    bytes32 accountId,
    bytes32 loanId,
    uint256 amount
) external payable
```

### Withdrawals
```solidity
// Call SpokeCommon (0xc03094C4690F3844EA17ef5272Bf6376e0CF2AC6)
function withdraw(
    Messages.MessageParams memory params,
    bytes32 accountId,
    bytes32 loanId,
    uint8 poolId,          // 1 for USDC
    uint16 chainId,        // 100 for Avalanche
    uint256 amount,
    bool isFAmount          // false = withdraw USDC amount, true = withdraw by fToken shares
) external payable
```

### Smart Account Compatibility

✅ **Fully compatible with ZeroDev Kernel V3.1 smart accounts.** Verified:
- No `tx.origin` checks
- No ECDSA signature requirements
- No `isContract()` checks
- `AddressOracle` uses `AlwaysEligibleAddressOracle` (accepts all addresses)
- Standard `SafeERC20.safeTransferFrom()` for token transfers
- All authorization is `msg.sender`-based

### State Management

SnowMind needs to persist per-user:
- `accountId` (bytes32) — created once per smart account
- `loanId` (bytes32) — created once per smart account
- Whether the account/loan has been created (boolean flags)

**Suggestion:** Store in Supabase alongside existing session key data. Check on first deposit — if no Folks account exists, batch `createAccount` + `createLoanAndDeposit` in the same UserOp.

---

## Reading On-Chain Data (Rate Fetching)

All data reading is from the **HubPool** contract (`0x88f15e36308ED060d8543DA8E2a5dA0810Efded2`). No SDK needed — just direct view function calls.

### View Functions

```python
# All on HubPool (0x88f15e36308ED060d8543DA8E2a5dA0810Efded2)

getDepositData()
# Returns: (optimalUtilisationRatio, totalAmount, interestRate, interestIndex)
#   totalAmount = total USDC deposited (TVL), in 6 decimals
#   interestRate = deposit rate per second, in 18 decimals

getVariableBorrowData()
# Returns: (vr0, vr1, vr2, totalAmount, interestRate, interestIndex)
#   totalAmount = total variable borrows, in 6 decimals

getStableBorrowData()
# Returns: (sr0, sr1, sr2, sr3, totalAmount, interestRate, averageInterestRate)
#   totalAmount = total stable borrows, in 6 decimals

getConfigData()
# Returns: (deprecated, stableBorrowSupported, flashLoanSupported)
#   deprecated = bool — if true, pool is shutting down

getCapsData()
# Returns: (depositCap, borrowCap)

balanceOf(address)
# Returns: fToken balance (shares)

totalSupply()
# Returns: total fToken supply
```

### APY Calculation

```python
# From getDepositData().interestRate (18 decimals, per-second rate)
rate_per_second = Decimal(str(interest_rate)) / Decimal("1e18")

# SDK uses compoundEveryHour: (1 + rate_per_second * 3600)^8760 - 1
apy = (1 + rate_per_second * 3600) ** Decimal("8760") - 1
```

Reference: SDK source at `xchain-js-sdk/src/common/utils/formulae.ts` → `compoundEveryHour()`

### Utilization

```python
variable_borrows = getVariableBorrowData().totalAmount
stable_borrows = getStableBorrowData().totalAmount
total_deposited = getDepositData().totalAmount

utilization = (variable_borrows + stable_borrows) / total_deposited
```

### TVL

```python
tvl_usdc = Decimal(str(getDepositData().totalAmount)) / Decimal("1e6")
```

### Balance (fToken → USDC)

fTokens accrue interest over time. To convert fToken balance to underlying USDC:
```python
# Option A: Use totalSupply and totalAmount ratio
usdc_balance = (ftoken_balance * deposit_total_amount) / total_supply

# Option B: Check if HubPool exposes a conversion function
# Look for convertToAssets() or similar on Snowtrace
```

### Interest Rate Model

Kinked/Jump Rate model (similar to Aave/Benqi):
- Optimal utilization: 90%
- Below optimal: `rate = R0 + (U / U_opt) * R1`
- Above optimal: `rate = R0 + R1 + ((U - U_opt) / (1 - U_opt)) * R2`
- Reserve/retention ratio: 10%
- Flash loan fee: 0.10%

---

## Files to Modify (8 files)

| # | File | Change |
|---|---|---|
| 1 | `packages/shared-types/src/portfolio.ts` | Add `"folks"` to `ProtocolId` type |
| 2 | `apps/backend/app/core/config.py` | Add Folks contract addresses |
| 3 | `apps/backend/app/services/protocols/folks.py` | **NEW** — Create FolksAdapter |
| 4 | `apps/backend/app/services/protocols/__init__.py` | Register FolksAdapter |
| 5 | `apps/backend/app/services/optimizer/risk_scorer.py` | Add static scores for `"folks"` |
| 6 | `apps/execution/execute.js` | Add deposit/withdraw routing + ABI |
| 7 | `apps/web/lib/constants.ts` | Add PROTOCOL_CONFIG entry + session key selectors |
| 8 | `apps/web/lib/zerodev.ts` | Add Folks call policy to session key permissions |

---

## Step-by-step Implementation

### Step 1: Shared Types

**File:** `packages/shared-types/src/portfolio.ts`

Add `"folks"` to the `ProtocolId` union type:
```typescript
export type ProtocolId = "benqi" | "aave_v3" | "euler_v2" | "spark" | "fluid" | "silo_savusd_usdc" | "silo_susdp_usdc" | "folks" | "idle";
```

---

### Step 2: Backend Config

**File:** `apps/backend/app/core/config.py`

Add to the deployed contracts section (after SILO_SUSDP_VAULT):
```python
# ── Folks Finance addresses ─────────────────────────────
FOLKS_HUBPOOL: str = "0x88f15e36308ED060d8543DA8E2a5dA0810Efded2"        # USDC HubPool (fToken) — read rates/balances
FOLKS_SPOKE_COMMON: str = "0xc03094C4690F3844EA17ef5272Bf6376e0CF2AC6"    # createAccount, withdraw
FOLKS_SPOKE_USDC: str = "0xcD68014c002184707eaE7218516cB0762A44fDDF"      # deposit, createLoanAndDeposit
FOLKS_ACCOUNT_MANAGER: str = "0x12Db9758c4D9902334C523b94e436258EB54156f"  # check account existence
```

---

### Step 3: Backend Protocol Adapter (NEW FILE)

**File:** `apps/backend/app/services/protocols/folks.py`

Create a new adapter following the **Benqi pattern** (closest match — both are custom lending pools with receipt tokens, NOT ERC-4626).

Use `apps/backend/app/services/protocols/benqi.py` as the template. Key differences:
- Rate fetching: `getDepositData()` instead of `supplyRatePerTimestamp()`
- APY: Compound hourly instead of per-second
- Balance: fToken shares → USDC via totalSupply/totalAmount ratio
- Health: `getConfigData().deprecated` instead of comptroller pause flags
- Calldata: SpokeCommon/SpokeErc20Token instead of direct pool calls

**Minimal HubPool ABI (for rate/balance reading):**
```python
FOLKS_HUBPOOL_ABI = [
    {"name": "getDepositData", "type": "function", "inputs": [], "outputs": [
        {"name": "optimalUtilisationRatio", "type": "uint256"},
        {"name": "totalAmount", "type": "uint256"},
        {"name": "interestRate", "type": "uint256"},
        {"name": "interestIndex", "type": "uint256"},
    ], "stateMutability": "view"},
    {"name": "getVariableBorrowData", "type": "function", "inputs": [], "outputs": [
        {"name": "vr0", "type": "uint256"},
        {"name": "vr1", "type": "uint256"},
        {"name": "vr2", "type": "uint256"},
        {"name": "totalAmount", "type": "uint256"},
        {"name": "interestRate", "type": "uint256"},
        {"name": "interestIndex", "type": "uint256"},
    ], "stateMutability": "view"},
    {"name": "getStableBorrowData", "type": "function", "inputs": [], "outputs": [
        {"name": "sr0", "type": "uint256"},
        {"name": "sr1", "type": "uint256"},
        {"name": "sr2", "type": "uint256"},
        {"name": "sr3", "type": "uint256"},
        {"name": "totalAmount", "type": "uint256"},
        {"name": "interestRate", "type": "uint256"},
        {"name": "averageInterestRate", "type": "uint256"},
    ], "stateMutability": "view"},
    {"name": "getConfigData", "type": "function", "inputs": [], "outputs": [
        {"name": "deprecated", "type": "bool"},
        {"name": "stableBorrowSupported", "type": "bool"},
        {"name": "flashLoanSupported", "type": "bool"},
    ], "stateMutability": "view"},
    {"name": "getCapsData", "type": "function", "inputs": [], "outputs": [
        {"name": "depositCap", "type": "uint256"},
        {"name": "borrowCap", "type": "uint256"},
    ], "stateMutability": "view"},
    {"name": "balanceOf", "type": "function", "inputs": [
        {"name": "account", "type": "address"}
    ], "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view"},
    {"name": "totalSupply", "type": "function", "inputs": [], "outputs": [
        {"name": "", "type": "uint256"}
    ], "stateMutability": "view"},
]
```

**⚠️ NOTE:** Verify the exact ABI output types by reading the verified contract on Snowtrace. The above is based on SDK analysis — the actual Solidity outputs may use tuples or different names.

---

### Step 4: Register Adapter

**File:** `apps/backend/app/services/protocols/__init__.py`

Add to `_build_adapters()`:
```python
try:
    from .folks import FolksAdapter
    adapters["folks"] = FolksAdapter()
except Exception as exc:
    logger.warning("FolksAdapter not loaded (FOLKS_HUBPOOL missing?): %s", exc)
```

---

### Step 5: Risk Scorer

**File:** `apps/backend/app/services/optimizer/risk_scorer.py`

Add to `STATIC_SCORES` dict:
```python
"folks": {"oracle": 2, "collateral": 1, "architecture": 1},  # Total: 4
```

Also update `silo_susdp_usdc` oracle from 0 → 1 (confirmed DIA oracle):
```python
"silo_susdp_usdc": {"oracle": 1, "collateral": 1, "architecture": 1},  # Total: 3
```

---

### Step 6: Execution Layer

**File:** `apps/execution/execute.js`

This is the most complex step because Folks uses 2 separate contracts for deposit vs withdraw.

1. **Add contract key resolver:**
```javascript
// resolveContractKey() — add:
folks_deposit: "FOLKS_SPOKE_USDC",
folks_withdraw: "FOLKS_SPOKE_COMMON",
```

2. **Add Folks-specific ABIs:**
```javascript
const FOLKS_SPOKE_USDC_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: [
        { name: "adapterId", type: "uint16" },
        { name: "returnAdapterId", type: "uint16" },
        { name: "returnGasLimit", type: "uint256" },
      ]},
      { name: "accountId", type: "bytes32" },
      { name: "loanId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "createLoanAndDeposit",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: [
        { name: "adapterId", type: "uint16" },
        { name: "returnAdapterId", type: "uint16" },
        { name: "returnGasLimit", type: "uint256" },
      ]},
      { name: "accountId", type: "bytes32" },
      { name: "nonce", type: "bytes4" },
      { name: "amount", type: "uint256" },
      { name: "loanTypeId", type: "uint16" },
      { name: "loanName", type: "bytes32" },
    ],
    outputs: [],
  },
]

const FOLKS_SPOKE_COMMON_ABI = [
  {
    name: "createAccount",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: [
        { name: "adapterId", type: "uint16" },
        { name: "returnAdapterId", type: "uint16" },
        { name: "returnGasLimit", type: "uint256" },
      ]},
      { name: "accountId", type: "bytes32" },
      { name: "nonce", type: "bytes4" },
      { name: "refAccountId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "params", type: "tuple", components: [
        { name: "adapterId", type: "uint16" },
        { name: "returnAdapterId", type: "uint16" },
        { name: "returnGasLimit", type: "uint256" },
      ]},
      { name: "accountId", type: "bytes32" },
      { name: "loanId", type: "bytes32" },
      { name: "poolId", type: "uint8" },
      { name: "chainId", type: "uint16" },
      { name: "amount", type: "uint256" },
      { name: "isFAmount", type: "bool" },
    ],
    outputs: [],
  },
]
```

3. **Add deposit routing** (after silo_susdp_usdc block):
```javascript
} else if (protocol === "folks" && contracts.FOLKS_SPOKE_USDC) {
  // Approve USDC to SpokeErc20Token
  // Then call deposit() or createLoanAndDeposit() depending on account state
  const params = { adapterId: 1, returnAdapterId: 1, returnGasLimit: 0n }
  calls.push({
    to: contracts.FOLKS_SPOKE_USDC,
    value: 0n,
    data: encodeFunctionData({
      abi: FOLKS_SPOKE_USDC_ABI,
      functionName: "deposit",
      args: [params, accountId, loanId, amount],
    }),
  })
}
```

4. **Add withdrawal routing:**
```javascript
} else if (protocol === "folks" && contracts.FOLKS_SPOKE_COMMON) {
  calls.push({
    to: contracts.FOLKS_SPOKE_COMMON,
    value: 0n,
    data: encodeFunctionData({
      abi: FOLKS_SPOKE_COMMON_ABI,
      functionName: "withdraw",
      args: [
        { adapterId: 1, returnAdapterId: 1, returnGasLimit: 0n },
        accountId,
        loanId,
        1,      // poolId = 1 for USDC
        100,    // chainId = 100 for Avalanche
        amount,
        false,  // isFAmount = false (withdraw by USDC amount)
      ],
    }),
  })
}
```

**⚠️ NOTE:** The execution payload needs to include `accountId` and `loanId` for Folks. The backend must pass these alongside the existing `amountUSDC`, `shareBalance` fields. This requires changes to the rebalance payload structure.

---

### Step 7: Frontend Constants

**File:** `apps/web/lib/constants.ts`

1. Add to `PROTOCOL_CONFIG`:
```typescript
{
  id: "folks",
  name: "Folks Finance",
  shortName: "Folks",
  category: "lending",
  asset: "USDC",
  contractAddress: "0x88f15e36308ED060d8543DA8E2a5dA0810Efded2",  // HubPool (for display)
  riskScore: 4,  // static: oracle(2) + collateral(1) + architecture(1)
  color: "#...",  // TBD — match Folks brand
  bgColor: "#...",
  logoPath: "/logos/folks.svg",  // Need to add logo asset
  isActive: true,
  defaultEnabled: true,
  description: "Folks Finance cross-chain lending on Avalanche",
  auditBadge: "OtterSec",
  explorerUrl: "https://snowtrace.io/address/0x88f15e36308ED060d8543DA8E2a5dA0810Efded2",
  vaultUrl: "https://app.folks.finance/",
}
```

2. Add to `SESSION_KEY_SELECTORS` (compute selectors from function signatures):
```typescript
folks: {
  createAccount: '0x...', // keccak256("createAccount(...)")[0:4]
  deposit: '0x...',
  createLoanAndDeposit: '0x...',
  withdraw: '0x...',
},
```

---

### Step 8: Session Key Call Policy

**File:** `apps/web/lib/zerodev.ts`

1. Add USDC approve for SpokeErc20Token (add to ONE_OF array):
```typescript
// USDC.approve spender list — add:
FOLKS_SPOKE_USDC  // 0xcD68014c002184707eaE7218516cB0762A44fDDF
```

2. Add SpokeCommon permissions:
```typescript
// createAccount — one-time, no amount restriction
{
  target: FOLKS_SPOKE_COMMON,
  functionName: "createAccount",
  args: [null, null, null, null]  // all args unrestricted
}
// withdraw — uncapped (user's money)
{
  target: FOLKS_SPOKE_COMMON,
  functionName: "withdraw",
  args: [null, null, null, null, null, null, null]
}
```

3. Add SpokeErc20Token permissions:
```typescript
// deposit — amount capped
{
  target: FOLKS_SPOKE_USDC,
  functionName: "deposit",
  args: [null, null, null,
    { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount }
  ]
}
// createLoanAndDeposit — amount capped
{
  target: FOLKS_SPOKE_USDC,
  functionName: "createLoanAndDeposit",
  args: [null, null, null,
    { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: maxAmount },
    null, null
  ]
}
```

---

## Additional: State Management for Account/Loan IDs

Folks requires storing `accountId` and `loanId` per smart account. Options:

**Option A (Recommended): Supabase table**
```sql
CREATE TABLE folks_accounts (
  smart_account_address TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,      -- bytes32 hex
  loan_id TEXT NOT NULL,         -- bytes32 hex
  account_created BOOLEAN DEFAULT false,
  loan_created BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Option B: Deterministic IDs (no DB needed)**
Since `accountId = keccak256(address + chainId + nonce)` and `loanId = keccak256(accountId + chainId + nonce)`, we can use fixed nonces (e.g., `0x00000001`) and recompute the IDs deterministically. This avoids DB dependency but requires consistent nonce usage.

**Recommendation:** Use Option B (deterministic) with a fixed nonce like `0x534E4F57` ("SNOW" in hex). The backend can always recompute the IDs from the smart account address. Store a cache in Supabase for quick lookup + the `account_created`/`loan_created` flags to know if setup has been done.

---

## Open Questions

1. **Verify ABI output types**: Read the verified SpokeCommon and SpokeErc20Token contracts on Snowtrace to confirm exact function signatures and tuple structures match what's documented above

2. **MessageParams for same-chain**: Confirm that `{adapterId: 1, returnAdapterId: 1, returnGasLimit: 0}` is correct for Avalanche hub adapter. Check the HubAdapter contract or SDK source: `xchain-js-sdk/src/chains/evm/hub/modules/`

3. **loanTypeId for USDC**: Find the correct `loanTypeId` for USDC lending. Check SDK constants or LoanManager contract

4. **fToken → USDC conversion**: Verify how to convert fToken balance to underlying USDC. Check if `interestIndex` from `getDepositData()` is used, or if it's a simple `totalAmount / totalSupply` ratio

5. **Logo + brand colors**: Get Folks Finance brand assets

---

## Verification

1. **Unit test the adapter**: Call `get_rate()` and verify APY matches DefiLlama/Folks UI (~5.17%)
2. **Test account creation**: Create a Folks Account from the smart account, verify on-chain
3. **Test createLoanAndDeposit**: First deposit with loan creation, verify fToken balance
4. **Test subsequent deposit**: Call `deposit()` with existing account/loan
5. **Test withdrawal**: Withdraw USDC, verify balance returns
6. **Test balance reading**: Verify `get_balance()` returns correct USDC amount
7. **Test health checks**: Verify `get_health()` returns HEALTHY + correct utilization
8. **Test session key**: Create a session key with Folks permissions, verify deposit/withdraw work
9. **End-to-end**: Run a small rebalance that includes Folks and verify funds move correctly
10. **Risk score**: Verify `risk_scorer.py` returns correct 9-point score with dynamic liquidity + yield

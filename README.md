# Bond Tokenization Platform (Parts 1, 2 & 3)

An institutional-grade Real World Asset (RWA) bond tokenization platform on Ethereum, featuring KYC-gated secondary trading, proof-of-reserve collateral guards, automated coupon distribution, principal redemption, segregated liquidity pools, and a modern React dashboard.

---

## 1. Executive Summary & Problem Statement

Traditional corporate bonds suffer from high minimum investment thresholds, multi-day settlement latency ($T+2$), illiquid secondary trading, and opaque collateral backing. 

This platform bridges institutional debt instruments with decentralized finance by:
1. **Fractionalizing Debt**: Representing corporate bonds as ERC-20 compliant tokens (`CB28`, $1,000 face value).
2. **Regulatory & Compliance Enforcement**: Enforcing on-chain KYC verification (`KYCRegistry`) across all primary mints, secondary transfers, and coupon distributions.
3. **Automated Proof of Reserves (PoR)**: Integrating real-time reserve oracles to prevent fractional-reserve minting and emit non-reverting circuit breaker alerts (`ReserveGuard`).
4. **Peer-to-Peer Liquidity**: Providing an escrow-backed order book marketplace for instant, trustless secondary trading in MockUSDC without broker fees.
5. **Programmatic Servicing**: Segregated liquidity pools for periodic coupon distributions and instant face-value redemption upon maturity.

---

## 2. Architecture & System Flow

```
                      +-------------------+
                      |    KYCRegistry    |
                      |  Compliance Gate  |
                      +---------+---------+
                                |
             +------------------+------------------+
             |                                     |
             v                                     v
      +--------------+                      +--------------+
      |  BondToken   |                      | Marketplace  |
      |   (CB28)     |                      | (Escrow P2P) |
      +-------+------+                      +-------+------+
              |                                     |
              +------------------+------------------+
                                 |
                                 v
                     +-----------------------+
                     |   CouponDistributor   |
                     |  (Segregated Pools)   |
                     +-----------------------+

       +------------------+           +------------------+
       |  ReserveOracle   |<----------|   ReserveGuard   |
       |  (Mock PoR Feed) |           | (Circuit Breaker)|
       +------------------+           +------------------+
       |   YieldOracle    |           | ChainlinkPrice-  |
       |  (Benchmark Yield|           |     Reader       |
       +------------------+           +------------------+
```

### Component Breakdown
| Layer | Contracts / Folders | Key Responsibilities |
|---|---|---|
| **Part 1: Rules & Core Logic** | `BondToken.sol`, `KYCRegistry.sol`, `MockUSDC.sol`, `Marketplace.sol`, `CouponDistributor.sol` | KYC gating, bond terms, secondary trading escrow, segregated coupon/redemption pools. |
| **Part 2: Safety & Oracles** | `ReserveGuard.sol`, `ReserveOracle.sol`, `YieldOracle.sol`, `ChainlinkPriceReader.sol` | Continuous reserve monitoring, circuit breaker events (`ReserveAlert` / `ReserveRestored`), Chainlink price feed conversions. |
| **Part 3: Interface & DApp** | `frontend/`, `shared/` | Web3 investor portal, batch order book UI, compliance console, real-time reserve gauge, event audit logs. |
| **Backend & Indexing** | `backend/` | SQLite event indexer, PoR event history, and dummy KYC submission API. |

---

## 3. Real versus Mocked Disclosures

| Component | Status on Sepolia Testnet | Production Implementation |
|---|---|---|
| **ETH / USD Price** | **Real** Chainlink Feed (`0x694AA1769357215DE4FAC081bf1f309aDC325306`) | Chainlink Decentralized Oracle Network on Ethereum Mainnet |
| **Proof of Reserves** | **Mock** `ReserveOracle` (standard `AggregatorV3Interface` shape) | Chainlink Proof of Reserve (PoR) connected via API to an audited custodian (e.g., BNY Mellon, State Street) |
| **Bond Yield Feed** | **Mock** `YieldOracle` (8.00% benchmark) | Chainlink Data Streams or financial benchmark providers |
| **KYC Verification** | **Mock** `KYCRegistry` with admin/compliance signer | ERC-3643 (ONCHAINID) with identity providers (e.g. Sumsub, Fractal) |
| **Settlement Currency** | `MockUSDC` (6 decimals) | Circle USDC (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`) |

---

## 4. Key Architectural Findings & Hardening

### A. Non-Reverting Alerts (`ReserveGuard` vs. `BondToken`)
In `BondToken.sol`, when reserves fall below 100%, the `mint` function attempts to emit `ReserveRatioAlert` and then executes `revert("BondToken: reserve ratio below 100%")`. In Ethereum transactions, **reverts roll back all emitted event logs**. 

To prevent silent failures and ensure indexers and dashboards detect reserve drops:
- `ReserveGuard.sol` is deployed independently.
- Anyone can call `ReserveGuard.checkAndAlert()` to trigger persistent, unrolled-back `ReserveAlert` and `ReserveRestored` events.
- Dashboards display real-time collateral health by reading `ReserveGuard.reserveRatioBps()`.

### B. Segregated Liquidity Accounting (`CouponDistributor.sol`)
In a shared USDC pool, high coupon claims risk draining the capital reserved for maturity principal redemptions.
- **Dedicated Pools**: `couponPool` and `redemptionPool` track deposited USDC independently.
- **Period Scaling**: `periodsPerYear` dynamically scales annual coupon rates (e.g., 4 periods/year divides annual coupon by 4).
- **Issuer Withdrawals**: `withdrawUnusedFunds(token, amount, to)` allows admin recovery of excess or uncollected liquidity.

### C. Access Control & Emergency Recovery
- **Least Privilege**: `CouponDistributor` holds a dedicated `REDEMPTION_ROLE` rather than full mint/burn `ISSUER_ROLE`.
- **Court-Ordered Seizures / Frozen Accounts**: Compliance `forceTransfer` bypasses emergency pauses (`_bypassingPause`) so regulatory and legal asset recoveries cannot be blocked during incident lockdowns.

### D. Escrow Whitelisting
`Marketplace` and `CouponDistributor` addresses are explicitly whitelisted in `KYCRegistry` during deployment, preventing receiver rejection reverts when creating sell orders or depositing bonds into escrow.

---

## 5. Security Notes & Known Limitations

> [!IMPORTANT]
> This platform was engineered as an institutional demonstration prototype. The following security notes disclose intentional architectural trade-offs and the production migration requirements.

1. **Centralized Reserve Oracle Feed**:
   - *Current Prototype*: `ReserveOracle` updates are authorized by a single administrator account (`FEED_ADMIN_ROLE`).
   - *Production Architecture*: Production Proof of Reserves must use a decentralized Chainlink Oracle Network (DON) aggregating independent attestations from audited banking APIs, secured by a staleness heartbeat (e.g. 24 hours) and deviation threshold checks.

2. **Trusted Issuer Snapshot Distribution**:
   - *Current Prototype*: `CouponDistributor.recordSnapshot` accepts address arrays and balances submitted by the `ISSUER_ROLE`.
   - *Production Architecture*: Balances should be captured natively on-chain using OpenZeppelin `ERC20Votes` or historical block checkpoints, preventing off-chain calculation errors or malicious balance injection.

3. **Governance & Role Separation**:
   - *Current Prototype*: For local development and testnet convenience, `scripts/deploy.js` initializes roles using a single deployer private key.
   - *Production Architecture*: Critical roles (`DEFAULT_ADMIN_ROLE`, `COMPLIANCE_ROLE`, `PAUSER_ROLE`) must be assigned to distinct multi-signature vaults (e.g., Safe 3-of-5). Any change to the KYC Registry or Oracle address must be protected by an on-chain `TimelockController` (48-72h delay).

4. **Escrow Cancellation & Whitelist Invalidation**:
   - *Current Prototype*: Canceling an active order in `Marketplace` returns escrowed bonds to the seller, which requires the seller to still be whitelisted in `KYCRegistry`.
   - *Production Architecture*: In the event a seller is revoked from KYC, compliance officers use `forceTransfer` to reassign the escrowed bonds or custody them into a court-ordered reserve.

---

## 6. Quick Start & Execution Guide

### Prerequisites
- Node.js (v18 or v20+ LTS)
- PowerShell or bash terminal

### A. Offline Compilation & Tests
```powershell
# 1. Install root dependencies
npm install

# 2. Compile contracts offline & sync ABIs to shared/
node scripts/compile-contracts.js
node scripts/syncAbis.js

# 3. Run full test suite (67 passing tests)
$env:LOCALAPPDATA = (Join-Path (Get-Location) '.hardhat-cache')
npx hardhat test --no-compile
```

### B. Local Demo (Two Terminals)
**Terminal 1 (Local Hardhat Node):**
```powershell
npm run node
```

**Terminal 2 (Deploy & Run Demo):**
```powershell
# Deploy contracts & seed initial liquidity
npm run deploy:local -- --no-compile

# Execute 4-stage reserve demo
npm run demo:local -- --no-compile
```
*Demo Stages Verified:*
1. **Healthy**: Reserve ratio >= 100%, minting succeeds.
2. **Reserves Drop**: Oracle drops to 50%, minting reverts as expected.
3. **ReserveAlert**: `ReserveGuard` emits persistent `ReserveAlert`.
4. **Reserves Restored**: Collateral replenished to 120%, `ReserveRestored` emitted, minting resumes.

### C. Sepolia Deployment & Verification
1. Fill `.env` with your credentials:
   - `SEPOLIA_RPC_URL`: Alchemy / Infura HTTPS endpoint
   - `PRIVATE_KEY`: Test-only wallet private key
   - `ETHERSCAN_API_KEY`: Etherscan API key
2. Fund the deployer wallet (`0xc992ddeb354F51EDc472c7FB9D84Db200FaAf5DA`) with Sepolia ETH from faucets.
3. Deploy & verify:
```powershell
npm run deploy:sepolia
npm run demo:sepolia
npm run verify:sepolia
```

### D. Running the Frontend (Part 3)
```powershell
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser. Connect MetaMask and select **Localhost (8545)** or **Sepolia Testnet**.

---

## 7. Production Roadmap

1. **ERC-3643 Standard Migration**:
   - Upgrade `BondToken` to compliant Permissioned Token (ERC-3643 / T-REX standard) with Claim Issuers, Identity Registries (`ONCHAINID`), and automated jurisdictional transfer restrictions.
2. **Chainlink Proof of Reserve (PoR)**:
   - Replace `ReserveOracle` with live Chainlink PoR oracles hooked into audited off-chain custodian balances.
3. **Legal SPV Architecture**:
   - Establish a bankruptcy-remote Special Purpose Vehicle (SPV) holding real-world treasuries/bonds with legal off-chain claims represented by the on-chain tokens.
4. **Automated Chainlink Keepers**:
   - Trigger `ReserveGuard.checkAndAlert()` and coupon snapshot recordings automatically on scheduled intervals.
5. **Decentralized Multi-Sig Governance**:
   - Enforce multi-signature approvals (Safe) and timelocks for all administrative actions.

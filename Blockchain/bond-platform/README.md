# Bond Tokenization Platform (Parts 1, 2 & 3)

An institutional-grade Real World Asset (RWA) bond tokenization platform on Ethereum, featuring KYC-gated secondary trading, proof-of-reserve collateral guards, automated coupon distribution, principal redemption, and a modern React dashboard.

---

## 1. Executive Summary & Problem Statement

Traditional corporate bonds suffer from high minimum investment thresholds, multi-day settlement latency ($T+2$), illiquid secondary trading, and opaque collateral backing. 

This platform bridges institutional debt instruments with decentralized finance by:
1. **Fractionalizing Debt**: Representing corporate bonds as ERC-20 compliant tokens (`CB28`, $1,000 face value).
2. **Regulatory & Compliance Enforcement**: Enforcing on-chain KYC verification (`KYCRegistry`) across all primary mints, secondary transfers, and coupon distributions.
3. **Automated Proof of Reserves (PoR)**: Integrating real-time reserve oracles to prevent fractional-reserve minting and emit non-reverting circuit breaker alerts (`ReserveGuard`).
4. **Peer-to-Peer Liquidity**: Providing an escrow-backed order book marketplace for instant, trustless secondary trading in MockUSDC without broker fees.
5. **Programmatic Servicing**: Snapshot-based periodic coupon distributions and instant face-value redemption upon maturity.

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
                     |  (Coupons & Maturity) |
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
| **Part 1: Rules & Core Logic** | `BondToken.sol`, `KYCRegistry.sol`, `MockUSDC.sol`, `Marketplace.sol`, `CouponDistributor.sol` | KYC gating, bond terms, secondary trading escrow, coupon calculation & redemption. |
| **Part 2: Safety & Oracles** | `ReserveGuard.sol`, `ReserveOracle.sol`, `YieldOracle.sol`, `ChainlinkPriceReader.sol` | Continuous reserve monitoring, circuit breaker events (`ReserveAlert` / `ReserveRestored`), Chainlink price feed conversions. |
| **Part 3: Interface & DApp** | `frontend/`, `shared/` | Web3 investor portal, order book UI, compliance console, real-time reserve gauge. |
| **Optional Backend** | `backend/` | SQLite event indexer and dummy KYC document submission API. |

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

## 4. Key Architectural Finding: `ReserveGuard` vs. `BondToken`

In `BondToken.sol`, when reserves fall below 100%, the `mint` function attempts to emit `ReserveRatioAlert` and then executes `revert("BondToken: reserve ratio below 100%")`. In Ethereum transactions, **reverts roll back all emitted event logs**. 

To prevent silent failures and ensure indexers and dashboards detect reserve drops:
- `ReserveGuard.sol` is deployed independently.
- Anyone can call `ReserveGuard.checkAndAlert()` to trigger persistent, unrolled-back `ReserveAlert` and `ReserveRestored` events.
- Dashboards display real-time collateral health by reading `ReserveGuard.reserveRatioBps()`.

---

## 5. Quick Start & Execution Guide

### Prerequisites
- Node.js (v18 or v20+ LTS)
- PowerShell or bash terminal

### A. Install & Test
```powershell
# 1. Install root dependencies
npm install

# 2. Sync ABIs and configurations to shared/
npm run abis

# 3. Run full test suite (60 passing tests)
npx hardhat test --no-compile
```

### B. Local Demo (Two Terminals)
**Terminal 1 (Local Hardhat Node):**
```powershell
npm run node
```

**Terminal 2 (Deploy & Run Demo):**
```powershell
# Deploy contracts & seed 1,000 bonds
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
2. Fund the deployer wallet (`0xc992ddeb354F51EDc472c7FB9D84Db200FaAf5DA`) with Sepolia ETH from faucets (Google Cloud Web3, Alchemy, or Chainlink faucet).
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

## 6. Production Roadmap

1. **ERC-3643 Standard Migration**:
   - Upgrade `BondToken` to compliant Permissioned Token (ERC-3643 / T-REX standard) with Claim Issuers, Identity Registries (`ONCHAINID`), and automated jurisdictional transfer restrictions.
2. **Chainlink Proof of Reserve (PoR)**:
   - Replace `ReserveOracle` with live Chainlink PoR oracles hooked into audited off-chain custodian balances.
3. **Legal SPV Architecture**:
   - Establish a bankruptcy-remote Special Purpose Vehicle (SPV) holding real-world treasuries/bonds with legal off-chain claims represented by the on-chain tokens.
4. **Automated Chainlink Automation (Keepers)**:
   - Trigger `ReserveGuard.checkAndAlert()` and coupon snapshot recordings automatically on scheduled intervals.
5. **Decentralized Multi-Sig Governance**:
   - Enforce multi-signature approvals (e.g. Safe) for `DEFAULT_ADMIN_ROLE`, `ISSUER_ROLE`, and `COMPLIANCE_ROLE`.

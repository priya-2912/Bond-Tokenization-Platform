# Shared Smart Contract Interface Reference

Comprehensive documentation for all smart contracts in the Bond Tokenization Platform (Part 1 and Part 2). This serves as the single source of truth for frontend integration, backend indexers, and test suites.

---

## 1. Architecture Overview

```
                      +-------------------+
                      |    KYCRegistry    |
                      +---------+---------+
                                |
             +------------------+------------------+
             |                                     |
             v                                     v
      +--------------+                      +--------------+
      |  BondToken   |                      | Marketplace  |
      +-------+------+                      +-------+------+
              |                                     |
              +------------------+------------------+
                                 |
                                 v
                     +-----------------------+
                     |   CouponDistributor   |
                     +-----------------------+

       +------------------+           +------------------+
       |  ReserveOracle   |<----------|   ReserveGuard   |
       +------------------+           +------------------+
       |   YieldOracle    |           | ChainlinkPrice-  |
       |  MockPriceFeed   |           |     Reader       |
       +------------------+           +------------------+
```

---

## 2. Contracts Reference

### 2.1 BondToken (`BondToken.sol`)
ERC-20 token representing fractional bond ownership. KYC-restricted on transfers and minting.
Proof of Reserve ratio enforced upon minting.

- **Standard**: ERC-20, ERC-20 Pausable, AccessControl
- **Decimals**: 18
- **Roles**:
  - `DEFAULT_ADMIN_ROLE`: Manage oracles, pause roles, update KYC registry
  - `ISSUER_ROLE`: Mint new bonds, burn on redemption
  - `PAUSER_ROLE`: Pause / unpause transfers
  - `COMPLIANCE_ROLE`: Execute emergency force transfers
- **Key Terms**:
  - `faceValue`: Face value per bond in MockUSDC units (6 decimals, e.g. `1,000 * 10^6 = 1,000,000,000`)
  - `couponRateBps`: Coupon rate in basis points (e.g. `800 = 8.00%`)
  - `maturityDate`: Unix timestamp of bond maturity
- **Functions**:
  - `mint(address to, uint256 amount)` (ISSUER_ROLE): Mints tokens if reserves >= 100% of required. Receiver must be KYC-verified.
  - `burn(uint256 amount)`: Burns sender's tokens. Sender must be KYC-verified.
  - `burnFrom(address account, uint256 amount)`: Burns from account if caller has allowance or is `ISSUER_ROLE`.
  - `forceTransfer(address from, address to, uint256 amount)` (COMPLIANCE_ROLE): Forced transfer bypassing allowance; recipient must be KYC-verified.
  - `pause()` / `unpause()` (PAUSER_ROLE): Halts or resumes all transfers.
  - `setKYCRegistry(address _kycRegistry)` (DEFAULT_ADMIN_ROLE): Updates the KYCRegistry.
  - `setReserveOracle(address _oracle)` (DEFAULT_ADMIN_ROLE): Updates the ReserveOracle.
  - `reserveRatio()` view returns `(uint256)`: Current reserve ratio in bps (10000 = 100%).
- **Events**:
  - `KYCRegistryUpdated(address indexed newRegistry)`
  - `ReserveOracleUpdated(address indexed newOracle)`
  - `ForceTransferExecuted(address indexed from, address indexed to, uint256 amount, address indexed operator)`
  - `ReserveRatioAlert(uint256 currentReserves, uint256 requiredReserves, uint256 reserveRatioBps)` *(Rolled back on mint revert)*

---

### 2.2 ReserveGuard (`ReserveGuard.sol`)
Independent reserve monitor designed to prevent silent rollback failures.

> **CRITICAL NOTE FOR FRONTEND & INDEXER:**
> `BondToken`'s internal `ReserveRatioAlert` is emitted immediately before a `revert("BondToken: reserve ratio below 100%")`. Because Ethereum reverts rollback all emitted logs in that transaction, `ReserveRatioAlert` never appears in the event log!
> **Always monitor `ReserveGuard` instead**:
> - Listen to `ReserveAlert` and `ReserveRestored` events on `ReserveGuard`.
> - Read `ReserveGuard.reserveRatioBps()` or `ReserveGuard.isHealthy()` for UI gauges.

- **Roles**: `GUARD_ADMIN_ROLE`
- **Functions**:
  - `reserves()` view returns `(uint256 amount, uint256 updatedAt)`: Reads underlying reserve feed.
  - `requiredReserves()` view returns `(uint256)`: Calculates required MockUSDC backing.
  - `reserveRatioBps()` view returns `(uint256)`: Ratio in bps (`10,000 = 100%`).
  - `isHealthy()` view returns `(bool)`: True if fresh and ratio >= `minRatioBps`.
  - `canMint(uint256 amount)` view returns `(bool)`: True if adding `amount` supply maintains >= minRatio.
  - `checkAndAlert()` returns `(bool healthy)`: Anyone can trigger. Emits `ReserveAlert` on health drop, `ReserveRestored` on recovery.
- **Events**:
  - `ReserveAlert(uint256 ratioBps, uint256 minRatioBps, uint256 reserves, uint256 required, uint256 timestamp)`
  - `ReserveRestored(uint256 ratioBps, uint256 minRatioBps, uint256 reserves, uint256 required, uint256 timestamp)`

---

### 2.3 KYCRegistry (`KYCRegistry.sol`)
Whitelist of investor wallets authorized for bond issuance, holding, and secondary trading.

- **Roles**: `DEFAULT_ADMIN_ROLE`, `COMPLIANCE_ROLE`
- **Functions**:
  - `addToWhitelist(address account)` (COMPLIANCE_ROLE)
  - `removeFromWhitelist(address account)` (COMPLIANCE_ROLE)
  - `batchAddToWhitelist(address[] calldata accounts)` (COMPLIANCE_ROLE)
  - `isVerified(address account)` view returns `(bool)`
- **Events**:
  - `AddressWhitelisted(address indexed account, address indexed complianceOfficer)`
  - `AddressRemovedFromWhitelist(address indexed account, address indexed complianceOfficer)`

---

### 2.4 MockUSDC (`MockUSDC.sol`)
Test stablecoin replicating USDC behavior (6 decimals).

- **Decimals**: 6
- **Functions**:
  - Standard ERC-20: `balanceOf`, `approve`, `transfer`, `transferFrom`, `allowance`
  - `mint(address to, uint256 amount)`: Open test faucet for funding investor wallets.

---

### 2.5 Marketplace (`Marketplace.sol`)
Peer-to-peer secondary market order book for trading bonds against MockUSDC. Escrows bonds.

- **Functions**:
  - `createSellOrder(uint256 bondAmount, uint256 priceInUSDC)` returns `(uint256 orderId)`: Deposits bonds into escrow. Seller must be KYC-verified.
  - `buy(uint256 orderId)`: Buyer pays priceInUSDC, receives escrowed bonds. Both buyer and seller must be KYC-verified. Requires `MockUSDC.approve(marketplaceAddress, priceInUSDC)` first.
  - `cancelOrder(uint256 orderId)`: Returns escrowed bonds to seller. Caller must be order seller.
  - `getOrder(uint256 orderId)` view returns `(Order)`
  - `orders(uint256)` view returns `(id, seller, bondAmount, priceInUSDC, isActive)`
- **Events**:
  - `OrderCreated(uint256 indexed orderId, address indexed seller, uint256 bondAmount, uint256 priceInUSDC)`
  - `OrderFilled(uint256 indexed orderId, address indexed buyer, address indexed seller, uint256 bondAmount, uint256 priceInUSDC)`
  - `OrderCancelled(uint256 indexed orderId, address indexed seller)`

---

### 2.6 CouponDistributor (`CouponDistributor.sol`)
Manages periodic coupon distributions and bond principal redemption at maturity.

- **Roles**: `DEFAULT_ADMIN_ROLE`, `ISSUER_ROLE`
- **Functions**:
  - `depositFunds(uint256 amount)`: Deposits MockUSDC to fund payouts or redemptions.
  - `recordSnapshot(uint256 periodId, address[] calldata accounts, uint256[] calldata balances)` (ISSUER_ROLE): Records snapshot of balances at record date.
  - `calculateCoupon(uint256 balance)` view returns `(uint256)`: Calculates coupon owed.
  - `claimCoupon(uint256 periodId)`: Claims accrued coupon for periodId. Caller must be KYC-verified.
  - `redeem(uint256 bondAmount)`: After maturity, burns caller's bonds and pays face value in MockUSDC. Caller must be KYC-verified.
  - `hasClaimed(uint256 periodId, address account)` view returns `(bool)`
- **Events**:
  - `CouponFundsDeposited(address indexed issuer, uint256 amount)`
  - `SnapshotRecorded(uint256 indexed periodId, uint256 accountsCount)`
  - `CouponClaimed(uint256 indexed periodId, address indexed account, uint256 amount)`
  - `BondRedeemed(address indexed account, uint256 bondAmount, uint256 payoutUSDC)`

---

### 2.7 Oracles & Price Feeds
- **ReserveOracle (`ReserveOracle.sol`)**:
  - `getReserves()` view returns `(uint256)`
  - `updateReserve(uint256 newReserve)` (FEED_ADMIN_ROLE)
- **YieldOracle (`YieldOracle.sol`)**:
  - `latestAnswer()` view returns `(int256)`
  - `updateYield(int256 newYield)` (FEED_ADMIN_ROLE)
- **ChainlinkPriceReader (`ChainlinkPriceReader.sol`)**:
  - `latestPrice()` view returns `(int256 price, uint8 feedDecimals, uint256 updatedAt)`
  - `toQuote(uint256 baseAmount, uint8 baseDecimals)` view returns `(uint256)`: Converts ETH wei to USD.


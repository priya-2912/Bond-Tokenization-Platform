# Aura Bonds frontend

React + Vite + ethers v6. It talks directly to the contracts through MetaMask and reads addresses and ABIs from `../shared/`.

## Run

```bash
npm install
cp .env.example .env     # optional (see below)
npm run dev              # http://localhost:5173
npm test                 # unit tests for the helper functions
npm run build            # production build in dist/
```

The contracts must be deployed first (`npm run deploy:local` or `npm run deploy:sepolia` in the project root). If the selected network has no entry in `shared/addresses.json` the site says so instead of showing empty numbers.

## Tabs

| Tab | What it does |
|---|---|
| Investor Portfolio | Bond terms (read from the contract), balances, **KYC application with ID upload and progress steps**, **primary offering** (issuer lots you can invest in), coupon claim by period, redemption at maturity, testnet USDC faucet |
| Secondary Market | **Buy / Sell / My Orders** tabs. Escrow-backed orders between KYC-verified wallets |
| Issuer & Compliance | Role badges, reserve monitor, **setup checks with one-click fixes**, pause, KYC lookup, **open primary offering**, coupon/redemption funding (and withdrawal where supported), **KYC application queue**, **distribute coupon** (load real holders, review, record) |
| Audit & Oracles | Supply, required and reported reserves, coverage gauge, **infrastructure status table**, reserve alert history, platform activity feed, contract addresses with Etherscan links |

## Environment variables (all optional)

| Variable | Default | Notes |
|---|---|---|
| `VITE_SEPOLIA_RPC_URL` | public RPC | Read-only RPC used when the wallet is not on Sepolia |
| `VITE_LOCAL_RPC_URL` | `http://127.0.0.1:8545` | Local Hardhat node |
| `VITE_BACKEND_URL` | `http://localhost:4000` | KYC and events service (`../backend`) |
| `VITE_ADMIN_API_KEY` | empty | **Development only.** Anything in `VITE_*` is public in the built JavaScript. Leave it empty in production and authenticate admins on the backend with a signed wallet message |

## Compatible with two contract versions

The app checks the deployed ABI (`hasFn`) and adapts:

- `getOrders` (bulk) if present, else per-order reads in batches
- `getActivePeriods` / `getClaimableCoupon` if present, else manual period entry and a snapshot-based amount
- `couponPool` / `redemptionPool` / `depositCouponFunds` / `depositRedemptionFunds` / `withdrawUnusedFunds` if present, else the single shared pool with `depositFunds`

After redeploying contracts, run `npm run abis` in the project root so `shared/abis/` is current.

## Safety behaviours

- Reads always use the selected network's RPC, so the page can never show one chain's data while sending a transaction to another. Transactions are blocked, with a switch button, when MetaMask is on a different chain.
- Listens for account and network changes in MetaMask.
- Amounts are parsed strictly with BigInt (no `parseFloat`), rejecting negatives, exponents and extra decimals. Redemption payout is computed from the contract's face value.
- Approvals are for the exact amount needed and skipped when the allowance is already enough.
- Every transaction runs through one runner: double-click protection, plain-English revert messages, and an Etherscan link on success.
- Role badges and disabled buttons are convenience only. The contracts enforce every role.
- Production headers (CSP etc.) are in `vercel.json`.

## Known limits

- The reserve oracle and yield feed are mocks. ETH/USD is a real Chainlink feed on Sepolia only.
- The marketplace fills whole orders only, so the primary offering is sold in whole lots.
- The `Marketplace` contract must be KYC-whitelisted or listing fails. The Setup checks panel detects and fixes this.

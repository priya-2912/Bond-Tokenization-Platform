# Frontend changes (merged with your updated version)

Kept from your update: role detection and role badge, chain-mismatch banner with switch button, MetaMask account/chain listeners, Sepolia "not deployed" notice, transaction links, coupon periods, separate coupon/redemption pools, withdraw of unused funds, bulk order loading, KYC application via the backend, pending KYC queue.

## Fixed
- The KYC form no longer reports "Submitted!" when the backend is down. It shows the real error.
- The admin API key and `http://localhost:4000` are no longer hardcoded (see env variables).
- Reads use the selected network's RPC, not the wallet's chain.
- `alert()` and `prompt()` replaced with in-page messages and dialogs.
- Money maths uses BigInt with strict parsing instead of `Number` and `parseFloat`.
- Face value, coupon rate and symbol come from the contract instead of hardcoded 1000 / 8% / CB28.
- Double-submit protection, exact-amount approvals, balance checks before sending.
- Snapshot builder: loads real holders from Transfer events, credits escrowed bonds to sellers, validates every line, shows KYC status per wallet, summarises liability against the pool and warns before overwriting a period.
- Approving KYC no longer double-whitelists: the service is tried first, with the connected compliance wallet as a fallback.
- Refresh spinner now spins (missing CSS), keyboard focus outlines, `rel="noopener noreferrer"` on external links.
- Stale responses are ignored when switching network or account.

## Added (from the demo plan)
- KYC application with document upload and a 3-step progress indicator (Submit, Under review, Verified).
- "Invest" primary offering for issuer lots, and "Open primary offering" for the issuer.
- Marketplace Buy / Sell / My Orders tabs.
- Infrastructure status table (ETH/USD reader, reserves, yield, KYC, stablecoin).
- Setup checks (Marketplace whitelisted, oracle connected, distributor role, redemption coverage) with fix buttons.
- Platform activity feed and reserve alert history.
- `vercel.json` security headers, `.env.example`, unit tests (`npm test`).

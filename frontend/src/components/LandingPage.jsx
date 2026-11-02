import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  TrendingUp,
  Layers,
  ArrowRight,
  Lock,
  FileCheck2,
  Coins,
  Activity,
  Globe2,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Database,
  Building,
} from "lucide-react";
import { loadTerms, getContract, getAddresses, BOND_DECIMALS, USDC_DECIMALS } from "../contracts/platform";
import { fromUnits, fmtNumber } from "../lib/utils";

export default function LandingPage({
  provider,
  network,
  onExploreMarketplace,
  onInvestorLogin,
  onInstitutionalLogin,
  onSignUp,
}) {
  const [terms, setTerms] = useState(null);
  const [supply, setSupply] = useState(0n);
  const [reserves, setReserves] = useState(0n);
  const [ratioBps, setRatioBps] = useState(10000);
  const [loading, setLoading] = useState(true);

  const addresses = getAddresses(network);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await loadTerms(provider, network);
        const bond = getContract("BondToken", provider, network);
        const guard = getContract("ReserveGuard", provider, network);
        const [sup, res, rat] = await Promise.all([
          bond.totalSupply(),
          guard.reserves().catch(() => ({ amount: 0n })),
          guard.reserveRatioBps().catch(() => 10000n),
        ]);

        if (!cancelled) {
          setTerms(t);
          setSupply(sup);
          setReserves(res.amount || 0n);
          setRatioBps(Number(rat));
          setLoading(false);
        }
      } catch (err) {
        console.warn("Could not read landing metrics:", err);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, network]);

  const couponPct = terms ? (terms.couponRateBps / 100).toFixed(2) : "8.00";
  const faceVal = terms ? fromUnits(terms.faceValue, USDC_DECIMALS) : "1,000";

  return (
    <div style={{ paddingBottom: "4rem" }}>
      {/* Hero Section */}
      <section className="landing-hero">
        <div className="landing-badge">
          <Activity size={14} color="#60a5fa" />
          <span>Live on Ethereum Sepolia Testnet</span>
        </div>

        <h1 className="landing-title">
          Institutional-Grade <br />
          Tokenized Real-World Asset Bonds
        </h1>

        <p className="landing-subtitle">
          Aura Bonds bridges institutional credit and blockchain transparency. Access compliant, KYC-gated fixed-income
          debt with real-time Proof of Reserves, automated coupon servicing, and secondary liquidity.
        </p>

        <div className="landing-cta-group">
          <button className="btn btn-primary" onClick={onSignUp} style={{ padding: "0.75rem 1.6rem", fontSize: "0.95rem" }}>
            <span>Create Investor Account</span>
            <ArrowRight size={16} />
          </button>
          <button className="btn btn-secondary" onClick={onExploreMarketplace} style={{ padding: "0.75rem 1.4rem", fontSize: "0.95rem" }}>
            <span>Browse Bond Offerings</span>
          </button>
          <button
            className="btn btn-secondary"
            onClick={onInstitutionalLogin}
            style={{ padding: "0.75rem 1.25rem", fontSize: "0.85rem", opacity: 0.9 }}
          >
            <Building size={14} color="#f59e0b" />
            <span>Institutional Portal</span>
          </button>
        </div>

        {/* Live Metrics Grid */}
        <div className="landing-stats-grid">
          <div className="stat-box">
            <div className="stat-label">
              <span>Annual Yield / Coupon</span>
              <TrendingUp size={16} color="#10b981" />
            </div>
            <div className="stat-value font-mono" style={{ color: "var(--accent-emerald)" }}>
              {couponPct}%
            </div>
            <div className="stat-sub">Fixed periodic servicing</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">
              <span>Face Value / Bond</span>
              <Coins size={16} color="#3b82f6" />
            </div>
            <div className="stat-value font-mono">
              ${fmtNumber(faceVal)}
            </div>
            <div className="stat-sub">Settled in MockUSDC</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">
              <span>Collateral Coverage</span>
              <ShieldCheck size={16} color="#10b981" />
            </div>
            <div className="stat-value font-mono" style={{ color: "var(--accent-emerald)" }}>
              {(ratioBps / 100).toFixed(1)}%
            </div>
            <div className="stat-sub">On-chain reserve guard</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">
              <span>Active Supply</span>
              <Layers size={16} color="#94a3b8" />
            </div>
            <div className="stat-value font-mono">
              {fmtNumber(fromUnits(supply, BOND_DECIMALS), 0, 0)} {terms?.symbol || "CB28"}
            </div>
            <div className="stat-sub">Tokenized debt units</div>
          </div>
        </div>
      </section>

      {/* Featured Bond Offering Card */}
      <section style={{ maxWidth: 1040, margin: "0 auto 4rem auto" }}>
        <div className="section-header">
          <div>
            <span className="badge badge-blue">PRIMARY OFFERING</span>
            <h2 style={{ fontSize: "1.45rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Active Tokenized Bond Benchmark
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              Current compliant offering issued by Aura Capital, verified on Sepolia.
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onExploreMarketplace}>
            <span>View All in Marketplace</span>
            <ChevronRight size={14} />
          </button>
        </div>

        <div
          className="card"
          style={{
            background: "linear-gradient(135deg, rgba(21, 29, 44, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)",
            borderColor: "rgba(59, 130, 246, 0.3)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span className="badge badge-emerald">REG-S / RULE 144A COMPLIANT</span>
                <span className="badge badge-blue">{terms?.symbol || "CB28"}</span>
                <span className="badge badge-amber">AAA RATED GUARANTEE</span>
              </div>
              <h3 style={{ fontSize: "1.65rem", fontWeight: 800, marginTop: "0.5rem" }}>
                {terms ? `${terms.name} (${terms.symbol})` : "Corporate Bond 2028 (CB28)"}
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.3rem", maxWidth: 650 }}>
                Senior secured debt tranche backed by verified credit facilities and real estate infrastructure.
                Continuous whitelist verification enforced at smart contract transfer level.
              </p>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Offering Status</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "#10b981", fontWeight: 700, fontSize: "0.95rem", marginTop: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }}></span>
                Open for Subscription
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "1.25rem",
              marginTop: "1.5rem",
              paddingTop: "1.25rem",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Coupon Yield</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--accent-emerald)" }}>{couponPct}% p.a.</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Face Value</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 800 }}>${fmtNumber(faceVal)} USDC</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Maturity Date</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                {terms ? terms.maturity.toLocaleDateString() : "May 15, 2028"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Distribution Frequency</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>Periodic Snapshot</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
            <button className="btn btn-secondary btn-sm" onClick={onExploreMarketplace}>
              Review Offering Termsheet
            </button>
            <button className="btn btn-primary btn-sm" onClick={onSignUp}>
              Invest in Offering
            </button>
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section style={{ maxWidth: 1040, margin: "0 auto 4rem auto" }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <span className="badge badge-emerald">SIMPLE WORKFLOW</span>
          <h2 style={{ fontSize: "2rem", fontWeight: 800, marginTop: "0.5rem" }}>How Aura Bonds Works</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Seamless institutional-grade tokenization lifecycle from investor onboarding to secondary liquidity.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem" }}>
          <div className="step-card">
            <div className="step-number">1</div>
            <div>
              <h4 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.35rem" }}>Onboard & KYC Verify</h4>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", lineHeight: 1.5 }}>
                Register your investor profile and submit verification details. Once reviewed, your wallet is
                whitelisted directly on the Sepolia `KYCRegistry` contract.
              </p>
            </div>
          </div>

          <div className="step-card">
            <div className="step-number">2</div>
            <div>
              <h4 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.35rem" }}>Invest in Offerings</h4>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", lineHeight: 1.5 }}>
                Browse verified primary lots or secondary peer-to-peer listings. Settle purchases instantly using
                MockUSDC stablecoin with atomic escrow execution.
              </p>
            </div>
          </div>

          <div className="step-card">
            <div className="step-number">3</div>
            <div>
              <h4 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.35rem" }}>Coupons & Redemption</h4>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", lineHeight: 1.5 }}>
                Claim your periodic coupon yields directly to your wallet based on on-chain snapshots. At maturity,
                burn bonds to redeem principal face value in full.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Institutional Architecture & Security Pillars */}
      <section style={{ maxWidth: 1040, margin: "0 auto 4rem auto" }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <span className="badge badge-amber">INSTITUTIONAL GRADE</span>
          <h2 style={{ fontSize: "2rem", fontWeight: 800, marginTop: "0.5rem" }}>
            Security, Compliance & Transparency
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Engineered to meet regulatory standards with cryptographic guarantees.
          </p>
        </div>

        <div className="feature-pillar-grid">
          <div className="pillar-card">
            <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: "rgba(59, 130, 246, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1rem" }}>
              <Lock size={22} color="#3b82f6" />
            </div>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.4rem" }}>Permissioned ERC-20</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", lineHeight: 1.5 }}>
              `BondToken` checks the `KYCRegistry` before every transfer, mint, and burn. Unverified addresses cannot
              receive or hold debt securities.
            </p>
          </div>

          <div className="pillar-card">
            <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: "rgba(16, 185, 129, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1rem" }}>
              <ShieldCheck size={22} color="#10b981" />
            </div>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.4rem" }}>Proof of Reserves Guard</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", lineHeight: 1.5 }}>
              The `ReserveGuard` smart contract monitors off-chain backing. If reserves fall below 100% of required
              principal, new minting is automatically halted.
            </p>
          </div>

          <div className="pillar-card">
            <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: "rgba(245, 158, 11, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1rem" }}>
              <Database size={22} color="#f59e0b" />
            </div>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.4rem" }}>Chainlink Live Pricing</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", lineHeight: 1.5 }}>
              Integrated `ChainlinkPriceReader` feeds real-time ETH/USD oracle updates for accurate collateral
              valuation and transparent cross-asset auditability.
            </p>
          </div>
        </div>
      </section>

      {/* Transparency Footer Banner */}
      <section style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div
          className="card"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "1.5rem",
            background: "linear-gradient(135deg, rgba(30, 58, 138, 0.25) 0%, rgba(15, 23, 42, 0.8) 100%)",
            borderColor: "rgba(59, 130, 246, 0.25)",
            padding: "2rem",
          }}
        >
          <div>
            <h3 style={{ fontSize: "1.35rem", fontWeight: 800 }}>Ready to access institutional yield?</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginTop: "0.3rem" }}>
              Connect your MetaMask wallet or sign in as an institution to explore verified bond offerings.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={onSignUp}>
              Investor Portal
            </button>
            <button className="btn btn-secondary" onClick={onInstitutionalLogin}>
              Institutional Portal
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}


import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContract } from "../contracts/platform";
import {
  Coins,
  Clock,
  DollarSign,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Gift,
  Layers,
  Calendar,
  Sparkles
} from "lucide-react";

export default function InvestorDashboard({
  account,
  provider,
  signer,
  network,
  isKycVerified,
  refreshTrigger,
  setRefreshTrigger
}) {
  const [bondBalance, setBondBalance] = useState("0");
  const [usdcBalance, setUsdcBalance] = useState("0");
  const [accruedCoupon, setAccruedCoupon] = useState("0");
  const [maturityDate, setMaturityDate] = useState(null);
  const [isMatured, setIsMatured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    if (account && provider) {
      loadInvestorData();
    }
  }, [account, provider, network, refreshTrigger]);

  const loadInvestorData = async () => {
    try {
      setLoading(true);
      const runner = signer || provider;
      const bondToken = getContract("BondToken", runner, network);
      const mockUSDC = getContract("MockUSDC", runner, network);
      const distributor = getContract("CouponDistributor", runner, network);

      const [bBalance, uBalance, mDate] = await Promise.all([
        bondToken.balanceOf(account),
        mockUSDC.balanceOf(account),
        bondToken.maturityDate(),
      ]);

      setBondBalance(ethers.formatUnits(bBalance, 18));
      setUsdcBalance(ethers.formatUnits(uBalance, 6));

      const matTime = Number(mDate);
      setMaturityDate(new Date(matTime * 1000));
      const now = Math.floor(Date.now() / 1000);
      setIsMatured(now >= matTime);

      if (bBalance > 0n) {
        const couponAmt = await distributor.calculateCoupon(bBalance);
        setAccruedCoupon(ethers.formatUnits(couponAmt, 6));
      } else {
        setAccruedCoupon("0");
      }
    } catch (err) {
      console.error("Error loading investor data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleFaucet = async () => {
    if (!signer) return alert("Please connect your wallet first.");
    try {
      setStatusMsg({ type: "info", text: "Minting 1,000 MockUSDC from faucet..." });
      const mockUSDC = getContract("MockUSDC", signer, network);
      const tx = await mockUSDC.mint(account, ethers.parseUnits("1000", 6));
      await tx.wait();
      setStatusMsg({ type: "success", text: "Successfully credited 1,000 MockUSDC to your wallet!" });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Faucet request failed: ${err.message}` });
    }
  };

  const handleClaimCoupon = async () => {
    if (!signer) return alert("Please connect wallet.");
    if (!isKycVerified) return alert("Your wallet is not KYC verified! Please request whitelisting from the compliance officer.");
    try {
      setStatusMsg({ type: "info", text: "Executing coupon claim for Period 1..." });
      const distributor = getContract("CouponDistributor", signer, network);
      const tx = await distributor.claimCoupon(1);
      await tx.wait();
      setStatusMsg({ type: "success", text: "Coupon payment claimed and transferred to your wallet!" });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Claim failed: ${err.reason || err.message}` });
    }
  };

  const handleRedeem = async () => {
    if (!signer) return alert("Please connect wallet.");
    if (!isKycVerified) return alert("Your wallet is not KYC verified.");
    try {
      const amountToRedeem = prompt("Enter number of bonds to redeem (e.g. 5):", "1");
      if (!amountToRedeem || isNaN(amountToRedeem)) return;
      setStatusMsg({ type: "info", text: `Redeeming ${amountToRedeem} bonds for MockUSDC face value...` });
      const distributor = getContract("CouponDistributor", signer, network);
      const parsedAmount = ethers.parseUnits(amountToRedeem, 18);
      const tx = await distributor.redeem(parsedAmount);
      await tx.wait();
      setStatusMsg({ type: "success", text: `Redemption successful! ${amountToRedeem * 1000} MockUSDC credited.` });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Redemption failed: ${err.reason || err.message}` });
    }
  };

  const bondTotalUSD = (Number(bondBalance) * 1000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Hero Showcase Card */}
      <div
        className="card"
        style={{
          background: "linear-gradient(135deg, rgba(30, 58, 138, 0.4) 0%, rgba(15, 23, 42, 0.9) 100%)",
          borderColor: "rgba(59, 130, 246, 0.3)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="badge badge-blue">SERIES 2028</span>
              <span className="badge badge-emerald">AAA-RATED RWA</span>
              {isKycVerified && <span className="badge badge-emerald">Whitelisted</span>}
            </div>
            <h2 style={{ fontSize: "1.85rem", fontWeight: 800, marginTop: "0.5rem", letterSpacing: "-0.02em" }}>
              Corporate Bond 2028 (CB28)
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginTop: "0.25rem", maxWidth: "600px" }}>
              Fixed-income corporate debt fractionalized into ERC-20 tokens. Supported by audited on-chain proof of reserves and automated smart contract servicing.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button onClick={handleFaucet} className="btn btn-secondary btn-sm" title="Get free testnet USDC">
              <Gift size={14} color="#10b981" />
              <span>Faucet (+1,000 USDC)</span>
            </button>
            <button onClick={loadInvestorData} className="btn-icon" title="Refresh portfolio">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Bond Terms Ribbon */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "1rem",
            marginTop: "1.5rem",
            paddingTop: "1.25rem",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Face Value</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>$1,000.00 / Bond</div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Coupon Yield</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent-emerald)" }}>8.00% APR</div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Payment Frequency</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>Periodic (Snapshot)</div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Maturity Date</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>
              {maturityDate ? maturityDate.toLocaleDateString() : "Loading..."}
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {statusMsg && (
        <div className={`alert-banner ${statusMsg.type}`}>
          <span>{statusMsg.text}</span>
          <button onClick={() => setStatusMsg(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "1rem" }}>✕</button>
        </div>
      )}

      {/* Stat Grid */}
      <div className="grid-4">
        {/* Holdings */}
        <div className="stat-box">
          <div className="stat-label">
            <span>Your Bond Holdings</span>
            <Layers size={16} color="#3b82f6" />
          </div>
          <div className="stat-value font-mono">{Number(bondBalance).toFixed(2)} CB28</div>
          <div className="stat-sub">≈ ${bondTotalUSD} Total Face Value</div>
        </div>

        {/* Stablecoin Balance */}
        <div className="stat-box">
          <div className="stat-label">
            <span>MockUSDC Available</span>
            <DollarSign size={16} color="#10b981" />
          </div>
          <div className="stat-value font-mono">
            ${Number(usdcBalance).toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <div className="stat-sub">Ready for Secondary Trading</div>
        </div>

        {/* Accrued Yield */}
        <div className="stat-box">
          <div className="stat-label">
            <span>Claimable Coupon</span>
            <ArrowUpRight size={16} color="#f59e0b" />
          </div>
          <div className="stat-value font-mono text-emerald" style={{ color: "#10b981" }}>
            ${Number(accruedCoupon).toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <div className="stat-sub">Snapshot Period 1 Yield</div>
        </div>

        {/* Maturity Status */}
        <div className="stat-box">
          <div className="stat-label">
            <span>Principal Status</span>
            <Calendar size={16} color="#94a3b8" />
          </div>
          <div className="stat-value" style={{ fontSize: "1.2rem", marginTop: "0.8rem" }}>
            {isMatured ? (
              <span className="badge badge-emerald">Ready to Redeem</span>
            ) : (
              <span className="badge badge-amber">Lock-in Active</span>
            )}
          </div>
          <div className="stat-sub" style={{ marginTop: "0.4rem" }}>
            {maturityDate ? `Matures: ${maturityDate.toLocaleDateString()}` : "Calculating..."}
          </div>
        </div>
      </div>

      {/* Action Cards Grid */}
      <div className="grid-2">
        {/* Claim Coupon Card */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <Coins size={18} color="#3b82f6" />
                  Claim Coupon Distribution
                </h3>
                <p className="card-subtitle">
                  Collect accrued interest deposited by the bond issuer for current snapshot periods.
                </p>
              </div>
            </div>

            <div
              style={{
                backgroundColor: "var(--bg-input)",
                borderRadius: "var(--radius-md)",
                padding: "1rem",
                border: "1px solid var(--border-subtle)",
                marginBottom: "1.25rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Current Coupon Period:</span>
                <span style={{ fontWeight: 600 }}>Period #1</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Effective Annual Rate:</span>
                <span style={{ fontWeight: 600, color: "var(--accent-emerald)" }}>8.00% APR</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Claimable Payout:</span>
                <span className="font-mono" style={{ fontWeight: 700, color: "var(--accent-emerald)" }}>
                  ${Number(accruedCoupon).toFixed(2)} MockUSDC
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={handleClaimCoupon}
            disabled={!account || !isKycVerified || Number(accruedCoupon) === 0}
            className="btn btn-primary"
            style={{ width: "100%" }}
          >
            Claim Accrued Coupon
          </button>
        </div>

        {/* Principal Redemption Card */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <CheckCircle2 size={18} color="#10b981" />
                  Maturity Principal Redemption
                </h3>
                <p className="card-subtitle">
                  Burn bond tokens upon reaching maturity and receive the full $1,000 principal face value per token in MockUSDC.
                </p>
              </div>
            </div>

            <div
              style={{
                backgroundColor: "var(--bg-input)",
                borderRadius: "var(--radius-md)",
                padding: "1rem",
                border: "1px solid var(--border-subtle)",
                marginBottom: "1.25rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Redemption Eligibility:</span>
                <span style={{ fontWeight: 600, color: isMatured ? "var(--accent-emerald)" : "var(--accent-amber)" }}>
                  {isMatured ? "Matured (Unlocked)" : "Locked until maturity"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Redemption Value:</span>
                <span style={{ fontWeight: 600 }}>$1,000.00 MockUSDC / 1 CB28</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Your Redeemable Balance:</span>
                <span className="font-mono" style={{ fontWeight: 700 }}>
                  {Number(bondBalance).toFixed(2)} CB28 (${bondTotalUSD})
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={handleRedeem}
            disabled={!account || !isKycVerified || !isMatured || Number(bondBalance) === 0}
            className="btn btn-emerald"
            style={{ width: "100%" }}
          >
            Redeem Principal at Maturity
          </button>
        </div>
      </div>
    </div>
  );
}

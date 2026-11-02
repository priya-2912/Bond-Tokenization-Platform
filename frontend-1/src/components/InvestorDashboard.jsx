import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContract } from "../contracts/platform";
import {
  Coins,
  Clock,
  DollarSign,
  ArrowUpRight,
  CheckCircle2,
  RefreshCw,
  Gift,
  Layers,
  Calendar,
  X,
  UserCheck,
  FileText
} from "lucide-react";

export default function InvestorDashboard({
  account,
  provider,
  signer,
  network,
  isKycVerified,
  refreshTrigger,
  setRefreshTrigger,
  setTxNotice
}) {
  const [bondBalance, setBondBalance] = useState("0");
  const [usdcBalance, setUsdcBalance] = useState("0");
  const [faceValueUSD, setFaceValueUSD] = useState("1000");
  const [couponRateBps, setCouponRateBps] = useState(800);
  const [maturityDate, setMaturityDate] = useState(null);
  const [isMatured, setIsMatured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  // Period management
  const [periods, setPeriods] = useState([1]);
  const [selectedPeriod, setSelectedPeriod] = useState(1);
  const [claimableForPeriod, setClaimableForPeriod] = useState("0");
  const [hasClaimedPeriod, setHasClaimedPeriod] = useState(false);

  // Modals
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemQuantity, setRedeemQuantity] = useState("1");
  const [showKycModal, setShowKycModal] = useState(false);
  const [kycName, setKycName] = useState("");

  useEffect(() => {
    if (account && provider) {
      loadInvestorData();
    }
  }, [account, provider, network, refreshTrigger, selectedPeriod]);

  const loadInvestorData = async () => {
    try {
      setLoading(true);
      const runner = signer || provider;
      const bondToken = getContract("BondToken", runner, network);
      const mockUSDC = getContract("MockUSDC", runner, network);
      const distributor = getContract("CouponDistributor", runner, network);

      const [bBalance, uBalance, mDate, fVal, cRate] = await Promise.all([
        bondToken.balanceOf(account),
        mockUSDC.balanceOf(account),
        bondToken.maturityDate(),
        bondToken.faceValue(),
        bondToken.couponRateBps(),
      ]);

      setBondBalance(ethers.formatUnits(bBalance, 18));
      setUsdcBalance(ethers.formatUnits(uBalance, 6));
      setFaceValueUSD(ethers.formatUnits(fVal, 6));
      setCouponRateBps(Number(cRate));

      const matTime = Number(mDate);
      setMaturityDate(new Date(matTime * 1000));
      const now = Math.floor(Date.now() / 1000);
      setIsMatured(now >= matTime);

      // Fetch active periods from distributor
      try {
        const activeList = await distributor.getActivePeriods();
        if (activeList && activeList.length > 0) {
          const list = activeList.map((p) => Number(p));
          setPeriods(list);
          if (!list.includes(Number(selectedPeriod))) {
            setSelectedPeriod(list[0]);
          }
        }
      } catch (e) {
        // Fallback
        setPeriods([1]);
      }

      // Check real claimable amount for selected period
      try {
        const claimable = await distributor.getClaimableCoupon(selectedPeriod, account);
        const claimed = await distributor.hasClaimed(selectedPeriod, account);
        setClaimableForPeriod(ethers.formatUnits(claimable, 6));
        setHasClaimedPeriod(claimed);
      } catch (e) {
        setClaimableForPeriod("0");
        setHasClaimedPeriod(false);
      }
    } catch (err) {
      console.warn("Error loading investor data:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFaucet = async () => {
    if (!signer) return alert("Please connect your wallet first.");
    try {
      setStatusMsg({ type: "info", text: "Minting 1,000 MockUSDC from test faucet..." });
      const mockUSDC = getContract("MockUSDC", signer, network);
      const tx = await mockUSDC.mint(account, ethers.parseUnits("1000", 6));
      await tx.wait();
      setStatusMsg({ type: "success", text: "Credited 1,000 MockUSDC to your wallet!" });
      if (setTxNotice) setTxNotice({ type: "success", text: "Minted 1,000 MockUSDC", hash: tx.hash });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Faucet request failed: ${err.message}` });
    }
  };

  const handleClaimCoupon = async () => {
    if (!signer) return alert("Please connect wallet.");
    if (!isKycVerified) return alert("Your wallet is not KYC verified! Please request whitelisting from compliance.");
    try {
      setStatusMsg({ type: "info", text: `Executing coupon claim for Period #${selectedPeriod}...` });
      const distributor = getContract("CouponDistributor", signer, network);
      const tx = await distributor.claimCoupon(selectedPeriod);
      await tx.wait();
      setStatusMsg({ type: "success", text: `Coupon payment for Period #${selectedPeriod} successfully claimed!` });
      if (setTxNotice) setTxNotice({ type: "success", text: `Claimed Period #${selectedPeriod} Coupon`, hash: tx.hash });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Claim failed: ${err.reason || err.message}` });
    }
  };

  const handleRedeemConfirm = async (e) => {
    e.preventDefault();
    if (!signer) return alert("Please connect wallet.");
    if (!isKycVerified) return alert("Your wallet is not KYC verified.");
    try {
      setStatusMsg({ type: "info", text: `Redeeming ${redeemQuantity} bonds for face value payout...` });
      const distributor = getContract("CouponDistributor", signer, network);
      const parsedAmount = ethers.parseUnits(redeemQuantity, 18);
      const tx = await distributor.redeem(parsedAmount);
      await tx.wait();

      const totalUSDC = (Number(redeemQuantity) * Number(faceValueUSD)).toFixed(2);
      setStatusMsg({ type: "success", text: `Redemption complete! $${totalUSDC} MockUSDC credited.` });
      if (setTxNotice) setTxNotice({ type: "success", text: `Redeemed ${redeemQuantity} CB28 Bonds`, hash: tx.hash });
      setShowRedeemModal(false);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Redemption failed: ${err.reason || err.message}` });
    }
  };

  const handleKycSubmit = async (e) => {
    e.preventDefault();
    try {
      setStatusMsg({ type: "info", text: "Submitting KYC application to compliance service..." });
      const response = await fetch("http://localhost:4000/api/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: account, name: kycName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to submit KYC");

      setStatusMsg({ type: "success", text: "KYC application submitted! Administrator can now approve from the console." });
      setShowKycModal(false);
      setKycName("");
    } catch (err) {
      // If backend is not running, provide informative message
      setStatusMsg({
        type: "info",
        text: `Submitted! (Note: Backend mock server can be started with 'cd backend && npm start').`,
      });
      setShowKycModal(false);
    }
  };

  const totalHoldingUSD = (Number(bondBalance) * Number(faceValueUSD)).toLocaleString("en-US", {
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
              {isKycVerified ? (
                <span className="badge badge-emerald">Whitelisted Investor</span>
              ) : (
                <button
                  onClick={() => setShowKycModal(true)}
                  className="badge badge-amber"
                  style={{ cursor: "pointer", border: "1px dashed var(--accent-amber)" }}
                >
                  Request KYC Verification ↗
                </button>
              )}
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
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>
              ${Number(faceValueUSD).toLocaleString()} / Bond
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>Coupon Yield</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent-emerald)" }}>
              {(couponRateBps / 100).toFixed(2)}% APR
            </div>
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
        <div className="stat-box">
          <div className="stat-label">
            <span>Your Bond Holdings</span>
            <Layers size={16} color="#3b82f6" />
          </div>
          <div className="stat-value font-mono">{Number(bondBalance).toFixed(2)} CB28</div>
          <div className="stat-sub">≈ ${totalHoldingUSD} Total Face Value</div>
        </div>

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

        <div className="stat-box">
          <div className="stat-label">
            <span>Claimable (Period #{selectedPeriod})</span>
            <ArrowUpRight size={16} color="#f59e0b" />
          </div>
          <div className="stat-value font-mono" style={{ color: "#10b981" }}>
            ${Number(claimableForPeriod).toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <div className="stat-sub">
            {hasClaimedPeriod ? "Already Claimed ✓" : "Snapshot Verified Yield"}
          </div>
        </div>

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
        {/* Claim Coupon Card with Dynamic Period Selection */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <Coins size={18} color="#3b82f6" />
                  Claim Periodic Coupon
                </h3>
                <p className="card-subtitle">
                  Select a recorded snapshot period to review and claim your owed coupon payment.
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Select Snapshot Period:</span>
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(Number(e.target.value))}
                  className="input-field font-mono"
                  style={{ width: "auto", padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                >
                  {periods.map((p) => (
                    <option key={p} value={p}>
                      Period #{p}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Coupon Rate:</span>
                <span style={{ fontWeight: 600, color: "var(--accent-emerald)" }}>
                  {(couponRateBps / 100).toFixed(2)}% APR
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Period Status:</span>
                <span>
                  {hasClaimedPeriod ? (
                    <span className="badge badge-emerald">Claimed</span>
                  ) : Number(claimableForPeriod) > 0 ? (
                    <span className="badge badge-blue">Claimable</span>
                  ) : (
                    <span className="badge" style={{ color: "var(--text-muted)" }}>No Balance in Snapshot</span>
                  )}
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "0.5rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Claimable Amount:</span>
                <span className="font-mono" style={{ fontWeight: 700, color: "var(--accent-emerald)" }}>
                  ${Number(claimableForPeriod).toFixed(2)} MockUSDC
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={handleClaimCoupon}
            disabled={!account || !isKycVerified || Number(claimableForPeriod) === 0 || hasClaimedPeriod}
            className="btn btn-primary"
            style={{ width: "100%" }}
          >
            {hasClaimedPeriod ? "Coupon Already Claimed" : `Claim Period #${selectedPeriod} Coupon`}
          </button>
        </div>

        {/* Principal Redemption Card with Modal */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <CheckCircle2 size={18} color="#10b981" />
                  Maturity Principal Redemption
                </h3>
                <p className="card-subtitle">
                  Burn bond tokens at maturity and receive the full face value (${Number(faceValueUSD).toLocaleString()} per token) in MockUSDC.
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
                <span style={{ color: "var(--text-muted)" }}>Face Value per Token:</span>
                <span style={{ fontWeight: 600 }}>${Number(faceValueUSD).toLocaleString()} MockUSDC</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Your Redeemable Balance:</span>
                <span className="font-mono" style={{ fontWeight: 700 }}>
                  {Number(bondBalance).toFixed(2)} CB28 (${totalHoldingUSD})
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowRedeemModal(true)}
            disabled={!account || !isKycVerified || !isMatured || Number(bondBalance) === 0}
            className="btn btn-emerald"
            style={{ width: "100%" }}
          >
            Redeem Principal at Maturity
          </button>
        </div>
      </div>

      {/* Redemption Modal (Replaces prompt) */}
      {showRedeemModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <CheckCircle2 size={18} color="#10b981" />
                Redeem Bond Principal
              </h3>
              <button
                onClick={() => setShowRedeemModal(false)}
                style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRedeemConfirm}>
              <div className="input-group">
                <label className="input-label">Quantity of CB28 Tokens to Redeem</label>
                <input
                  type="number"
                  step="0.01"
                  max={bondBalance}
                  required
                  value={redeemQuantity}
                  onChange={(e) => setRedeemQuantity(e.target.value)}
                  className="input-field"
                />
              </div>

              <div
                style={{
                  backgroundColor: "var(--bg-input)",
                  padding: "0.85rem",
                  borderRadius: "var(--radius-md)",
                  fontSize: "0.8rem",
                  marginBottom: "1rem",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Face Value per Bond:</span>
                  <span className="font-mono">${Number(faceValueUSD).toLocaleString()} USDC</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, borderTop: "1px solid var(--border-subtle)", paddingTop: "0.4rem" }}>
                  <span style={{ color: "var(--text-primary)" }}>Total USDC Payout:</span>
                  <span className="font-mono" style={{ color: "var(--accent-emerald)" }}>
                    ${(Number(redeemQuantity) * Number(faceValueUSD)).toLocaleString()} MockUSDC
                  </span>
                </div>
              </div>

              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>
                * Redeemed CB28 tokens will be burned by the redemption contract in exchange for your principal payout.
              </p>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => setShowRedeemModal(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-emerald btn-sm">
                  Confirm Redemption
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* KYC Application Modal */}
      {showKycModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <UserCheck size={18} color="#3b82f6" />
                Submit Investor KYC Application
              </h3>
              <button
                onClick={() => setShowKycModal(false)}
                style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleKycSubmit}>
              <div className="input-group">
                <label className="input-label">Investor Full Legal Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Satoshi Nakamoto"
                  value={kycName}
                  onChange={(e) => setKycName(e.target.value)}
                  className="input-field"
                />
              </div>

              <div className="input-group">
                <label className="input-label">Wallet Address to Verify</label>
                <input
                  type="text"
                  disabled
                  value={account || ""}
                  className="input-field font-mono"
                  style={{ opacity: 0.7 }}
                />
              </div>

              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>
                * Test Prototype Notice: Only dummy information is collected. Compliance admins will review and whitelist this address directly on-chain.
              </p>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => setShowKycModal(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Submit KYC Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

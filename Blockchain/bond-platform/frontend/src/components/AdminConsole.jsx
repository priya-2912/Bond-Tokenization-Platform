import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContract } from "../contracts/platform";
import {
  Shield,
  Pause,
  Play,
  AlertOctagon,
  TrendingUp,
  UserCheck,
  UserX,
  RefreshCw,
  Bell,
  Wallet,
  Activity,
  Sliders,
  CheckCircle2
} from "lucide-react";

export default function AdminConsole({
  account,
  provider,
  signer,
  network,
  refreshTrigger,
  setRefreshTrigger
}) {
  const [isPaused, setIsPaused] = useState(false);
  const [reserveRatioBps, setReserveRatioBps] = useState(10000);
  const [reportedReserves, setReportedReserves] = useState("0");
  const [requiredReserves, setRequiredReserves] = useState("0");
  const [alertActive, setAlertActive] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form states
  const [kycTarget, setKycTarget] = useState("");
  const [newReserveInput, setNewReserveInput] = useState("");
  const [couponDepositInput, setCouponDepositInput] = useState("");
  const [snapshotPeriodInput, setSnapshotPeriodInput] = useState("1");
  const [snapshotAddressesInput, setSnapshotAddressesInput] = useState("");
  const [snapshotBalancesInput, setSnapshotBalancesInput] = useState("");
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    if (provider) {
      loadAdminData();
    }
  }, [provider, network, refreshTrigger]);

  const loadAdminData = async () => {
    try {
      setLoading(true);
      const runner = signer || provider;
      const bondToken = getContract("BondToken", runner, network);
      const reserveGuard = getContract("ReserveGuard", runner, network);

      const [paused, ratio, req, resData, activeAlert] = await Promise.all([
        bondToken.paused(),
        reserveGuard.reserveRatioBps(),
        reserveGuard.requiredReserves(),
        reserveGuard.reserves(),
        reserveGuard.alertActive(),
      ]);

      setIsPaused(paused);
      setReserveRatioBps(Number(ratio));
      setRequiredReserves(ethers.formatUnits(req, 6));
      setReportedReserves(ethers.formatUnits(resData.amount, 6));
      setAlertActive(activeAlert);
    } catch (err) {
      console.error("Error loading admin data:", err);
    } finally {
      setLoading(false);
    }
  };

  const togglePause = async () => {
    if (!signer) return alert("Please connect compliance/admin wallet.");
    try {
      const bondToken = getContract("BondToken", signer, network);
      setStatusMsg({ type: "info", text: isPaused ? "Unpausing all bond transfers..." : "Executing emergency pause on transfers..." });
      const tx = isPaused ? await bondToken.unpause() : await bondToken.pause();
      await tx.wait();
      setStatusMsg({ type: "success", text: `Bond transfers successfully ${isPaused ? "resumed" : "paused"}!` });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Pause toggle failed: ${err.reason || err.message}` });
    }
  };

  const handleKycAction = async (action) => {
    if (!signer) return alert("Please connect compliance wallet.");
    if (!ethers.isAddress(kycTarget)) return alert("Please enter a valid Ethereum address.");

    try {
      const kycRegistry = getContract("KYCRegistry", signer, network);
      setStatusMsg({ type: "info", text: `${action === "add" ? "Whitelisting" : "Removing"} address ${kycTarget}...` });
      const tx = action === "add"
        ? await kycRegistry.addToWhitelist(kycTarget)
        : await kycRegistry.removeFromWhitelist(kycTarget);
      await tx.wait();
      setStatusMsg({ type: "success", text: `KYC status updated successfully for ${kycTarget}!` });
      setKycTarget("");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `KYC action failed: ${err.reason || err.message}` });
    }
  };

  const handleUpdateReserves = async (e) => {
    e.preventDefault();
    if (!signer) return alert("Please connect oracle admin wallet.");
    try {
      const reserveOracle = getContract("ReserveOracle", signer, network);
      const parsedAmount = ethers.parseUnits(newReserveInput, 6);
      setStatusMsg({ type: "info", text: `Simulating reserve update to $${Number(newReserveInput).toLocaleString()}...` });
      const tx = await reserveOracle.updateReserve(parsedAmount);
      await tx.wait();
      setStatusMsg({ type: "success", text: "ReserveOracle updated on-chain!" });
      setNewReserveInput("");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Reserve update failed: ${err.reason || err.message}` });
    }
  };

  const handleCheckAndAlert = async () => {
    if (!signer) return alert("Please connect wallet.");
    try {
      setStatusMsg({ type: "info", text: "Calling ReserveGuard.checkAndAlert()..." });
      const reserveGuard = getContract("ReserveGuard", signer, network);
      const tx = await reserveGuard.checkAndAlert();
      await tx.wait();
      setStatusMsg({ type: "success", text: "checkAndAlert executed! Check event emissions on Transparency tab." });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `checkAndAlert failed: ${err.reason || err.message}` });
    }
  };

  const handleDepositCoupon = async (e) => {
    e.preventDefault();
    if (!signer) return alert("Please connect issuer wallet.");
    try {
      const mockUSDC = getContract("MockUSDC", signer, network);
      const distributor = getContract("CouponDistributor", signer, network);
      const distributorAddress = await distributor.getAddress();
      const parsed = ethers.parseUnits(couponDepositInput, 6);

      setStatusMsg({ type: "info", text: "Step 1/2: Approving MockUSDC transfer..." });
      const appTx = await mockUSDC.approve(distributorAddress, parsed);
      await appTx.wait();

      setStatusMsg({ type: "info", text: "Step 2/2: Depositing funds into distributor contract..." });
      const depTx = await distributor.depositFunds(parsed);
      await depTx.wait();

      setStatusMsg({ type: "success", text: `$${Number(couponDepositInput).toLocaleString()} coupon liquidity deposited!` });
      setCouponDepositInput("");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Deposit failed: ${err.reason || err.message}` });
    }
  };

  const handleRecordSnapshot = async (e) => {
    e.preventDefault();
    if (!signer) return alert("Please connect issuer wallet.");
    try {
      const distributor = getContract("CouponDistributor", signer, network);
      const accounts = snapshotAddressesInput.split(",").map((a) => a.trim());
      const balances = snapshotBalancesInput.split(",").map((b) => ethers.parseUnits(b.trim(), 18));

      setStatusMsg({ type: "info", text: `Recording balances for Period #${snapshotPeriodInput}...` });
      const tx = await distributor.recordSnapshot(Number(snapshotPeriodInput), accounts, balances);
      await tx.wait();

      setStatusMsg({ type: "success", text: `Snapshot for Period #${snapshotPeriodInput} recorded successfully!` });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Snapshot recording failed: ${err.reason || err.message}` });
    }
  };

  const ratioPercent = (reserveRatioBps / 100).toFixed(1);
  const isHealthy = reserveRatioBps >= 10000;
  const progressFill = Math.min(Math.max((reserveRatioBps / 10000) * 100, 0), 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Header */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="badge badge-blue">GOVERNANCE & SAFETY</span>
              <span className="badge badge-emerald">AccessControl Enabled</span>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Issuer & Compliance Console
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Central administrative hub for monitoring collateral health, triggering circuit breaker pauses, managing KYC whitelist registries, and funding coupon pools.
            </p>
          </div>

          <button onClick={loadAdminData} className="btn-icon" title="Refresh console data">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Notifications */}
      {statusMsg && (
        <div className={`alert-banner ${statusMsg.type}`}>
          <span>{statusMsg.text}</span>
          <button onClick={() => setStatusMsg(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "1rem" }}>✕</button>
        </div>
      )}

      {/* Proof of Reserves Health Monitor Card */}
      <div
        className="card"
        style={{
          border: isHealthy ? "1px solid var(--accent-emerald-border)" : "1px solid var(--accent-rose-border)",
          background: isHealthy
            ? "radial-gradient(circle at 10% 50%, rgba(16, 185, 129, 0.08) 0%, var(--bg-card) 60%)"
            : "radial-gradient(circle at 10% 50%, rgba(244, 63, 94, 0.12) 0%, var(--bg-card) 60%)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
                Proof of Reserves (PoR) Coverage Monitor
              </span>
              {alertActive && <span className="badge badge-rose">ReserveAlert Active</span>}
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginTop: "0.5rem" }}>
              <span
                className="font-mono"
                style={{
                  fontSize: "2.5rem",
                  fontWeight: 800,
                  color: isHealthy ? "var(--accent-emerald)" : "var(--accent-rose)",
                  letterSpacing: "-0.03em",
                }}
              >
                {ratioPercent}%
              </span>
              <span className="font-mono" style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                (${Number(reportedReserves).toLocaleString()} / ${Number(requiredReserves).toLocaleString()} USD)
              </span>
            </div>

            <p style={{ fontSize: "0.8rem", color: isHealthy ? "var(--accent-emerald)" : "var(--accent-rose)", marginTop: "0.25rem", fontWeight: 600 }}>
              {isHealthy
                ? "✓ Collateral fully covers outstanding bond supply (Minting Permitted)"
                : "⚠ Undercollateralized! ReserveGuard blocks new token minting"}
            </p>
          </div>

          <button onClick={handleCheckAndAlert} className="btn btn-secondary btn-sm">
            <Bell size={14} color="#f59e0b" />
            <span>Emit Reserve Check Event</span>
          </button>
        </div>

        {/* Linear Gauge */}
        <div className="gauge-container" style={{ marginTop: "1.25rem" }}>
          <div
            className="gauge-fill"
            style={{
              width: `${progressFill}%`,
              backgroundColor: isHealthy ? "var(--accent-emerald)" : "var(--accent-rose)",
            }}
          ></div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--text-muted)" }}>
          <span>0%</span>
          <span>100% Minimum Required</span>
          <span>150%+</span>
        </div>
      </div>

      {/* 4 Admin Modules */}
      <div className="grid-2">
        {/* Module 1: Circuit Breaker Pause */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <h3 className="card-title">
                <AlertOctagon size={18} color="#f59e0b" />
                Emergency Circuit Breaker
              </h3>
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
              Instantly freezes or resumes all token transfers, secondary trading, and escrow operations in the event of regulatory audits or security incidents.
            </p>

            <div
              style={{
                backgroundColor: "var(--bg-input)",
                padding: "0.85rem",
                borderRadius: "var(--radius-md)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1.25rem",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Current Transfer State:</span>
              <span className={`badge ${isPaused ? "badge-rose" : "badge-emerald"}`}>
                {isPaused ? "PAUSED (TRADING HALTED)" : "NORMAL (TRANSFERS ENABLED)"}
              </span>
            </div>
          </div>

          <button
            onClick={togglePause}
            className={`btn ${isPaused ? "btn-emerald" : "btn-rose"}`}
            style={{ width: "100%" }}
          >
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
            <span>{isPaused ? "Unpause Token Transfers" : "Emergency Pause All Transfers"}</span>
          </button>
        </div>

        {/* Module 2: Oracle Reserve Simulation */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <h3 className="card-title">
                <TrendingUp size={18} color="#3b82f6" />
                Simulate Reserve Oracle Update
              </h3>
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Simulates an off-chain custodian reserve report update to verify circuit breaker reactions and reserve drop alerts.
            </p>

            <form onSubmit={handleUpdateReserves}>
              <div className="input-group">
                <label className="input-label">Reported Custodian Reserve (USD)</label>
                <input
                  type="number"
                  required
                  placeholder="e.g. 500000 for 50% drop, or 1200000 for healthy"
                  value={newReserveInput}
                  onChange={(e) => setNewReserveInput(e.target.value)}
                  className="input-field"
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
                Update Oracle Value
              </button>
            </form>
          </div>
        </div>

        {/* Module 3: KYC Whitelist Registry */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <h3 className="card-title">
                <UserCheck size={18} color="#10b981" />
                KYC Whitelist Management
              </h3>
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              COMPLIANCE_ROLE directly whitelists or revokes investor Ethereum addresses for primary bond issuance and secondary trading.
            </p>

            <div className="input-group">
              <label className="input-label">Investor Wallet Address</label>
              <input
                type="text"
                placeholder="0x..."
                value={kycTarget}
                onChange={(e) => setKycTarget(e.target.value)}
                className="input-field font-mono"
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={() => handleKycAction("add")}
              className="btn btn-emerald"
              style={{ flex: 1 }}
            >
              <UserCheck size={14} />
              <span>Whitelist</span>
            </button>
            <button
              onClick={() => handleKycAction("remove")}
              className="btn btn-rose"
              style={{ flex: 1 }}
            >
              <UserX size={14} />
              <span>Revoke</span>
            </button>
          </div>
        </div>

        {/* Module 4: Corporate Actions (Deposit & Snapshot) */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <h3 className="card-title">
                <Sliders size={18} color="#a855f7" />
                Coupon Operations & Snapshots
              </h3>
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Deposit MockUSDC coupon liquidity and record period balance snapshots for distribution.
            </p>

            {/* Deposit Funds */}
            <form onSubmit={handleDepositCoupon} style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="number"
                  placeholder="USDC Amount (e.g. 10000)"
                  value={couponDepositInput}
                  onChange={(e) => setCouponDepositInput(e.target.value)}
                  className="input-field"
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  Fund Pool
                </button>
              </div>
            </form>

            {/* Record Snapshot */}
            <form onSubmit={handleRecordSnapshot}>
              <div className="input-group" style={{ marginBottom: "0.5rem" }}>
                <input
                  type="number"
                  placeholder="Period ID (e.g. 1)"
                  value={snapshotPeriodInput}
                  onChange={(e) => setSnapshotPeriodInput(e.target.value)}
                  className="input-field"
                />
              </div>
              <div className="input-group" style={{ marginBottom: "0.5rem" }}>
                <input
                  type="text"
                  placeholder="Addresses (comma separated 0x...)"
                  value={snapshotAddressesInput}
                  onChange={(e) => setSnapshotAddressesInput(e.target.value)}
                  className="input-field font-mono"
                  style={{ fontSize: "0.75rem" }}
                />
              </div>
              <div className="input-group" style={{ marginBottom: "0.75rem" }}>
                <input
                  type="text"
                  placeholder="Balances (comma separated e.g. 500, 100)"
                  value={snapshotBalancesInput}
                  onChange={(e) => setSnapshotBalancesInput(e.target.value)}
                  className="input-field font-mono"
                  style={{ fontSize: "0.75rem" }}
                />
              </div>
              <button type="submit" className="btn btn-secondary btn-sm" style={{ width: "100%" }}>
                Record Snapshot
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

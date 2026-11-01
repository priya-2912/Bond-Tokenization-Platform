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
  CheckCircle2,
  Lock,
  Clock,
  Layers,
  ArrowDownCircle,
  ExternalLink,
  Coins
} from "lucide-react";

export default function AdminConsole({
  account,
  provider,
  signer,
  network,
  userRoles = { isAdmin: false, isCompliance: false, isIssuer: false },
  refreshTrigger,
  setRefreshTrigger,
  setTxNotice,
}) {
  const [isPaused, setIsPaused] = useState(false);
  const [reserveRatioBps, setReserveRatioBps] = useState(10000);
  const [reportedReserves, setReportedReserves] = useState("0");
  const [requiredReserves, setRequiredReserves] = useState("0");
  const [alertActive, setAlertActive] = useState(false);
  const [loading, setLoading] = useState(false);

  // Pool balances
  const [couponPool, setCouponPool] = useState("0");
  const [redemptionPool, setRedemptionPool] = useState("0");
  const [distributorTotalUsdc, setDistributorTotalUsdc] = useState("0");

  // Form states
  const [kycTarget, setKycTarget] = useState("");
  const [newReserveInput, setNewReserveInput] = useState("");
  const [depositAmountInput, setDepositAmountInput] = useState("");
  const [depositType, setDepositType] = useState("coupon"); // "coupon" | "redemption"
  const [withdrawAmountInput, setWithdrawAmountInput] = useState("");
  const [withdrawRecipientInput, setWithdrawRecipientInput] = useState("");
  const [activePoolTab, setActivePoolTab] = useState("deposit"); // "deposit" | "withdraw" | "snapshot"

  const [snapshotPeriodInput, setSnapshotPeriodInput] = useState("1");
  const [snapshotAddressesInput, setSnapshotAddressesInput] = useState("");
  const [snapshotBalancesInput, setSnapshotBalancesInput] = useState("");
  const [statusMsg, setStatusMsg] = useState(null);

  // Pending KYC Requests from backend
  const [kycSubTab, setKycSubTab] = useState("pending"); // "pending" | "manual"
  const [pendingKycList, setPendingKycList] = useState([]);
  const [loadingPendingKyc, setLoadingPendingKyc] = useState(false);

  useEffect(() => {
    if (provider) {
      loadAdminData();
    }
  }, [provider, network, refreshTrigger]);

  useEffect(() => {
    loadPendingKyc();
  }, [refreshTrigger]);

  const loadPendingKyc = async () => {
    try {
      setLoadingPendingKyc(true);
      const res = await fetch("http://localhost:4000/api/kyc?status=pending", {
        headers: { "x-admin-key": "aura-platform-dev-key" },
      });
      if (res.ok) {
        const data = await res.json();
        setPendingKycList(Array.isArray(data) ? data : []);
      }
    } catch {
      // Backend not running, graceful fallback
      setPendingKycList([]);
    } finally {
      setLoadingPendingKyc(false);
    }
  };

  const loadAdminData = async () => {
    try {
      setLoading(true);
      const runner = signer || provider;
      const bondToken = getContract("BondToken", runner, network);
      const reserveGuard = getContract("ReserveGuard", runner, network);
      const distributor = getContract("CouponDistributor", runner, network);
      const mockUSDC = getContract("MockUSDC", runner, network);

      const distributorAddress = await distributor.getAddress();

      const [paused, ratio, req, resData, activeAlert, cPool, rPool, distBal] = await Promise.all([
        bondToken.paused(),
        reserveGuard.reserveRatioBps(),
        reserveGuard.requiredReserves(),
        reserveGuard.reserves(),
        reserveGuard.alertActive(),
        distributor.couponPool().catch(() => 0n),
        distributor.redemptionPool().catch(() => 0n),
        mockUSDC.balanceOf(distributorAddress).catch(() => 0n),
      ]);

      setIsPaused(paused);
      setReserveRatioBps(Number(ratio));
      setRequiredReserves(ethers.formatUnits(req, 6));
      setReportedReserves(ethers.formatUnits(resData.amount, 6));
      setAlertActive(activeAlert);
      setCouponPool(ethers.formatUnits(cPool, 6));
      setRedemptionPool(ethers.formatUnits(rPool, 6));
      setDistributorTotalUsdc(ethers.formatUnits(distBal, 6));
    } catch (err) {
      console.error("Error loading admin data:", err);
    } finally {
      setLoading(false);
    }
  };

  const togglePause = async () => {
    if (!signer) {
      return setStatusMsg({ type: "error", text: "Please connect an authorized admin wallet." });
    }
    if (!userRoles.isAdmin) {
      return setStatusMsg({ type: "error", text: "Unauthorized: Connected wallet lacks PAUSER_ROLE." });
    }
    try {
      const bondToken = getContract("BondToken", signer, network);
      setStatusMsg({
        type: "info",
        text: isPaused ? "Unpausing all bond transfers..." : "Executing emergency pause on transfers...",
      });
      const tx = isPaused ? await bondToken.unpause() : await bondToken.pause();
      await tx.wait();
      setStatusMsg({
        type: "success",
        text: `Bond transfers successfully ${isPaused ? "resumed" : "paused"}!`,
        hash: tx.hash,
      });
      if (setTxNotice) {
        setTxNotice({
          type: "success",
          text: `Circuit breaker: Transfers ${isPaused ? "resumed" : "halted"}`,
          hash: tx.hash,
        });
      }
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Pause toggle failed: ${err.reason || err.message}` });
    }
  };

  const handleKycAction = async (action, targetAddr = null) => {
    const addressToProcess = targetAddr || kycTarget;
    if (!signer) {
      return setStatusMsg({ type: "error", text: "Please connect compliance wallet." });
    }
    if (!userRoles.isCompliance) {
      return setStatusMsg({ type: "error", text: "Unauthorized: Connected wallet lacks COMPLIANCE_ROLE." });
    }
    if (!ethers.isAddress(addressToProcess)) {
      return setStatusMsg({ type: "error", text: `Invalid Ethereum address: "${addressToProcess}".` });
    }

    try {
      const kycRegistry = getContract("KYCRegistry", signer, network);
      setStatusMsg({
        type: "info",
        text: `${action === "add" ? "Whitelisting" : "Removing"} address ${addressToProcess}...`,
      });
      const tx =
        action === "add"
          ? await kycRegistry.addToWhitelist(addressToProcess)
          : await kycRegistry.removeFromWhitelist(addressToProcess);
      await tx.wait();

      // If approving a pending backend request, notify the backend API
      if (action === "add") {
        try {
          await fetch(`http://localhost:4000/api/kyc/${addressToProcess}/approve`, {
            method: "POST",
            headers: { "x-admin-key": "aura-platform-dev-key" },
          });
        } catch {
          // off-chain sync error is non-fatal
        }
      }

      setStatusMsg({
        type: "success",
        text: `KYC status updated successfully for ${addressToProcess}!`,
        hash: tx.hash,
      });
      if (!targetAddr) setKycTarget("");
      loadPendingKyc();
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `KYC action failed: ${err.reason || err.message}` });
    }
  };

  const handleRejectPendingKyc = async (wallet) => {
    try {
      await fetch(`http://localhost:4000/api/kyc/${wallet}/reject`, {
        method: "POST",
        headers: { "x-admin-key": "aura-platform-dev-key" },
      });
      setStatusMsg({ type: "info", text: `Rejected KYC submission for ${wallet}.` });
      loadPendingKyc();
    } catch {
      setStatusMsg({ type: "error", text: "Failed to communicate with KYC backend." });
    }
  };

  const handleUpdateReserves = async (e) => {
    e.preventDefault();
    if (!signer) {
      return setStatusMsg({ type: "error", text: "Please connect oracle admin wallet." });
    }
    if (!userRoles.isAdmin) {
      return setStatusMsg({ type: "error", text: "Unauthorized: Connected wallet lacks admin permissions." });
    }
    const val = parseFloat(newReserveInput);
    if (isNaN(val) || val < 0) {
      return setStatusMsg({ type: "error", text: "Reserve value must be a non-negative number." });
    }

    try {
      const reserveOracle = getContract("ReserveOracle", signer, network);
      const parsedAmount = ethers.parseUnits(newReserveInput, 6);
      setStatusMsg({
        type: "info",
        text: `Simulating reserve update to $${Number(newReserveInput).toLocaleString()}...`,
      });
      const tx = await reserveOracle.updateReserve(parsedAmount);
      await tx.wait();
      setStatusMsg({
        type: "success",
        text: "ReserveOracle updated on-chain!",
        hash: tx.hash,
      });
      setNewReserveInput("");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Reserve update failed: ${err.reason || err.message}` });
    }
  };

  const handleCheckAndAlert = async () => {
    if (!signer) {
      return setStatusMsg({ type: "error", text: "Please connect wallet to call ReserveGuard." });
    }
    try {
      setStatusMsg({ type: "info", text: "Calling ReserveGuard.checkAndAlert()..." });
      const reserveGuard = getContract("ReserveGuard", signer, network);
      const tx = await reserveGuard.checkAndAlert();
      await tx.wait();
      setStatusMsg({
        type: "success",
        text: "checkAndAlert executed! Check event emissions on Transparency tab.",
        hash: tx.hash,
      });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `checkAndAlert failed: ${err.reason || err.message}` });
    }
  };

  const handleDepositLiquidity = async (e) => {
    e.preventDefault();
    if (!signer) {
      return setStatusMsg({ type: "error", text: "Please connect issuer wallet." });
    }
    if (!userRoles.isIssuer) {
      return setStatusMsg({ type: "error", text: "Unauthorized: Connected wallet lacks ISSUER_ROLE." });
    }
    const amountVal = parseFloat(depositAmountInput);
    if (isNaN(amountVal) || amountVal <= 0) {
      return setStatusMsg({ type: "error", text: "Deposit amount must be a positive number." });
    }

    try {
      const mockUSDC = getContract("MockUSDC", signer, network);
      const distributor = getContract("CouponDistributor", signer, network);
      const distributorAddress = await distributor.getAddress();
      const parsed = ethers.parseUnits(depositAmountInput, 6);

      setStatusMsg({ type: "info", text: "Step 1/2: Approving MockUSDC transfer..." });
      const appTx = await mockUSDC.approve(distributorAddress, parsed);
      await appTx.wait();

      setStatusMsg({
        type: "info",
        text: `Step 2/2: Depositing funds into ${depositType === "coupon" ? "Coupon Pool" : "Redemption Pool"}...`,
      });
      const depTx =
        depositType === "coupon"
          ? await distributor.depositCouponFunds(parsed)
          : await distributor.depositRedemptionFunds(parsed);
      await depTx.wait();

      setStatusMsg({
        type: "success",
        text: `$${Number(depositAmountInput).toLocaleString()} deposited into ${
          depositType === "coupon" ? "Coupon Pool" : "Redemption Pool"
        }!`,
        hash: depTx.hash,
      });
      setDepositAmountInput("");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Deposit failed: ${err.reason || err.message}` });
    }
  };

  const handleWithdrawFunds = async (e) => {
    e.preventDefault();
    if (!signer) {
      return setStatusMsg({ type: "error", text: "Please connect admin wallet." });
    }
    if (!userRoles.isAdmin) {
      return setStatusMsg({ type: "error", text: "Unauthorized: Connected wallet lacks DEFAULT_ADMIN_ROLE." });
    }
    const amountVal = parseFloat(withdrawAmountInput);
    if (isNaN(amountVal) || amountVal <= 0) {
      return setStatusMsg({ type: "error", text: "Withdraw amount must be a positive number." });
    }

    const recipient = withdrawRecipientInput.trim() || account;
    if (!ethers.isAddress(recipient)) {
      return setStatusMsg({ type: "error", text: `Invalid recipient address: "${recipient}".` });
    }

    try {
      const distributor = getContract("CouponDistributor", signer, network);
      const mockUSDC = getContract("MockUSDC", signer, network);
      const usdcAddress = await mockUSDC.getAddress();
      const parsed = ethers.parseUnits(withdrawAmountInput, 6);

      setStatusMsg({ type: "info", text: `Withdrawing $${amountVal.toLocaleString()} USDC to ${recipient}...` });
      const tx = await distributor.withdrawUnusedFunds(usdcAddress, parsed, recipient);
      await tx.wait();

      setStatusMsg({
        type: "success",
        text: `Successfully withdrew $${amountVal.toLocaleString()} USDC to ${recipient}!`,
        hash: tx.hash,
      });
      setWithdrawAmountInput("");
      setWithdrawRecipientInput("");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Withdraw failed: ${err.reason || err.message}` });
    }
  };

  const handleRecordSnapshot = async (e) => {
    e.preventDefault();
    if (!signer) {
      return setStatusMsg({ type: "error", text: "Please connect issuer wallet." });
    }
    if (!userRoles.isIssuer) {
      return setStatusMsg({ type: "error", text: "Unauthorized: Connected wallet lacks ISSUER_ROLE." });
    }

    // Strict input validation
    const period = parseInt(snapshotPeriodInput, 10);
    if (isNaN(period) || period <= 0) {
      return setStatusMsg({
        type: "error",
        text: "Invalid Period ID: must be a positive integer (e.g. 1, 2, 3).",
      });
    }

    const accounts = snapshotAddressesInput
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    if (accounts.length === 0) {
      return setStatusMsg({ type: "error", text: "Please provide at least one investor address." });
    }

    for (const addr of accounts) {
      if (!ethers.isAddress(addr)) {
        return setStatusMsg({
          type: "error",
          text: `Invalid address "${addr}": must be a valid 42-character 0x Ethereum address.`,
        });
      }
    }

    const rawBalances = snapshotBalancesInput
      .split(",")
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    if (accounts.length !== rawBalances.length) {
      return setStatusMsg({
        type: "error",
        text: `Array length mismatch: ${accounts.length} address(es) provided, but ${rawBalances.length} balance(s) provided. Counts must match exactly.`,
      });
    }

    const parsedBalances = [];
    for (let i = 0; i < rawBalances.length; i++) {
      const b = rawBalances[i];
      const num = parseFloat(b);
      if (isNaN(num) || num <= 0) {
        return setStatusMsg({
          type: "error",
          text: `Invalid balance value "${b}": each balance must be a positive number of bonds.`,
        });
      }
      parsedBalances.push(ethers.parseUnits(b, 18));
    }

    try {
      const distributor = getContract("CouponDistributor", signer, network);
      setStatusMsg({ type: "info", text: `Recording balances for Period #${period}...` });
      const tx = await distributor.recordSnapshot(period, accounts, parsedBalances);
      await tx.wait();

      setStatusMsg({
        type: "success",
        text: `Snapshot for Period #${period} recorded successfully for ${accounts.length} accounts!`,
        hash: tx.hash,
      });
      setSnapshotAddressesInput("");
      setSnapshotBalancesInput("");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Snapshot recording failed: ${err.reason || err.message}` });
    }
  };

  const ratioPercent = (reserveRatioBps / 100).toFixed(1);
  const isHealthy = reserveRatioBps >= 10000;
  const progressFill = Math.min(Math.max((reserveRatioBps / 10000) * 100, 0), 100);
  const hasAnyRole = userRoles.isAdmin || userRoles.isCompliance || userRoles.isIssuer;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Header with Access Role Chip Strip */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span className="badge badge-blue">GOVERNANCE & SAFETY</span>
              <span className="badge badge-emerald">AccessControl Enabled</span>
              {userRoles.isAdmin && <span className="badge badge-amber">Admin / Pauser</span>}
              {userRoles.isCompliance && <span className="badge badge-emerald">Compliance Whitelister</span>}
              {userRoles.isIssuer && <span className="badge badge-blue">Bond Issuer</span>}
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Issuer & Compliance Console
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Administrative operations for circuit breakers, KYC registry management, PoR simulation, and segregated liquidity pools.
            </p>
          </div>

          <button onClick={loadAdminData} className="btn-icon" title="Refresh console data">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Role Warning Banner if wallet lacks administrative privileges */}
        {!hasAnyRole && account && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.75rem 1rem",
              borderRadius: "var(--radius-md)",
              backgroundColor: "rgba(245, 158, 11, 0.12)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              color: "#fde68a",
              fontSize: "0.8rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <Lock size={15} color="#f59e0b" />
            <span>
              <strong>Read-Only Mode:</strong> Connected wallet (<code>{account.slice(0, 6)}...{account.slice(-4)}</code>) does not hold administrative roles. Switch MetaMask to the deployer account to execute state modifications.
            </span>
          </div>
        )}
      </div>

      {/* Notifications */}
      {statusMsg && (
        <div className={`alert-banner ${statusMsg.type}`}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span>{statusMsg.text}</span>
            {statusMsg.hash && network === "sepolia" && (
              <a
                href={`https://sepolia.etherscan.io/tx/${statusMsg.hash}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#60a5fa", textDecoration: "underline", marginLeft: "0.5rem", display: "inline-flex", alignItems: "center", gap: "3px" }}
              >
                <span>Etherscan</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>
          <button
            onClick={() => setStatusMsg(null)}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "1rem" }}
          >
            ✕
          </button>
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

      {/* 4 Admin Modules Grid */}
      <div className="grid-2">
        {/* Module 1: Circuit Breaker Pause (PAUSER_ROLE / ADMIN) */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <h3 className="card-title">
                <AlertOctagon size={18} color="#f59e0b" />
                Emergency Circuit Breaker
              </h3>
              {!userRoles.isAdmin && (
                <span className="badge" style={{ backgroundColor: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                  <Lock size={10} style={{ marginRight: 4 }} /> Admin Required
                </span>
              )}
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1.25rem" }}>
              Instantly freezes or resumes all token transfers, secondary trading, and escrow operations in the event of regulatory audits or security incidents. Compliance force transfers remain operational.
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
            disabled={!userRoles.isAdmin}
            className={`btn ${isPaused ? "btn-emerald" : "btn-rose"}`}
            style={{ width: "100%", opacity: userRoles.isAdmin ? 1 : 0.6, cursor: userRoles.isAdmin ? "pointer" : "not-allowed" }}
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
              {!userRoles.isAdmin && (
                <span className="badge" style={{ backgroundColor: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
                  <Lock size={10} style={{ marginRight: 4 }} /> Admin Required
                </span>
              )}
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
                  disabled={!userRoles.isAdmin}
                />
              </div>

              <button
                type="submit"
                disabled={!userRoles.isAdmin}
                className="btn btn-primary"
                style={{ width: "100%", opacity: userRoles.isAdmin ? 1 : 0.6, cursor: userRoles.isAdmin ? "pointer" : "not-allowed" }}
              >
                Update Oracle Value
              </button>
            </form>
          </div>
        </div>

        {/* Module 3: KYC Management & Pending Approvals */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <h3 className="card-title">
                <UserCheck size={18} color="#10b981" />
                KYC Whitelist Management
              </h3>
              {!userRoles.isCompliance && (
                <span className="badge" style={{ backgroundColor: "rgba(16,185,129,0.15)", color: "#10b981" }}>
                  <Lock size={10} style={{ marginRight: 4 }} /> Compliance Required
                </span>
              )}
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
              COMPLIANCE_ROLE directly approves pending investor verifications or manages whitelist status.
            </p>

            {/* Sub-tabs: Pending Requests vs Manual Input */}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
              <button
                type="button"
                className={`btn btn-sm ${kycSubTab === "pending" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setKycSubTab("pending")}
              >
                <span>Pending Requests ({pendingKycList.length})</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${kycSubTab === "manual" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setKycSubTab("manual")}
              >
                <span>Manual Whitelist</span>
              </button>
            </div>

            {kycSubTab === "pending" ? (
              <div style={{ maxHeight: "200px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {loadingPendingKyc ? (
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Checking KYC queue...</p>
                ) : pendingKycList.length === 0 ? (
                  <div style={{ padding: "1.25rem", textAlign: "center", backgroundColor: "var(--bg-input)", borderRadius: "var(--radius-md)", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                    No pending KYC verification requests. Use the "Request KYC" button on the Investor Dashboard to submit one.
                  </div>
                ) : (
                  pendingKycList.map((item) => (
                    <div
                      key={item.wallet}
                      style={{
                        padding: "0.65rem 0.85rem",
                        borderRadius: "var(--radius-md)",
                        backgroundColor: "var(--bg-input)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>{item.name}</div>
                        <div className="font-mono" style={{ fontSize: "0.7rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {item.wallet}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <button
                          onClick={() => handleKycAction("add", item.wallet)}
                          disabled={!userRoles.isCompliance}
                          className="btn btn-emerald btn-sm"
                          style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectPendingKyc(item.wallet)}
                          className="btn btn-rose btn-sm"
                          style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div>
                <div className="input-group">
                  <label className="input-label">Investor Wallet Address</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={kycTarget}
                    onChange={(e) => setKycTarget(e.target.value)}
                    className="input-field font-mono"
                    disabled={!userRoles.isCompliance}
                  />
                </div>
                <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                  <button
                    onClick={() => handleKycAction("add")}
                    disabled={!userRoles.isCompliance}
                    className="btn btn-emerald"
                    style={{ flex: 1, opacity: userRoles.isCompliance ? 1 : 0.6 }}
                  >
                    <UserCheck size={14} />
                    <span>Whitelist</span>
                  </button>
                  <button
                    onClick={() => handleKycAction("remove")}
                    disabled={!userRoles.isCompliance}
                    className="btn btn-rose"
                    style={{ flex: 1, opacity: userRoles.isCompliance ? 1 : 0.6 }}
                  >
                    <UserX size={14} />
                    <span>Revoke</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Module 4: Segregated Liquidity Pools & Corporate Actions */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <h3 className="card-title">
                <Sliders size={18} color="#a855f7" />
                Liquidity Pools & Corporate Actions
              </h3>
              {!userRoles.isIssuer && !userRoles.isAdmin && (
                <span className="badge" style={{ backgroundColor: "rgba(168,85,247,0.15)", color: "#c084fc" }}>
                  <Lock size={10} style={{ marginRight: 4 }} /> Issuer Required
                </span>
              )}
            </div>

            {/* Segregated Pool Balances Banner */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.5rem",
                padding: "0.75rem",
                backgroundColor: "var(--bg-input)",
                borderRadius: "var(--radius-md)",
                marginBottom: "1rem",
              }}
            >
              <div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Coupon Pool</span>
                <div className="font-mono" style={{ fontWeight: 700, fontSize: "1rem", color: "#60a5fa" }}>
                  ${Number(couponPool).toLocaleString()} USDC
                </div>
              </div>
              <div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Redemption Pool</span>
                <div className="font-mono" style={{ fontWeight: 700, fontSize: "1rem", color: "var(--accent-emerald)" }}>
                  ${Number(redemptionPool).toLocaleString()} USDC
                </div>
              </div>
            </div>

            {/* Sub-tabs for Corporate Actions */}
            <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.75rem" }}>
              <button
                type="button"
                className={`btn btn-sm ${activePoolTab === "deposit" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActivePoolTab("deposit")}
              >
                Deposit Pool
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activePoolTab === "withdraw" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActivePoolTab("withdraw")}
              >
                Withdraw
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activePoolTab === "snapshot" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActivePoolTab("snapshot")}
              >
                Snapshot
              </button>
            </div>

            {/* Tab 1: Deposit */}
            {activePoolTab === "deposit" && (
              <form onSubmit={handleDepositLiquidity}>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="poolType"
                      checked={depositType === "coupon"}
                      onChange={() => setDepositType("coupon")}
                    />
                    Coupon Pool
                  </label>
                  <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="poolType"
                      checked={depositType === "redemption"}
                      onChange={() => setDepositType("redemption")}
                    />
                    Redemption Pool
                  </label>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="number"
                    placeholder="USDC Amount (e.g. 10000)"
                    value={depositAmountInput}
                    onChange={(e) => setDepositAmountInput(e.target.value)}
                    className="input-field"
                    style={{ flex: 1 }}
                    disabled={!userRoles.isIssuer}
                  />
                  <button
                    type="submit"
                    disabled={!userRoles.isIssuer}
                    className="btn btn-primary btn-sm"
                    style={{ opacity: userRoles.isIssuer ? 1 : 0.6 }}
                  >
                    Fund Pool
                  </button>
                </div>
              </form>
            )}

            {/* Tab 2: Withdraw Excess Liquidity */}
            {activePoolTab === "withdraw" && (
              <form onSubmit={handleWithdrawFunds}>
                <div className="input-group" style={{ marginBottom: "0.5rem" }}>
                  <input
                    type="number"
                    placeholder="USDC Amount to Withdraw"
                    value={withdrawAmountInput}
                    onChange={(e) => setWithdrawAmountInput(e.target.value)}
                    className="input-field"
                    disabled={!userRoles.isAdmin}
                  />
                </div>
                <div className="input-group" style={{ marginBottom: "0.5rem" }}>
                  <input
                    type="text"
                    placeholder={`Recipient (leave blank for ${account ? `${account.slice(0, 6)}...` : "caller"})`}
                    value={withdrawRecipientInput}
                    onChange={(e) => setWithdrawRecipientInput(e.target.value)}
                    className="input-field font-mono"
                    style={{ fontSize: "0.75rem" }}
                    disabled={!userRoles.isAdmin}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!userRoles.isAdmin}
                  className="btn btn-secondary btn-sm"
                  style={{ width: "100%", opacity: userRoles.isAdmin ? 1 : 0.6 }}
                >
                  <ArrowDownCircle size={14} />
                  <span>Withdraw Excess Funds</span>
                </button>
              </form>
            )}

            {/* Tab 3: Record Snapshot */}
            {activePoolTab === "snapshot" && (
              <form onSubmit={handleRecordSnapshot}>
                <div className="input-group" style={{ marginBottom: "0.35rem" }}>
                  <input
                    type="number"
                    placeholder="Period ID (e.g. 1, 2, 3)"
                    value={snapshotPeriodInput}
                    onChange={(e) => setSnapshotPeriodInput(e.target.value)}
                    className="input-field"
                    disabled={!userRoles.isIssuer}
                  />
                </div>
                <div className="input-group" style={{ marginBottom: "0.35rem" }}>
                  <input
                    type="text"
                    placeholder="Addresses: 0x123..., 0x456..."
                    value={snapshotAddressesInput}
                    onChange={(e) => setSnapshotAddressesInput(e.target.value)}
                    className="input-field font-mono"
                    style={{ fontSize: "0.75rem" }}
                    disabled={!userRoles.isIssuer}
                  />
                </div>
                <div className="input-group" style={{ marginBottom: "0.5rem" }}>
                  <input
                    type="text"
                    placeholder="Balances: 500, 100..."
                    value={snapshotBalancesInput}
                    onChange={(e) => setSnapshotBalancesInput(e.target.value)}
                    className="input-field font-mono"
                    style={{ fontSize: "0.75rem" }}
                    disabled={!userRoles.isIssuer}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!userRoles.isIssuer}
                  className="btn btn-secondary btn-sm"
                  style={{ width: "100%", opacity: userRoles.isIssuer ? 1 : 0.6 }}
                >
                  Record Snapshot
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

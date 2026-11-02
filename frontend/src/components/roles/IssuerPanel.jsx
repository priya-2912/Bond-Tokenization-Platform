import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  getContract,
  getAddresses,
  fetchHolders,
  fetchOrders,
  BOND_DECIMALS,
  USDC_DECIMALS,
  hasFn,
} from "../../contracts/platform";
import {
  toUnits,
  fromUnits,
  fmtNumber,
  shortAddr,
  parseSnapshotLines,
  chunk,
  friendlyError,
} from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../Toast";
import { Modal } from "../ui";
import {
  Layers,
  Sparkles,
  Wallet,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Shield,
  Clock,
  ArrowRight,
  TrendingUp,
  FileCheck,
  UserCheck,
  Lock,
} from "lucide-react";

const MAX_LOTS = 20;

export default function IssuerPanel({ initialSubTab = "designer" }) {
  const { account, signer, readProvider, network, roles, refreshTrigger, setRefreshTrigger } = useAuth();
  const toast = useToast();

  // Top Level Issuer Sub-tabs: "designer" | "supply" | "pools" | "snapshots"
  const [activeSubTab, setActiveSubTab] = useState(initialSubTab);

  useEffect(() => {
    if (initialSubTab) setActiveSubTab(initialSubTab);
  }, [initialSubTab]);

  // Multi-step Asset Designer State (Image 3 - SettleMint style)
  const [step, setStep] = useState(1);
  const [assetType, setAssetType] = useState("corporate"); // corporate | sovereign | green
  const [bondName, setBondName] = useState("US Treasury 10Y Benchmark");
  const [bondSymbol, setBondSymbol] = useState("AURA-BOND");
  const [lotSize, setLotSize] = useState("10");
  const [numLots, setNumLots] = useState("2");
  const [pricePerBond, setPricePerBond] = useState("1000");
  const [couponRate, setCouponRate] = useState("5.25");
  const [maturityMonths, setMaturityMonths] = useState("12");

  // Chain state
  const [totalSupply, setTotalSupply] = useState(0n);
  const [issuerBondBal, setIssuerBondBal] = useState(0n);
  const [issuerUsdcBal, setIssuerUsdcBal] = useState(0n);
  const [requiredReserves, setRequiredReserves] = useState(0n);
  const [reportedReserves, setReportedReserves] = useState(0n);
  const [reserveRatio, setReserveRatio] = useState(0n);
  const [guardAlert, setGuardAlert] = useState(false);
  const [activeOrders, setActiveOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  // Pools state
  const [pools, setPools] = useState({
    split: false,
    coupon: 0n,
    redemption: 0n,
    total: 0n,
    needPrincipal: 0n,
  });
  const [depositKind, setDepositKind] = useState("coupon");
  const [depositAmount, setDepositAmount] = useState("");

  // Snapshot tool state
  const [period, setPeriod] = useState("1");
  const [snapText, setSnapText] = useState("");
  const [loadingHolders, setLoadingHolders] = useState(false);

  // Action status modal
  const [actionBusy, setActionBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");

  const addrs = getAddresses(network);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const bond = getContract("BondToken", readProvider, network);
      const guard = getContract("ReserveGuard", readProvider, network);
      const dist = getContract("CouponDistributor", readProvider, network);
      const usdc = getContract("MockUSDC", readProvider, network);

      const split = hasFn(dist, "couponPool") && hasFn(dist, "redemptionPool");

      const [
        supply,
        bBal,
        uBal,
        ratio,
        req,
        res,
        alert,
        distTotalUsdc,
        cPool,
        rPool,
        orders,
      ] = await Promise.all([
        bond.totalSupply().catch(() => 0n),
        account ? bond.balanceOf(account).catch(() => 0n) : 0n,
        account ? usdc.balanceOf(account).catch(() => 0n) : 0n,
        guard.reserveRatioBps().catch(() => 0n),
        guard.requiredReserves().catch(() => 0n),
        guard.reserves().catch(() => ({ amount: 0n, updatedAt: 0n })),
        guard.alertActive().catch(() => false),
        usdc.balanceOf(addrs.CouponDistributor).catch(() => 0n),
        split ? dist.couponPool().catch(() => 0n) : 0n,
        split ? dist.redemptionPool().catch(() => 0n) : 0n,
        fetchOrders(readProvider, network).catch(() => []),
      ]);

      setTotalSupply(supply);
      setIssuerBondBal(bBal);
      setIssuerUsdcBal(uBal);
      setReserveRatio(ratio);
      setRequiredReserves(req);
      setReportedReserves(res.amount);
      setGuardAlert(alert);
      setPools({
        split,
        coupon: cPool,
        redemption: rPool,
        total: distTotalUsdc,
        needPrincipal: req,
      });
      setActiveOrders(orders);
    } catch (err) {
      console.warn("Issuer data fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [account, readProvider, network]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  // Execute Offering Deployment (Create Sell Order Lots on Marketplace)
  const handleDeployOffering = async () => {
    if (!signer) {
      toast.warn("Connect your wallet on Sepolia to execute issuance.");
      return;
    }
    if (!roles.issuer) {
      toast.error("Only a wallet with the ISSUER role can list primary offerings.");
      return;
    }

    let sizeBig, priceBig, n;
    try {
      sizeBig = toUnits(lotSize, BOND_DECIMALS);
      priceBig = toUnits(pricePerBond, USDC_DECIMALS);
      n = Number(numLots);
      if (sizeBig === 0n || priceBig === 0n) throw new Error("Lot size and price must be greater than zero.");
      if (!Number.isInteger(n) || n < 1 || n > MAX_LOTS) {
        throw new Error(`Number of lots must be between 1 and ${MAX_LOTS}.`);
      }
    } catch (err) {
      toast.error(err.message);
      return;
    }

    const totalBondsRequired = sizeBig * BigInt(n);
    const lotPriceUsdc = (priceBig * sizeBig) / 10n ** BigInt(BOND_DECIMALS);

    setActionBusy(true);
    setBusyMessage("Validating issuer pre-flight prerequisites...");

    try {
      const bond = getContract("BondToken", signer, network);
      const market = getContract("Marketplace", signer, network);
      const kyc = getContract("KYCRegistry", signer, network);

      const isMarketWhitelisted = await kyc.isVerified(addrs.Marketplace);
      if (!isMarketWhitelisted) {
        throw new Error("Marketplace contract is not KYC-whitelisted. Super Admin must whitelist Marketplace first.");
      }

      const currentBalance = await bond.balanceOf(account);
      if (currentBalance < totalBondsRequired) {
        throw new Error(
          `Insufficient BondTokens. You have ${fromUnits(currentBalance, BOND_DECIMALS)} AURA-BOND, but listing requires ${fromUnits(totalBondsRequired, BOND_DECIMALS)}.`
        );
      }

      // Check allowance
      const currentAllowance = await bond.allowance(account, addrs.Marketplace);
      if (currentAllowance < totalBondsRequired) {
        setBusyMessage("Step 1/2: Approving Marketplace contract to escrow offering lots (confirm in wallet)...");
        const approveTx = await bond.approve(addrs.Marketplace, totalBondsRequired);
        await approveTx.wait();
        toast.info("Escrow approval confirmed!");
      }

      // Create sell order lots
      for (let i = 0; i < n; i++) {
        setBusyMessage(`Step 2/2: Creating offering lot ${i + 1} of ${n} on-chain (confirm in wallet)...`);
        const orderTx = await market.createSellOrder(sizeBig, lotPriceUsdc);
        await orderTx.wait();
      }

      toast.success(`Successfully issued ${n} lot(s) of ${lotSize} bonds on the Marketplace!`);
      setRefreshTrigger((n) => n + 1);
      setStep(1);
      setActiveSubTab("supply");
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err));
    } finally {
      setActionBusy(false);
      setBusyMessage("");
    }
  };

  // Execute Deposit to Pools (Coupon or Redemption)
  const handleDepositFunds = async (e) => {
    e?.preventDefault();
    if (!signer) {
      toast.warn("Connect your wallet on Sepolia.");
      return;
    }

    let rawAmount;
    try {
      rawAmount = toUnits(depositAmount, USDC_DECIMALS);
      if (rawAmount === 0n) throw new Error("Deposit amount must be greater than zero.");
    } catch (err) {
      toast.error(err.message);
      return;
    }

    setActionBusy(true);
    setBusyMessage("Step 1/2: Approving MockUSDC for CouponDistributor...");

    try {
      const usdc = getContract("MockUSDC", signer, network);
      const dist = getContract("CouponDistributor", signer, network);

      const bal = await usdc.balanceOf(account);
      if (bal < rawAmount) {
        throw new Error("Insufficient MockUSDC balance. Use faucet on Portfolio to claim test MockUSDC.");
      }

      const allowance = await usdc.allowance(account, addrs.CouponDistributor);
      if (allowance < rawAmount) {
        const appTx = await usdc.approve(addrs.CouponDistributor, rawAmount);
        await appTx.wait();
      }

      setBusyMessage(`Step 2/2: Depositing $${fmtNumber(depositAmount)} into ${pools.split ? `${depositKind} pool` : "distribution pool"}...`);
      let depTx;
      if (pools.split) {
        depTx = depositKind === "coupon"
          ? await dist.depositCouponFunds(rawAmount)
          : await dist.depositRedemptionFunds(rawAmount);
      } else {
        depTx = await dist.depositFunds(rawAmount);
      }
      await depTx.wait();

      toast.success(`$${fmtNumber(depositAmount)} deposited into distribution pool on Sepolia!`);
      setDepositAmount("");
      setRefreshTrigger((n) => n + 1);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setActionBusy(false);
      setBusyMessage("");
    }
  };

  // Load Holders for Coupon Distribution Snapshot
  const handleLoadHolders = async () => {
    setLoadingHolders(true);
    try {
      const bond = getContract("BondToken", readProvider, network);
      const marketplace = getContract("Marketplace", readProvider, network);
      const [holdersResult, ordersResult] = await Promise.all([
        fetchHolders(bond, readProvider, network).catch(() => []),
        fetchOrders(marketplace).catch(() => ({ orders: [] })),
      ]);

      const holders = Array.isArray(holdersResult) ? holdersResult : [];
      const orders = ordersResult?.orders || (Array.isArray(ordersResult) ? ordersResult : []);

      const map = new Map();
      holders.forEach((h) => {
        if (h.balance > 0n && (!addrs.Marketplace || h.address.toLowerCase() !== addrs.Marketplace.toLowerCase())) {
          map.set(h.address.toLowerCase(), (map.get(h.address.toLowerCase()) || 0n) + h.balance);
        }
      });

      // Credit escrowed bonds in active marketplace sell orders back to sellers
      orders.forEach((o) => {
        const amt = o.bondAmount || o.amount || 0n;
        const active = Boolean(o.isActive ?? o.active);
        if (active && amt > 0n && o.seller) {
          map.set(o.seller.toLowerCase(), (map.get(o.seller.toLowerCase()) || 0n) + amt);
        }
      });

      const lines = [];
      for (const [addr, bal] of map.entries()) {
        lines.push(`${ethers.getAddress(addr)}, ${fromUnits(bal, BOND_DECIMALS)}`);
      }

      setSnapText(lines.join("\n"));
      toast.info(`Discovered ${lines.length} eligible bond token holders for Period ${period}.`);
    } catch (err) {
      toast.error(`Failed to scan token holders: ${err.message}`);
    } finally {
      setLoadingHolders(false);
    }
  };

  // Submit Snapshot to CouponDistributor
  const handleSubmitSnapshot = async () => {
    if (!signer) return toast.warn("Connect your wallet on Sepolia.");
    if (!roles.distributorIssuer && !roles.issuer) {
      return toast.error("Only ISSUER role can record coupon distribution snapshots.");
    }

    let parsed;
    try {
      parsed = parseSnapshotLines(snapText, BOND_DECIMALS);
      if (parsed.length === 0) throw new Error("No valid accounts provided in snapshot list.");
    } catch (err) {
      toast.error(err.message);
      return;
    }

    const periodNum = Number(period);
    if (!Number.isInteger(periodNum) || periodNum < 1) {
      toast.error("Period must be a positive integer.");
      return;
    }

    setActionBusy(true);
    try {
      const dist = getContract("CouponDistributor", signer, network);
      const batches = chunk(parsed, 100);

      for (let i = 0; i < batches.length; i++) {
        setBusyMessage(`Recording snapshot batch ${i + 1} of ${batches.length} on Sepolia...`);
        const addrsChunk = batches[i].map((x) => x.account);
        const balsChunk = batches[i].map((x) => x.balance);
        const tx = await dist.recordSnapshot(periodNum, addrsChunk, balsChunk);
        await tx.wait();
      }

      toast.success(`Coupon snapshot recorded for Period ${periodNum} across ${parsed.length} accounts!`);
      setRefreshTrigger((n) => n + 1);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setActionBusy(false);
      setBusyMessage("");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Top Bar with Role Info & Permissions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          background: "linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(217, 119, 6, 0.02) 100%)",
          border: "1px solid rgba(245, 158, 11, 0.25)",
          borderRadius: "var(--radius-lg)",
          padding: "1rem 1.25rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              boxShadow: "0 4px 12px rgba(245, 158, 11, 0.4)",
            }}
          >
            <Layers size={20} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.05rem", fontWeight: 800, color: "#fff" }}>
                Issuer & Primary Tranche Portal
              </span>
              <span className="badge badge-amber">ACTIVE ROLE</span>
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "0.15rem" }}>
              <b>Permissions:</b> Create offerings, fund coupons and manage issuance
            </div>
          </div>
        </div>

        {/* Sub-tab Navigation */}
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button
            className={`btn btn-sm ${activeSubTab === "designer" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveSubTab("designer")}
          >
            <Sparkles size={13} />
            <span>Asset Designer</span>
          </button>
          <button
            className={`btn btn-sm ${activeSubTab === "supply" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveSubTab("supply")}
          >
            <TrendingUp size={13} />
            <span>Supply & Offerings</span>
          </button>
          <button
            className={`btn btn-sm ${activeSubTab === "pools" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveSubTab("pools")}
          >
            <Wallet size={13} />
            <span>Financial Pools</span>
          </button>
          <button
            className={`btn btn-sm ${activeSubTab === "snapshots" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveSubTab("snapshots")}
          >
            <Sliders size={13} />
            <span>Coupon Distribution</span>
          </button>
        </div>
      </div>

      {/* ========================================================
          IMAGE 3: SETTLEMINT ASSET DESIGNER (MULTI-STEP WORKFLOW)
          ======================================================== */}
      {activeSubTab === "designer" && (
        <div
          className="card"
          style={{
            padding: 0,
            overflow: "hidden",
            display: "flex",
            minHeight: "560px",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            background: "#0c1322",
          }}
        >
          {/* SettleMint Gradient Stepper Sidebar (Image 3) */}
          <div className="stepper-sidebar">
            <div style={{ marginBottom: "2rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <div style={{ width: 22, height: 22, background: "rgba(255,255,255,0.2)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 800 }}>
                  A
                </div>
                <span style={{ fontSize: "0.9rem", fontWeight: 900, letterSpacing: "-0.01em" }}>SettleMint DALP</span>
              </div>
              <h3 style={{ fontSize: "1.35rem", fontWeight: 900, lineHeight: 1.2 }}>
                Design your asset
              </h3>
              <p style={{ fontSize: "0.75rem", opacity: 0.85, marginTop: "0.5rem", lineHeight: 1.4 }}>
                We'll guide you through each step to create your tokenized asset with built-in regulatory compliance and investor protection.
              </p>
              <div style={{ fontSize: "0.68rem", opacity: 0.7, marginTop: "0.75rem", fontWeight: 700, textTransform: "uppercase" }}>
                Step {step} of 5
              </div>
              <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.2)", borderRadius: 2, marginTop: 4 }}>
                <div style={{ width: `${(step / 5) * 100}%`, height: "100%", background: "#fff", borderRadius: 2 }} />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {[
                { id: 1, label: "Choose asset type" },
                { id: 2, label: "Configure details" },
                { id: 3, label: "Compliance modules" },
                { id: 4, label: "Initial permissions" },
                { id: 5, label: "Review & deploy" },
              ].map((s) => (
                <div
                  key={s.id}
                  className={`stepper-item ${step === s.id ? "active" : ""}`}
                  onClick={() => setStep(s.id)}
                  style={{ cursor: "pointer" }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: step > s.id ? "#10b981" : step === s.id ? "#fff" : "rgba(255,255,255,0.2)",
                      color: step === s.id ? "#0284c7" : "#fff",
                      fontSize: "0.7rem",
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {step > s.id ? "✓" : s.id}
                  </div>
                  <span>{s.label}</span>
                  {step > s.id && <span style={{ marginLeft: "auto", fontSize: "0.7rem", opacity: 0.8 }}>✓</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Stepper Content Area */}
          <div style={{ flex: 1, padding: "2rem", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            {/* STEP 1: CHOOSE ASSET TYPE */}
            {step === 1 && (
              <div>
                <span className="badge badge-blue">STEP 1 / 5</span>
                <h3 style={{ fontSize: "1.35rem", fontWeight: 800, marginTop: "0.35rem", color: "#fff" }}>
                  Select Asset Class & Debt Structure
                </h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginTop: "0.25rem", marginBottom: "1.5rem" }}>
                  Choose the regulatory and collateral structure for your institutional tokenized bond offering.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
                  {[
                    { id: "corporate", title: "Corporate Debt Bond", desc: "Institutional commercial paper and investment grade bonds backed by off-chain reserves.", badge: "Institutional" },
                    { id: "sovereign", title: "Sovereign Treasury", desc: "Short to medium term sovereign treasury bills with automated coupon distribution.", badge: "Benchmark" },
                    { id: "green", title: "ESG / Green Bond", desc: "Directly linked to verifiable green projects with telemetry and transparent proof-of-reserves.", badge: "ESG" },
                  ].map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setAssetType(item.id)}
                      style={{
                        padding: "1.25rem",
                        borderRadius: "var(--radius-lg)",
                        border: assetType === item.id ? "2px solid #38bdf8" : "1px solid var(--border-subtle)",
                        background: assetType === item.id ? "rgba(56, 189, 248, 0.08)" : "var(--bg-input)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span className="badge badge-blue" style={{ fontSize: "0.68rem" }}>{item.badge}</span>
                      <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#fff", marginTop: "0.5rem" }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.35rem", lineHeight: 1.4 }}>
                        {item.desc}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 2: CONFIGURE DETAILS */}
            {step === 2 && (
              <div>
                <span className="badge badge-blue">STEP 2 / 5</span>
                <h3 style={{ fontSize: "1.35rem", fontWeight: 800, marginTop: "0.35rem", color: "#fff" }}>
                  Configure Bond Tranche & Yield Terms
                </h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginTop: "0.25rem", marginBottom: "1.5rem" }}>
                  Define face value, coupon yield, and lot sizing for the primary marketplace listing.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                      Offering Name
                    </label>
                    <input
                      type="text"
                      className="search-input"
                      value={bondName}
                      onChange={(e) => setBondName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                      Asset Symbol
                    </label>
                    <input
                      type="text"
                      className="search-input font-mono"
                      value={bondSymbol}
                      onChange={(e) => setBondSymbol(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                      Bonds per Lot (Token Quantity)
                    </label>
                    <input
                      type="number"
                      className="search-input font-mono"
                      value={lotSize}
                      onChange={(e) => setLotSize(e.target.value)}
                      placeholder="e.g. 10"
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                      Number of Lots to Issue (Max {MAX_LOTS})
                    </label>
                    <input
                      type="number"
                      className="search-input font-mono"
                      value={numLots}
                      onChange={(e) => setNumLots(e.target.value)}
                      placeholder="e.g. 2"
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                      Price per Bond (MockUSDC)
                    </label>
                    <input
                      type="number"
                      className="search-input font-mono"
                      value={pricePerBond}
                      onChange={(e) => setPricePerBond(e.target.value)}
                      placeholder="e.g. 1000"
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                      Annual Coupon Yield (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="search-input font-mono"
                      value={couponRate}
                      onChange={(e) => setCouponRate(e.target.value)}
                    />
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "1.25rem",
                    padding: "0.75rem 1rem",
                    background: "rgba(59, 130, 246, 0.08)",
                    border: "1px solid rgba(59, 130, 246, 0.2)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "0.78rem",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>
                    Total Tokens: <b>{Number(lotSize || 0) * Number(numLots || 0)} AURA-BOND</b>
                  </span>
                  <span>
                    Total Tranche Value: <b>${fmtNumber(Number(lotSize || 0) * Number(numLots || 0) * Number(pricePerBond || 0))} MockUSDC</b>
                  </span>
                </div>
              </div>
            )}

            {/* STEP 3: COMPLIANCE MODULES (Image 3 style) */}
            {step === 3 && (
              <div>
                <span className="badge badge-blue">STEP 3 / 5</span>
                <h3 style={{ fontSize: "1.35rem", fontWeight: 800, marginTop: "0.35rem", color: "#fff" }}>
                  Compliance Modules & Protections
                </h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginTop: "0.25rem", marginBottom: "1.5rem" }}>
                  Compliance modules that have been enabled for your bond tranche on Sepolia testnet.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {[
                    { name: "Control name", val: "SMART identity verification", desc: "KYCRegistry enforces whitelist verification before any transfer or purchase" },
                    { name: "Control name", val: "Country allowlist", desc: "Restricts subscriptions to approved jurisdictions according to compliance rules" },
                    { name: "Control name", val: "Token supply limit", desc: "ReserveGuard circuit breaker prevents issuance exceeding attested backing collateral" },
                  ].map((m, idx) => (
                    <div key={idx} className="permission-row">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(59, 130, 246, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "#60a5fa" }}>
                          <CheckCircle2 size={16} />
                        </div>
                        <div>
                          <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#fff" }}>{m.val}</div>
                          <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>{m.desc}</div>
                        </div>
                      </div>
                      <span className="badge badge-emerald">ENABLED</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 4: INITIAL PERMISSIONS & ROLES TABLE (Image 3 style) */}
            {step === 4 && (
              <div>
                <span className="badge badge-blue">STEP 4 / 5</span>
                <h3 style={{ fontSize: "1.35rem", fontWeight: 800, marginTop: "0.35rem", color: "#fff" }}>
                  Initial Permissions Delegation
                </h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginTop: "0.25rem", marginBottom: "1.5rem" }}>
                  Accounts that will have administrative and issuance access to your bond on the blockchain.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  {[
                    { role: "System Admin", wallet: "0xc992ddeb354f51edc472c7fb9d84db200faaf5da", perms: "Permission manager, Governance", dot: "#f59e0b" },
                    { role: "Asset Issuer", wallet: account || "0xc992ddeb354f51edc472c7fb9d84db200faaf5da", perms: "Custodian, Sale admin", dot: "#3b82f6" },
                    { role: "Compliance Officer", wallet: addrs.KYCRegistry, perms: "KYC Whitelist, Sanctions", dot: "#10b981" },
                    { role: "Coupon Distributor", wallet: addrs.CouponDistributor, perms: "Funds manager, Redemption burn", dot: "#8b5cf6" },
                  ].map((p, i) => (
                    <div key={i} className="permission-row">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.dot }} />
                        <span style={{ fontSize: "0.825rem", fontWeight: 700, color: "#fff" }}>{p.role}</span>
                        <span className="font-mono" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {shortAddr(p.wallet)}
                        </span>
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                        {p.perms}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 5: REVIEW & DEPLOY OFFERING */}
            {step === 5 && (
              <div>
                <span className="badge badge-emerald">STEP 5 / 5 - SUMMARY</span>
                <h3 style={{ fontSize: "1.35rem", fontWeight: 800, marginTop: "0.35rem", color: "#fff" }}>
                  Review & Deploy Compliant Digital Bond
                </h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginTop: "0.25rem", marginBottom: "1.5rem" }}>
                  Confirm offering configuration and execute on-chain lot registration on the Marketplace contract.
                </p>

                <div
                  style={{
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-lg)",
                    padding: "1.25rem",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "1rem",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Tranche Offering</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fff", marginTop: 2 }}>{bondName}</div>
                    <div className="font-mono" style={{ fontSize: "0.75rem", color: "#60a5fa" }}>{bondSymbol}</div>
                  </div>

                  <div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Target Yield</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#10b981", marginTop: 2 }}>{couponRate}% APY</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Fixed Annual Coupon</div>
                  </div>

                  <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "0.75rem" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Lots to List</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff" }}>
                      {numLots} Lots × {lotSize} Bonds ({Number(numLots) * Number(lotSize)} Tokens)
                    </div>
                  </div>

                  <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "0.75rem" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Price per Bond</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#fff" }}>
                      ${fmtNumber(pricePerBond)} MockUSDC
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Issuer Wallet Bond Balance: <b>{fromUnits(issuerBondBal, BOND_DECIMALS)} AURA-BOND</b>
                  </div>
                  {issuerBondBal < toUnits(lotSize || 0, BOND_DECIMALS) * BigInt(numLots || 1) && (
                    <div className="alert-banner warn" style={{ marginTop: "0.5rem" }}>
                      <AlertTriangle size={16} />
                      <span style={{ fontSize: "0.78rem" }}>
                        Warning: You do not currently hold enough BondTokens to fulfill all lots. Make sure your account holds tokens before confirming.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Stepper Navigation Buttons */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-subtle)", paddingTop: "1.25rem", marginTop: "1.5rem" }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={step === 1 || actionBusy}
              >
                Back
              </button>

              {step < 5 ? (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setStep((s) => Math.min(5, s + 1))}
                >
                  <span>Continue</span>
                  <ArrowRight size={14} />
                </button>
              ) : (
                <button
                  className="btn btn-emerald btn-sm"
                  onClick={handleDeployOffering}
                  disabled={actionBusy}
                  style={{ gap: "0.5rem", padding: "0.55rem 1.25rem" }}
                >
                  <Sparkles size={14} />
                  <span>Execute Primary Issuance</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          SUB-TAB: SUPPLY & ACTIVE OFFERINGS
          ======================================================== */}
      {activeSubTab === "supply" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
            <div className="card">
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Total Token Supply</div>
              <div className="font-mono" style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff", marginTop: 4 }}>
                {fmtNumber(fromUnits(totalSupply, BOND_DECIMALS))}
              </div>
              <div style={{ fontSize: "0.72rem", color: "#60a5fa", marginTop: 2 }}>AURA-BOND</div>
            </div>

            <div className="card">
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Required Principal</div>
              <div className="font-mono" style={{ fontSize: "1.5rem", fontWeight: 800, color: "#fff", marginTop: 4 }}>
                ${fmtNumber(fromUnits(requiredReserves, USDC_DECIMALS))}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>MockUSDC collateral</div>
            </div>

            <div className="card">
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Attested Reserves</div>
              <div className="font-mono" style={{ fontSize: "1.5rem", fontWeight: 800, color: "#10b981", marginTop: 4 }}>
                ${fmtNumber(fromUnits(reportedReserves, USDC_DECIMALS))}
              </div>
              <div style={{ fontSize: "0.72rem", color: "#10b981", marginTop: 2 }}>ReserveOracle Feed</div>
            </div>

            <div className="card">
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Reserve Ratio</div>
              <div className="font-mono" style={{ fontSize: "1.5rem", fontWeight: 800, color: Number(reserveRatio) >= 10000 ? "#10b981" : "#f59e0b", marginTop: 4 }}>
                {(Number(reserveRatio) / 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>Overcollateralized</div>
            </div>
          </div>

          {/* Active Marketplace Primary Lots */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fff" }}>
                  Active Marketplace Offerings
                </h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
                  Currently open lots in the Marketplace escrow contract available for verified investors
                </p>
              </div>
              <span className="badge badge-blue">
                {activeOrders.filter((o) => o.active).length} Active Lots
              </span>
            </div>

            {activeOrders.filter((o) => o.active).length === 0 ? (
              <div style={{ textAlign: "center", padding: "2.5rem", color: "var(--text-muted)" }}>
                <div>No active offering lots listed on Marketplace.</div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setActiveSubTab("designer")}
                  style={{ marginTop: "0.75rem" }}
                >
                  Launch Offering with Asset Designer
                </button>
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Seller / Issuer</th>
                      <th>Token Quantity</th>
                      <th>Lot Price (MockUSDC)</th>
                      <th>Price per Token</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeOrders.filter((o) => o.active).map((o) => (
                      <tr key={o.id}>
                        <td className="font-mono" style={{ fontWeight: 700, color: "#60a5fa" }}>
                          #{o.id}
                        </td>
                        <td className="font-mono">{shortAddr(o.seller)}</td>
                        <td className="font-mono" style={{ fontWeight: 700 }}>
                          {fromUnits(o.amount, BOND_DECIMALS)} AURA-BOND
                        </td>
                        <td className="font-mono" style={{ fontWeight: 700, color: "#10b981" }}>
                          ${fmtNumber(fromUnits(o.price, USDC_DECIMALS))}
                        </td>
                        <td className="font-mono" style={{ color: "var(--text-muted)" }}>
                          ${fmtNumber((Number(fromUnits(o.price, USDC_DECIMALS)) / Number(fromUnits(o.amount, BOND_DECIMALS))).toFixed(2))}
                        </td>
                        <td>
                          <span className="badge badge-emerald">ACTIVE LISTING</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================
          SUB-TAB: FINANCIAL POOLS & COUPON FUNDING
          ======================================================== */}
      {activeSubTab === "pools" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1.5rem" }}>
          {/* Pools Status */}
          <div className="card">
            <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fff", marginBottom: "0.25rem" }}>
              Coupon & Redemption Reserves
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "1.25rem" }}>
              Funding pools held inside the <span className="font-mono">CouponDistributor</span> contract to guarantee investor payouts.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div
                style={{
                  padding: "1rem",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Coupon Funding Pool</div>
                  <div className="font-mono" style={{ fontSize: "1.4rem", fontWeight: 800, color: "#10b981", marginTop: 2 }}>
                    ${fmtNumber(fromUnits(pools.split ? pools.coupon : pools.total, USDC_DECIMALS))} MockUSDC
                  </div>
                </div>
                <span className="badge badge-emerald">COUPONS</span>
              </div>

              <div
                style={{
                  padding: "1rem",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Principal Redemption Pool</div>
                  <div className="font-mono" style={{ fontSize: "1.4rem", fontWeight: 800, color: "#38bdf8", marginTop: 2 }}>
                    ${fmtNumber(fromUnits(pools.split ? pools.redemption : pools.total, USDC_DECIMALS))} MockUSDC
                  </div>
                </div>
                <span className="badge badge-blue">REDEMPTIONS</span>
              </div>

              <div style={{ padding: "0.85rem", background: "rgba(59, 130, 246, 0.08)", borderRadius: "var(--radius-md)", fontSize: "0.78rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span>Required Principal Coverage:</span>
                  <span className="font-mono" style={{ fontWeight: 700 }}>${fmtNumber(fromUnits(pools.needPrincipal, USDC_DECIMALS))}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Coverage Status:</span>
                  <span style={{ color: (pools.split ? pools.redemption : pools.total) >= pools.needPrincipal ? "#10b981" : "#f59e0b", fontWeight: 700 }}>
                    {(pools.split ? pools.redemption : pools.total) >= pools.needPrincipal ? "✓ Fully Funded" : "⚠️ Partially Funded"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Deposit Form */}
          <div className="card">
            <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fff", marginBottom: "0.25rem" }}>
              Fund Distribution Pool
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: "1.25rem" }}>
              Deposit MockUSDC into the smart contract pool to fund upcoming scheduled coupon payments.
            </p>

            <form onSubmit={handleDepositFunds} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {pools.split && (
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                    Select Target Pool
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${depositKind === "coupon" ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => setDepositKind("coupon")}
                      style={{ flex: 1 }}
                    >
                      Coupon Pool
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${depositKind === "redemption" ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => setDepositKind("redemption")}
                      style={{ flex: 1 }}
                    >
                      Redemption Pool
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                  Deposit Amount (MockUSDC)
                </label>
                <input
                  type="number"
                  step="any"
                  className="search-input font-mono"
                  placeholder="e.g. 5000"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                />
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>
                  Available in your wallet: {fmtNumber(fromUnits(issuerUsdcBal, USDC_DECIMALS))} MockUSDC
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-emerald"
                disabled={actionBusy || !depositAmount || Number(depositAmount) <= 0}
                style={{ marginTop: "0.5rem" }}
              >
                Deposit Funds to Contract
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================
          SUB-TAB: COUPON DISTRIBUTION SNAPSHOTS
          ======================================================== */}
      {activeSubTab === "snapshots" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
            <div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fff" }}>
                Coupon Snapshot & Entitlement Engine
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
                Scan on-chain bondholders and record entitlement snapshots on the <span className="font-mono">CouponDistributor</span>
              </p>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleLoadHolders}
              disabled={loadingHolders}
              style={{ gap: "0.4rem" }}
            >
              <RefreshCw size={13} className={loadingHolders ? "spin" : ""} />
              <span>{loadingHolders ? "Scanning Chain..." : "Scan Eligible Holders"}</span>
            </button>
          </div>

          <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
            <div style={{ width: "160px" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                Coupon Period #
              </label>
              <input
                type="number"
                min="1"
                className="search-input font-mono"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                Holders List (<span className="font-mono">Address, Balance</span>)
              </label>
              <textarea
                className="search-input font-mono"
                rows={6}
                placeholder="Click 'Scan Eligible Holders' or paste format: 0x123..., 100"
                value={snapText}
                onChange={(e) => setSnapText(e.target.value)}
                style={{ width: "100%", fontSize: "0.75rem", resize: "vertical" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSubmitSnapshot}
              disabled={actionBusy || !snapText.trim()}
              style={{ gap: "0.4rem" }}
            >
              <CheckCircle2 size={14} />
              <span>Record Snapshot on Sepolia</span>
            </button>
          </div>
        </div>
      )}

      {/* Action Progress Overlay */}
      {actionBusy && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="card" style={{ maxWidth: 440, width: "90%", textAlign: "center", padding: "2rem" }}>
            <RefreshCw size={36} className="spin" color="#f59e0b" style={{ margin: "0 auto 1rem" }} />
            <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fff" }}>
              Executing Issuer Blockchain Transaction
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              {busyMessage || "Interacting with Sepolia testnet..."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


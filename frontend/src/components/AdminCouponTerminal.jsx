import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import {
  getContract,
  loadTerms,
  fetchHolders,
  hasFn,
  BOND_DECIMALS,
  USDC_DECIMALS,
  txUrl,
} from "../contracts/platform";
import { toUnits, fromUnits, fmtNumber, shortAddr, friendlyError } from "../lib/utils";
import { seedDemoInvestor } from "../lib/backend";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import {
  DollarSign,
  Calendar,
  Users,
  Coins,
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertTriangle,
  Layers,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  FileCheck,
  Gift,
  Sparkles,
} from "lucide-react";
import TestUsdcFaucetModal from "./TestUsdcFaucetModal";

export default function AdminCouponTerminal() {
  const { account, signer, readProvider, network, roles, refreshTrigger, setRefreshTrigger } = useAuth();
  const toast = useToast();

  const [terms, setTerms] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState("1");
  const [activePeriods, setActivePeriods] = useState([1]);
  const [couponPoolBalance, setCouponPoolBalance] = useState(0n);
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [holders, setHolders] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fund Pool Form
  const [fundAmount, setFundAmount] = useState("");
  const [fundingBusy, setFundingBusy] = useState(false);
  const [fundingStep, setFundingStep] = useState("");

  // Snapshot Recording
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotStep, setSnapshotStep] = useState("");
  const [faucetOpen, setFaucetOpen] = useState(false);
  const [seedingBusy, setSeedingBusy] = useState(false);

  const handleSeedDemoInvestor = async (targetAddr = "0xE3a9419109499d6A67507F67D04ce97075f6E78C") => {
    setSeedingBusy(true);
    toast.info(`Provisioning on-chain investments & Period 1 snapshot for ${shortAddr(targetAddr)}...`);
    try {
      const res = await seedDemoInvestor(targetAddr, 25, 1);
      if (res.ok) {
        toast.success(`Successfully provisioned 25 AURA-BOND & Period 1 snapshot for ${shortAddr(targetAddr)}!`);
        setRefreshTrigger((n) => n + 1);
        loadAdminData();
        return;
      }

      // If backend returned 404 (needs restart) and admin signer is connected, execute fallback directly in MetaMask
      if (signer) {
        toast.info("Backend server needs restart — executing provisioning directly with connected admin wallet in MetaMask...");
        const kyc = getContract("KYCRegistry", signer, network);
        const bond = getContract("BondToken", signer, network);
        const usdc = getContract("MockUSDC", signer, network);
        const dist = getContract("CouponDistributor", signer, network);
        const distAddr = await dist.getAddress();

        // 1. Whitelist target investor if needed
        const isVerified = await kyc.isVerified(targetAddr).catch(() => false);
        if (!isVerified) {
          toast.info(`Step 1/3: Confirming KYC Whitelist for ${shortAddr(targetAddr)} in MetaMask...`);
          const tx = await kyc.addToWhitelist(targetAddr);
          await tx.wait();
        }

        // 2. Transfer or mint 25 bonds
        const targetBondWei = ethers.parseUnits("25", 18);
        const currentBal = await bond.balanceOf(targetAddr);
        if (currentBal < targetBondWei) {
          toast.info(`Step 2/3: Transferring 25 AURA-BOND to ${shortAddr(targetAddr)} in MetaMask...`);
          const myBal = await bond.balanceOf(account);
          if (myBal >= (targetBondWei - currentBal)) {
            const tx = await bond.transfer(targetAddr, targetBondWei - currentBal);
            await tx.wait();
          } else {
            const tx = await bond.mint(targetAddr, targetBondWei - currentBal);
            await tx.wait();
          }
        }

        // 3. Record Snapshot for Period 1
        toast.info(`Step 3/3: Committing Period 1 snapshot for ${shortAddr(targetAddr)} in MetaMask...`);
        const finalBondBal = await bond.balanceOf(targetAddr);
        const txSnap = await dist.recordSnapshot(1n, [targetAddr], [finalBondBal]);
        await txSnap.wait();

        toast.success(`Successfully provisioned 25 AURA-BOND & Period 1 snapshot for ${shortAddr(targetAddr)} on Sepolia!`);
        setRefreshTrigger((n) => n + 1);
        loadAdminData();
      } else {
        toast.error("Backend returned 404: Please restart the backend terminal (Ctrl+C then npm start in the backend folder).");
      }
    } catch (err) {
      console.error("Provisioning error:", err);
      toast.error(err.shortMessage || err.message || "Failed to seed demo investments");
    } finally {
      setSeedingBusy(false);
    }
  };

  // Load contract state
  const loadAdminData = useCallback(async () => {
    if (!readProvider) return;
    setLoading(true);
    try {
      const t = await loadTerms(readProvider, network);
      setTerms(t);

      const bond = getContract("BondToken", readProvider, network);
      const usdc = getContract("MockUSDC", readProvider, network);
      const dist = getContract("CouponDistributor", readProvider, network);
      const distAddr = await dist.getAddress();

      // Pool balance & admin balances
      const [poolBal, uBal] = await Promise.all([
        usdc.balanceOf(distAddr),
        account ? usdc.balanceOf(account) : 0n,
      ]);
      setCouponPoolBalance(poolBal);
      setUsdcBalance(uBal);

      // Active periods
      try {
        if (hasFn(dist, "getActivePeriods")) {
          const raw = await dist.getActivePeriods();
          const list = raw.map((p) => Number(p));
          if (list.length > 0) setActivePeriods(list);
        }
      } catch {}

      // Discover token holders using events & common accounts
      let discoveredHolders = [];
      try {
        const hList = await fetchHolders(bond, readProvider, network);
        discoveredHolders = hList;
      } catch {
        discoveredHolders = account ? [{ address: account, balance: await bond.balanceOf(account) }] : [];
      }

      // Check on-chain snapshot and claim status for each holder in selectedPeriod
      const periodId = BigInt(selectedPeriod);
      const holderStatusList = await Promise.all(
        discoveredHolders.map(async (h) => {
          let snapBal = 0n;
          let hasClaimed = false;
          let calculatedCoupon = 0n;

          try {
            [snapBal, hasClaimed, calculatedCoupon] = await Promise.all([
              dist.snapshotBalances(periodId, h.address),
              dist.hasClaimed(periodId, h.address),
              dist.calculateCoupon(h.balance),
            ]);
          } catch {}

          return {
            ...h,
            snapBal,
            hasClaimed,
            calculatedCoupon,
          };
        })
      );

      setHolders(holderStatusList);
    } catch (err) {
      console.warn("Could not load admin coupon terminal data:", err);
    } finally {
      setLoading(false);
    }
  }, [account, readProvider, network, selectedPeriod]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData, refreshTrigger]);

  // Calculate total coupon liability for eligible holders
  const totalLiability = useMemo(() => {
    return holders.reduce((sum, h) => sum + h.calculatedCoupon, 0n);
  }, [holders]);

  const totalLiabilityFormatted = fmtNumber(fromUnits(totalLiability, USDC_DECIMALS));
  const poolBalanceFormatted = fmtNumber(fromUnits(couponPoolBalance, USDC_DECIMALS));
  const isFullyFunded = couponPoolBalance >= totalLiability;

  // 1. FUND COUPON POOL
  const handleFundCouponPool = async (e) => {
    e.preventDefault();
    if (!signer) return toast.warn("Connect your authorized issuer/admin wallet.");
    const numAmt = Number(fundAmount);
    if (!numAmt || numAmt <= 0) return toast.warn("Enter a valid deposit amount.");

    setFundingBusy(true);
    try {
      const usdc = getContract("MockUSDC", signer, network);
      const dist = getContract("CouponDistributor", signer, network);
      const distAddr = await dist.getAddress();
      const rawAmt = toUnits(String(numAmt), USDC_DECIMALS);

      // Check allowance
      setFundingStep("Checking USDC approval in MetaMask...");
      const allowance = await usdc.allowance(account, distAddr);

      if (allowance < rawAmt) {
        setFundingStep("Confirming USDC approval in MetaMask...");
        const appTx = await usdc.approve(distAddr, rawAmt);
        await appTx.wait();
      }

      // Deposit
      setFundingStep(`Depositing $${fmtNumber(numAmt)} USDC to Coupon Pool in MetaMask...`);
      const depositTx = await dist.depositCouponFunds(rawAmt);
      setFundingStep("Confirming transaction on Sepolia...");
      await depositTx.wait();

      toast.success(`Successfully funded $${fmtNumber(numAmt)} USDC into the Coupon Pool!`);
      setFundAmount("");
      setRefreshTrigger((n) => n + 1);
      loadAdminData();
    } catch (err) {
      console.error("Fund pool error:", err);
      toast.error(friendlyError(err));
    } finally {
      setFundingBusy(false);
      setFundingStep("");
    }
  };

  // 2. RECORD ELIGIBLE INVESTOR SNAPSHOT
  const handleRecordSnapshot = async () => {
    if (!signer) return toast.warn("Connect authorized issuer/admin wallet.");
    if (holders.length === 0) return toast.warn("No eligible tokenholders found to record.");

    setSnapshotBusy(true);
    try {
      const dist = getContract("CouponDistributor", signer, network);
      const periodId = BigInt(selectedPeriod);
      const addresses = holders.map((h) => h.address);
      const balances = holders.map((h) => h.balance);

      setSnapshotStep(`Recording Period ${selectedPeriod} snapshot for ${addresses.length} holders in MetaMask...`);
      const tx = await dist.recordSnapshot(periodId, addresses, balances);
      setSnapshotStep("Confirming snapshot on Sepolia testnet...");
      await tx.wait();

      toast.success(`Snapshot for Period ${selectedPeriod} recorded on-chain! Investors can now claim.`);
      setRefreshTrigger((n) => n + 1);
      loadAdminData();
    } catch (err) {
      console.error("Record snapshot error:", err);
      toast.error(friendlyError(err));
    } finally {
      setSnapshotBusy(false);
      setSnapshotStep("");
    }
  };

  // 3. COMPLETE END-TO-END DISTRIBUTION PIPELINE (Issuer Pools Liquidity + Records Snapshot)
  const handleFullDistributionCycle = async () => {
    if (!signer) return toast.warn("Connect authorized issuer/admin wallet.");

    setFundingBusy(true);
    try {
      const usdc = getContract("MockUSDC", signer, network);
      const bond = getContract("BondToken", signer, network);
      const kyc = getContract("KYCRegistry", signer, network);
      const dist = getContract("CouponDistributor", signer, network);
      const distAddr = await dist.getAddress();

      let targetHolders = [...holders];
      const testInvestor = "0xE3a9419109499d6A67507F67D04ce97075f6E78C";

      // If no holders exist yet, auto-provision test investor 0xE3a9...
      if (targetHolders.length === 0) {
        setFundingStep(`Pre-flight: Setting up test investor ${shortAddr(testInvestor)}...`);
        const isVerified = await kyc.isVerified(testInvestor).catch(() => false);
        if (!isVerified) {
          const txWl = await kyc.addToWhitelist(testInvestor);
          await txWl.wait();
        }

        const bal = await bond.balanceOf(testInvestor);
        const targetBal = bal > 0n ? bal : ethers.parseUnits("25", 18);
        if (bal === 0n) {
          setFundingStep(`Pre-flight: Minting 25 AURA-BOND tokens to ${shortAddr(testInvestor)}...`);
          const myBal = await bond.balanceOf(account);
          if (myBal >= targetBal) {
            await (await bond.transfer(testInvestor, targetBal)).wait();
          } else {
            await (await bond.mint(testInvestor, targetBal)).wait();
          }
        }
        targetHolders = [{ address: testInvestor, balance: targetBal }];
      }

      // Calculate total liability
      let cycleLiability = totalLiability;
      if (cycleLiability === 0n && targetHolders.length > 0) {
        const estCoupon = await dist.calculateCoupon(targetHolders[0].balance).catch(() => ethers.parseUnits("500", 6));
        cycleLiability = estCoupon * BigInt(targetHolders.length);
      }

      const neededUSDC = cycleLiability > couponPoolBalance ? (cycleLiability - couponPoolBalance) : 0n;

      // Step 1: Fund deficit if needed
      if (neededUSDC > 0n) {
        setFundingStep(`Stage 1/2: Pooling $${fmtNumber(fromUnits(neededUSDC, USDC_DECIMALS))} MockUSDC into CouponDistributor...`);
        const userBal = await usdc.balanceOf(account);
        if (userBal < neededUSDC) {
          try {
            const topup = await usdc.mint(account, neededUSDC * 2n);
            await topup.wait();
          } catch {}
        }
        const appTx = await usdc.approve(distAddr, neededUSDC);
        await appTx.wait();
        const depTx = await dist.depositCouponFunds(neededUSDC);
        await depTx.wait();
        toast.info("Stage 1 Complete: Coupon Pool is now fully capitalized!");
      }

      // Step 2: Commit Snapshot
      setFundingStep(`Stage 2/2: Committing Period ${selectedPeriod} Snapshot for ${targetHolders.length} holder(s)...`);
      const periodId = BigInt(selectedPeriod);
      const addresses = targetHolders.map((h) => h.address);
      const balances = targetHolders.map((h) => h.balance);
      const snapTx = await dist.recordSnapshot(periodId, addresses, balances);
      await snapTx.wait();

      toast.success(`Complete Distribution Cycle executed! Period ${selectedPeriod} is fully funded and available for investor claims.`);
      setRefreshTrigger((n) => n + 1);
      loadAdminData();
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err));
    } finally {
      setFundingBusy(false);
      setFundingStep("");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header Banner */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="badge badge-blue">ADMINISTRATION</span>
              <span className="badge badge-emerald">Coupon Operations</span>
            </div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Coupon Distribution Terminal
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem", maxWidth: 650 }}>
              Audit eligible bondholder balances, calculate total interest liabilities, deposit USDC liquidity, and
              commit cryptographic investor snapshots to `CouponDistributor.sol`.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleSeedDemoInvestor("0xE3a9419109499d6A67507F67D04ce97075f6E78C")}
              disabled={seedingBusy}
              title="Seed 25 AURA-BOND tokens and Period 1 snapshot for 0xE3a9...78C"
              style={{ fontSize: "0.72rem", padding: "0.3rem 0.65rem", gap: "0.35rem" }}
            >
              <Gift size={13} />
              <span>{seedingBusy ? "Provisioning..." : "Seed Investor (0xE3a9...)"}</span>
            </button>

            <button
              className="btn btn-emerald btn-sm"
              onClick={() => setFaucetOpen(true)}
              title="Mint test MockUSDC for funding"
            >
              <Coins size={13} />
              <span>Get Test USDC</span>
            </button>

            <button
              className="btn-icon"
              onClick={() => { setRefreshTrigger((n) => n + 1); loadAdminData(); }}
              aria-label="Refresh admin data"
              title="Refresh"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* 4 Operations KPI Cards */}
        <div className="grid-4" style={{ marginTop: "1.5rem" }}>
          <div className="stat-box">
            <div className="stat-label">Active Coupon Pool</div>
            <div className="stat-value font-mono" style={{ color: "var(--accent-emerald)" }}>
              ${poolBalanceFormatted}
            </div>
            <div className="stat-sub">Held in smart contract</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">Period {selectedPeriod} Liability</div>
            <div className="stat-value font-mono" style={{ color: "var(--accent-blue)" }}>
              ${totalLiabilityFormatted}
            </div>
            <div className="stat-sub">Across {holders.length} eligible holders</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">Funding Status</div>
            <div className="stat-value" style={{ fontSize: "1.1rem", marginTop: 4 }}>
              {isFullyFunded ? (
                <span className="badge badge-emerald">Fully Funded (100%)</span>
              ) : (
                <span className="badge badge-amber">Requires Funding</span>
              )}
            </div>
            <div className="stat-sub">Coverage: {couponPoolBalance > 0n && totalLiability > 0n ? `${((Number(couponPoolBalance) / Number(totalLiability)) * 100).toFixed(0)}%` : "0%"}</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">Total Eligible Holders</div>
            <div className="stat-value font-mono">{holders.length}</div>
            <div className="stat-sub">Verified tokenholders</div>
          </div>
        </div>
      </div>

      {/* Visual Interactive Pipeline: Issuer Pools -> Smart Contract Locks -> Investor Claims */}
      <div
        className="card"
        style={{
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.85) 100%)",
          border: "1px solid rgba(59, 130, 246, 0.3)",
          padding: "1.25rem 1.5rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Sparkles size={16} color="#3b82f6" />
              <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#fff", margin: 0 }}>
                End-to-End Debt Servicing Pipeline
              </h3>
              <span className="badge badge-blue">ACTIVE LIFECYCLE</span>
            </div>
            <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
              Live flow: Issuer pools required MockUSDC interest &rarr; Protocol commits snapshot &rarr; Investor claims payout.
            </p>
          </div>

          <button
            className="btn btn-primary btn-sm"
            onClick={handleFullDistributionCycle}
            disabled={fundingBusy || snapshotBusy}
            style={{ gap: "0.4rem", padding: "0.45rem 0.9rem" }}
            title="Automates both Issuer Pooling and Snapshot Commitment in one flow"
          >
            <CheckCircle2 size={14} />
            <span>{fundingBusy ? "Processing Pipeline..." : `Run Complete Cycle for Period ${selectedPeriod}`}</span>
          </button>
        </div>

        {/* 3 Pipeline Stages */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
          {/* Stage 1: Issuer Pools Funds */}
          <div
            style={{
              background: isFullyFunded ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.08)",
              border: `1px solid ${isFullyFunded ? "rgba(16, 185, 129, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
              borderRadius: "var(--radius-md)",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Stage 1: Issuer
                </span>
                {isFullyFunded ? (
                  <span className="badge badge-emerald">Funded</span>
                ) : (
                  <span className="badge badge-amber">Action Needed</span>
                )}
              </div>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#fff" }}>
                1. Pool Coupon Liquidity
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.3rem", lineHeight: 1.4 }}>
                Issuer deposits MockUSDC into smart contract pool to cover period liability.
              </p>
            </div>

            <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Pool Balance vs Liability</div>
              <div className="font-mono" style={{ fontSize: "0.85rem", fontWeight: 700, color: isFullyFunded ? "#10b981" : "#f59e0b" }}>
                ${poolBalanceFormatted} / ${totalLiabilityFormatted}
              </div>
            </div>
          </div>

          {/* Stage 2: Smart Contract Snapshot */}
          <div
            style={{
              background: holders.some((h) => h.snapBal > 0n) ? "rgba(16, 185, 129, 0.08)" : "rgba(59, 130, 246, 0.08)",
              border: `1px solid ${holders.some((h) => h.snapBal > 0n) ? "rgba(16, 185, 129, 0.3)" : "rgba(59, 130, 246, 0.3)"}`,
              borderRadius: "var(--radius-md)",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Stage 2: Protocol
                </span>
                {holders.some((h) => h.snapBal > 0n) ? (
                  <span className="badge badge-emerald">Sealed</span>
                ) : (
                  <span className="badge badge-blue">Pending</span>
                )}
              </div>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#fff" }}>
                2. Record Date Snapshot
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.3rem", lineHeight: 1.4 }}>
                Contract seals exact bond balances at record date to determine claimable amounts.
              </p>
            </div>

            <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Period {selectedPeriod} Snapshot</div>
              <div className="font-mono" style={{ fontSize: "0.85rem", fontWeight: 700, color: "#60a5fa" }}>
                {holders.filter((h) => h.snapBal > 0n).length} / {holders.length} Holders Recorded
              </div>
            </div>
          </div>

          {/* Stage 3: Investor Receives USDC */}
          <div
            style={{
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              borderRadius: "var(--radius-md)",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Stage 3: Investor
                </span>
                <span className="badge badge-emerald">Live Claims</span>
              </div>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#fff" }}>
                3. Investor Claims USDC
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.3rem", lineHeight: 1.4 }}>
                Whitelisted bondholders claim periodic interest straight into their wallets.
              </p>
            </div>

            <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Claim Status</div>
              <div className="font-mono" style={{ fontSize: "0.85rem", fontWeight: 700, color: "#10b981" }}>
                {holders.filter((h) => h.hasClaimed).length} Claimed &bull; {holders.filter((h) => !h.hasClaimed && h.snapBal > 0n).length} Unclaimed
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2-Column Action Grid: Period Selector & Pool Funding */}
      <div className="grid-2">
        {/* Card 1: Select Period & Snapshot Trigger */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <Calendar size={17} color="#3b82f6" /> 1. Select Period & Record Snapshot
                </h3>
                <p className="card-subtitle">Select the payment cycle and write tokenholder balances on-chain.</p>
              </div>
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="periodSelect">Select Payment Period</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  id="periodSelect"
                  className="input-field font-mono"
                  type="number"
                  min="1"
                  step="1"
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value.trim())}
                  placeholder="e.g. 1"
                />
              </div>
            </div>

            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.5rem", lineHeight: 1.5 }}>
              Active on-chain periods: <b className="font-mono">{activePeriods.join(", ")}</b>.
              Recording a snapshot seals the eligible coupon claim amount for each wallet.
            </div>
          </div>

          <div style={{ marginTop: "1.25rem" }}>
            {snapshotStep && (
              <div className="alert-banner info" style={{ marginBottom: "0.75rem" }}>
                <RefreshCw size={13} className="spin" />
                <span style={{ fontSize: "0.78rem" }}>{snapshotStep}</span>
              </div>
            )}

            <button
              className="btn btn-primary"
              disabled={snapshotBusy || holders.length === 0}
              onClick={handleRecordSnapshot}
              style={{ width: "100%", justifyContent: "center", gap: 4 }}
            >
              <FileCheck size={14} />
              <span>{snapshotBusy ? "Recording on Chain..." : `Record Period ${selectedPeriod} Snapshot`}</span>
            </button>
          </div>
        </div>

        {/* Card 2: Fund the Coupon Pool */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <Coins size={17} color="#10b981" /> 2. Fund Coupon Pool Liquidity
                </h3>
                <p className="card-subtitle">Deposit MockUSDC into the distributor contract for investor claims.</p>
              </div>
            </div>

            <form onSubmit={handleFundCouponPool} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="input-group">
                <label className="input-label" htmlFor="fundAmtInput">Deposit Amount (MockUSDC)</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    id="fundAmtInput"
                    className="input-field font-mono"
                    type="number"
                    step="any"
                    min="1"
                    placeholder="e.g. 5000"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setFundAmount(totalLiabilityFormatted.replace(/,/g, ""))}
                  >
                    Match Liability
                  </button>
                </div>
              </div>

              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                Your Wallet Balance: <b className="font-mono">${fmtNumber(fromUnits(usdcBalance, USDC_DECIMALS))} USDC</b>
              </div>

              {fundingStep && (
                <div className="alert-banner info" style={{ margin: 0 }}>
                  <RefreshCw size={13} className="spin" />
                  <span style={{ fontSize: "0.78rem" }}>{fundingStep}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-emerald"
                disabled={fundingBusy || !fundAmount || Number(fundAmount) <= 0}
                style={{ width: "100%", justifyContent: "center", gap: 4, marginTop: "0.5rem" }}
              >
                <DollarSign size={14} />
                <span>{fundingBusy ? "Funding..." : "Deposit Funds to Pool"}</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Eligible Tokenholders & Claim Tracking Table */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              <Users size={17} color="#f59e0b" /> Eligible Bondholders & Period {selectedPeriod} Claim Status
            </h3>
            <p className="card-subtitle">Live on-chain claim tracking (`hasClaimed` and snapshot balances).</p>
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Holder Address</th>
                <th>Current Bond Balance</th>
                <th>Snapshot Balance</th>
                <th>Calculated Coupon</th>
                <th>Claim Status</th>
              </tr>
            </thead>
            <tbody>
              {holders.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
                    No tokenholders detected on this contract yet.
                  </td>
                </tr>
              ) : (
                holders.map((h, i) => (
                  <tr key={h.address || i}>
                    <td className="font-mono">{h.address}</td>
                    <td className="font-mono">{fmtNumber(fromUnits(h.balance, BOND_DECIMALS))} Bonds</td>
                    <td className="font-mono">{fmtNumber(fromUnits(h.snapBal, BOND_DECIMALS))} Bonds</td>
                    <td className="font-mono" style={{ color: "var(--accent-emerald)", fontWeight: 700 }}>
                      ${fmtNumber(fromUnits(h.calculatedCoupon, USDC_DECIMALS))} USDC
                    </td>
                    <td>
                      {h.hasClaimed ? (
                        <span className="badge badge-emerald">Claimed / Paid</span>
                      ) : h.snapBal > 0n ? (
                        <span className="badge badge-amber">Unclaimed</span>
                      ) : (
                        <span className="badge">No Snapshot</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Faucet Modal */}
      <TestUsdcFaucetModal
        isOpen={faucetOpen}
        onClose={() => setFaucetOpen(false)}
        initialAmount="10000"
        onSuccess={() => {
          setRefreshTrigger((n) => n + 1);
          loadAdminData();
        }}
      />
    </div>
  );
}


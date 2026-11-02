import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import {
  getContract,
  loadTerms,
  hasFn,
  BOND_DECIMALS,
  USDC_DECIMALS,
  txUrl,
} from "../contracts/platform";
import { toUnits, fromUnits, fmtNumber, shortAddr, friendlyError } from "../lib/utils";
import { fetchBackendEvents, seedDemoInvestor } from "../lib/backend";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import {
  DollarSign,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Coins,
  RefreshCw,
  Gift,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  FileText,
  Info,
} from "lucide-react";
import TestUsdcFaucetModal from "./TestUsdcFaucetModal";

export default function InvestorIncomeView({ onExplore }) {
  const { account, readProvider, signer, network, isKycVerified, refreshTrigger, setRefreshTrigger, roles } = useAuth();
  const toast = useToast();

  const [terms, setTerms] = useState(null);
  const [bondBalance, setBondBalance] = useState(0n);
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [distributorPool, setDistributorPool] = useState(0n);
  const [periodsPerYear, setPeriodsPerYear] = useState(4);
  const [activePeriods, setActivePeriods] = useState([]);
  const [periodDetails, setPeriodDetails] = useState([]);
  const [claimEvents, setClaimEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [claimingPeriod, setClaimingPeriod] = useState(null);
  const [faucetOpen, setFaucetOpen] = useState(false);

  // Load live data from CouponDistributor contract
  const loadIncomeData = useCallback(async () => {
    if (!account || !readProvider) return;
    setLoading(true);
    try {
      const t = await loadTerms(readProvider, network);
      setTerms(t);

      const bond = getContract("BondToken", readProvider, network);
      const usdc = getContract("MockUSDC", readProvider, network);
      const dist = getContract("CouponDistributor", readProvider, network);
      const distAddr = await dist.getAddress();

      // Fetch balances & contract params
      const [bBal, uBal, dBal] = await Promise.all([
        bond.balanceOf(account),
        usdc.balanceOf(account),
        usdc.balanceOf(distAddr),
      ]);
      setBondBalance(bBal);
      setUsdcBalance(uBal);
      setDistributorPool(dBal);

      // Periods per year
      let ppy = 4;
      try {
        if (hasFn(dist, "periodsPerYear")) {
          ppy = Number(await dist.periodsPerYear()) || 4;
        }
      } catch {}
      setPeriodsPerYear(ppy);

      // Active recorded snapshot periods
      let periods = [1];
      try {
        if (hasFn(dist, "getActivePeriods")) {
          const raw = await dist.getActivePeriods();
          periods = raw.map((p) => Number(p));
          if (periods.length === 0) periods = [1];
        }
      } catch {
        periods = [1];
      }
      setActivePeriods(periods);

      // Check each period's snapshot & claim status for this account
      const details = await Promise.all(
        periods.map(async (p) => {
          let snapBal = 0n;
          let hasClaimed = false;
          let claimable = 0n;

          try {
            [snapBal, hasClaimed] = await Promise.all([
              dist.snapshotBalances(BigInt(p), account),
              dist.hasClaimed(BigInt(p), account),
            ]);

            if (hasFn(dist, "getClaimableCoupon")) {
              claimable = await dist.getClaimableCoupon(BigInt(p), account);
            } else if (snapBal > 0n) {
              claimable = await dist.calculateCoupon(snapBal);
            }
          } catch (e) {
            console.warn(`Could not check period ${p}:`, e);
          }

          return {
            period: p,
            snapshotBalance: snapBal,
            hasClaimed,
            claimableAmount: claimable,
          };
        })
      );
      setPeriodDetails(details);

      // Fetch indexed Claim events for history
      try {
        const eventsRes = await fetchBackendEvents(100);
        if (eventsRes && eventsRes.ok && Array.isArray(eventsRes.data)) {
          const userClaims = eventsRes.data.filter(
            (e) =>
              e.type === "CouponClaimed" &&
              ((e.args?.account && e.args.account.toLowerCase() === account.toLowerCase()) ||
                (e.args?.user && e.args.user.toLowerCase() === account.toLowerCase()))
          );
          setClaimEvents(userClaims);
        }
      } catch {
        setClaimEvents([]);
      }
    } catch (err) {
      console.warn("Could not load income data:", err);
    } finally {
      setLoading(false);
    }
  }, [account, readProvider, network]);

  useEffect(() => {
    loadIncomeData();
  }, [loadIncomeData, refreshTrigger]);

  // Periodic coupon calculation formula:
  // Periodic Coupon = (Bonds × Face Value) × Annual Rate / Payments Per Year
  const bondCount = Number(fromUnits(bondBalance, BOND_DECIMALS));
  const faceVal = terms ? Number(fromUnits(terms.faceValue, USDC_DECIMALS)) : 1000;
  const annualRate = terms ? terms.couponRateBps / 10000 : 0.08;
  const periodicCouponEstimate = (bondCount * faceVal * annualRate) / periodsPerYear;
  const annualCouponEstimate = bondCount * faceVal * annualRate;

  // Total Claimable across periods
  const totalClaimableUSDC = useMemo(() => {
    return periodDetails.reduce((sum, item) => {
      if (!item.hasClaimed && item.claimableAmount > 0n) {
        return sum + item.claimableAmount;
      }
      return sum;
    }, 0n);
  }, [periodDetails]);

  // Total Income Claimed to date
  const totalClaimedUSDC = useMemo(() => {
    return claimEvents.reduce((sum, e) => {
      const payoutRaw = BigInt(e.args?.payout || e.args?.amount || 0);
      return sum + Number(fromUnits(payoutRaw, USDC_DECIMALS));
    }, 0);
  }, [claimEvents]);

  const [seedingBusy, setSeedingBusy] = useState(false);

  const handleSeedDemo = async () => {
    const targetWallet = account || "0xE3a9419109499d6A67507F67D04ce97075f6E78C";
    setSeedingBusy(true);
    toast.info("Configuring test investments on Sepolia (Whitelisting, 25 AURA-BOND tokens, and Period 1 coupon snapshot)...");
    try {
      const res = await seedDemoInvestor(targetWallet, 25, 1);
      if (res.ok) {
        toast.success(`Successfully provisioned 25 AURA-BOND ($25,000) and Period 1 Coupon snapshot on Sepolia!`);
        setRefreshTrigger((n) => n + 1);
        loadIncomeData();
        return;
      }

      // If connected as officer/admin and backend needs restart, execute directly via MetaMask
      const isOfficer = Boolean(roles?.isMasterAdmin || roles?.admin || roles?.issuer || (account && account.toLowerCase() === "0xc992ddeb354F51EDc472c7FB9D84Db200FaAf5DA".toLowerCase()));
      if (isOfficer && signer) {
        toast.info("Backend route pending reload — executing on-chain setup with connected admin wallet...");
        const kyc = getContract("KYCRegistry", signer, network);
        const bond = getContract("BondToken", signer, network);
        const dist = getContract("CouponDistributor", signer, network);

        const isVerified = await kyc.isVerified(targetWallet).catch(() => false);
        if (!isVerified) {
          toast.info(`Step 1/3: Whitelisting ${shortAddr(targetWallet)} in MetaMask...`);
          await (await kyc.addToWhitelist(targetWallet)).wait();
        }

        const targetBondWei = ethers.parseUnits("25", 18);
        const currentBal = await bond.balanceOf(targetWallet);
        if (currentBal < targetBondWei) {
          toast.info(`Step 2/3: Transferring 25 AURA-BOND to ${shortAddr(targetWallet)} in MetaMask...`);
          const myBal = await bond.balanceOf(account);
          if (myBal >= (targetBondWei - currentBal)) {
            await (await bond.transfer(targetWallet, targetBondWei - currentBal)).wait();
          } else {
            await (await bond.mint(targetWallet, targetBondWei - currentBal)).wait();
          }
        }

        toast.info(`Step 3/3: Committing Period 1 snapshot for ${shortAddr(targetWallet)} in MetaMask...`);
        const finalBondBal = await bond.balanceOf(targetWallet);
        await (await dist.recordSnapshot(1n, [targetWallet], [finalBondBal])).wait();

        toast.success(`Successfully provisioned 25 AURA-BOND & Period 1 snapshot on Sepolia!`);
        setRefreshTrigger((n) => n + 1);
        loadIncomeData();
      } else if (res.status === 404 || res.error?.includes("404")) {
        toast.error("Backend server needs a restart: In your backend terminal, press Ctrl+C and run 'npm start' to reload the new endpoint.");
      } else {
        toast.error(res.error || "Failed to provision demo investments");
      }
    } catch (err) {
      toast.error(err.message || "Failed to provision demo investments");
    } finally {
      setSeedingBusy(false);
    }
  };

  // EXECUTE CLAIM TRANSACTION
  const handleClaimCoupon = async (periodId) => {
    if (!signer || !account) {
      return toast.warn("Connect your wallet on Sepolia to claim coupons.");
    }
    if (!isKycVerified) {
      return toast.error("Your wallet is not KYC-verified. Please complete verification in My Account.");
    }

    setClaimingPeriod(periodId);
    try {
      const dist = getContract("CouponDistributor", signer, network);
      toast.info(`Claiming Period ${periodId} coupon in MetaMask...`);
      const tx = await dist.claimCoupon(BigInt(periodId));
      toast.info("Waiting for Sepolia confirmation...");
      const receipt = await tx.wait();

      toast.success(`Coupon for Period ${periodId} successfully claimed! MockUSDC credited.`);
      setRefreshTrigger((n) => n + 1);
      loadIncomeData();
    } catch (err) {
      console.error("Claim coupon error:", err);
      toast.error(friendlyError(err));
    } finally {
      setClaimingPeriod(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header Banner */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="badge badge-blue">INCOME & SERVICING</span>
              <span className="badge badge-emerald">Fixed Coupon Yield</span>
            </div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Investor Income & Coupon Schedule
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem", maxWidth: 680 }}>
              Track interest payouts across all periods. Coupons are calculated based on official issuer snapshots and
              disbursed in MockUSDC directly to your whitelisted address.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSeedDemo}
              disabled={seedingBusy}
              title="Auto-provision 25 test AURA-BOND tokens and Period 1 coupon snapshot for this wallet"
              style={{ fontSize: "0.72rem", padding: "0.3rem 0.65rem", gap: "0.35rem" }}
            >
              <Gift size={13} />
              <span>{seedingBusy ? "Provisioning..." : "Add Demo Bonds & Coupon"}</span>
            </button>

            <button
              className="btn btn-emerald btn-sm"
              onClick={() => setFaucetOpen(true)}
              title="Claim test MockUSDC"
            >
              <Coins size={13} />
              <span>Get Test USDC</span>
            </button>

            <button
              className="btn-icon"
              onClick={() => { setRefreshTrigger((n) => n + 1); loadIncomeData(); }}
              aria-label="Refresh income data"
              title="Refresh"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* 4 Summary Stats */}
        <div className="grid-4" style={{ marginTop: "1.5rem" }}>
          <div className="stat-box">
            <div className="stat-label">Total Coupon Claimed</div>
            <div className="stat-value font-mono" style={{ color: "var(--accent-emerald)" }}>
              ${fmtNumber(totalClaimedUSDC)}
            </div>
            <div className="stat-sub">Received to date</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">Currently Claimable</div>
            <div className="stat-value font-mono" style={{ color: totalClaimableUSDC > 0n ? "#10b981" : "inherit" }}>
              ${fmtNumber(fromUnits(totalClaimableUSDC, USDC_DECIMALS))}
            </div>
            <div className="stat-sub">Ready for withdrawal</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">Est. Periodic Payout</div>
            <div className="stat-value font-mono">
              ${fmtNumber(periodicCouponEstimate.toFixed(2))}
            </div>
            <div className="stat-sub">{periodsPerYear}x per year ({terms ? (terms.couponRateBps / 100).toFixed(2) : "8.00"}% APY)</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">Est. Annual Income</div>
            <div className="stat-value font-mono" style={{ color: "var(--accent-blue)" }}>
              ${fmtNumber(annualCouponEstimate.toFixed(2))}
            </div>
            <div className="stat-sub">On {fmtNumber(bondCount)} active bonds</div>
          </div>
        </div>
      </div>

      {/* Coupon Calculation Formula Callout */}
      <div
        className="card"
        style={{
          background: "rgba(59, 130, 246, 0.05)",
          border: "1px solid rgba(59, 130, 246, 0.2)",
          padding: "1rem 1.25rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700, fontSize: "0.85rem", color: "#60a5fa" }}>
          <Info size={15} />
          <span>Periodic Coupon Calculation Formula</span>
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.35rem", lineHeight: 1.5 }}>
          <b>Periodic Coupon</b> = <span className="font-mono">(Holding Face Value &times; Annual Coupon Rate) / Payments Per Year</span>
          <br />
          Example: {fmtNumber(bondCount)} bonds &times; ${fmtNumber(faceVal)} face value = <b>${fmtNumber(bondCount * faceVal)}</b> principal.
          At {terms ? (terms.couponRateBps / 100).toFixed(2) : "8.00"}% annual rate paid {periodsPerYear}x per year = <b>${fmtNumber(periodicCouponEstimate.toFixed(2))} USDC per period</b>.
        </div>
      </div>

      {/* 3-Step Lifecycle Pipeline (Issuer Pools -> Protocol Seals -> Investor Claims) */}
      <div
        className="card"
        style={{
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.8) 0%, rgba(30, 41, 59, 0.7) 100%)",
          border: "1px solid rgba(59, 130, 246, 0.2)",
          padding: "1rem 1.25rem",
        }}
      >
        <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#fff", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <TrendingUp size={15} color="#3b82f6" />
          <span>How Your Interest Reaches Your Wallet (Issuer &rarr; Protocol &rarr; Investor)</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "0.75rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Step 1: Issuer Pools Funds</div>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#10b981", marginTop: "0.2rem" }}>
              ${fmtNumber(fromUnits(distributorPool, USDC_DECIMALS))} USDC in Pool
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
              Issuer deposited interest into CouponDistributor
            </div>
          </div>

          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "0.75rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Step 2: Balance Snapshot</div>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#60a5fa", marginTop: "0.2rem" }}>
              {activePeriods.length} Active Cycles
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
              Your holdings are sealed at each record date
            </div>
          </div>

          <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "0.75rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Step 3: Direct Claim</div>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: totalClaimableUSDC > 0n ? "#10b981" : "var(--text-secondary)", marginTop: "0.2rem" }}>
              {totalClaimableUSDC > 0n ? `$${fmtNumber(fromUnits(totalClaimableUSDC, USDC_DECIMALS))} Ready` : "No Pending Claim"}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
              Payout transferred directly to your address
            </div>
          </div>
        </div>
      </div>

      {/* Demo Investment Setup Banner for Easy Evaluation */}
      {totalClaimableUSDC === 0n && (
        <div
          className="card"
          style={{
            background: "linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(16, 185, 129, 0.08) 100%)",
            border: "1px dashed rgba(59, 130, 246, 0.35)",
            padding: "1rem 1.25rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "rgba(59, 130, 246, 0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#60a5fa",
              }}
            >
              <Gift size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#fff" }}>
                Ready to test the coupon claiming process?
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                Auto-provision 25 AURA-BOND tokens ($25,000 face value) to {account ? shortAddr(account) : "your wallet"}, fund the coupon pool, and record your snapshot for Period 1.
              </div>
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSeedDemo}
            disabled={seedingBusy}
            style={{ gap: "0.4rem", padding: "0.5rem 1rem" }}
          >
            <Coins size={14} />
            <span>{seedingBusy ? "Provisioning On-Chain..." : "Provision Demo Bonds & Coupon"}</span>
          </button>
        </div>
      )}

      {/* Structured Multi-Period Payment Schedule Table */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              <Calendar size={17} color="#3b82f6" /> Coupon Payment Schedule & Lifecycles
            </h3>
            <p className="card-subtitle">
              Granular state tracking across each snapshot period: Estimated, Scheduled, Funded, Claimable, or Claimed.
            </p>
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Snapshot Balance</th>
                <th>Calculated Payout</th>
                <th>Pool Funding Status</th>
                <th>Lifecycle Status</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {periodDetails.map((item) => {
                const payoutFormatted = fmtNumber(fromUnits(item.claimableAmount, USDC_DECIMALS));
                const snapBonds = fmtNumber(fromUnits(item.snapshotBalance, BOND_DECIMALS));
                const isFunded = distributorPool >= item.claimableAmount;
                const canClaim = !item.hasClaimed && item.claimableAmount > 0n && isFunded;

                // Status classification
                let statusBadge = null;
                if (item.hasClaimed) {
                  statusBadge = <span className="badge badge-emerald">Claimed / Paid</span>;
                } else if (item.claimableAmount > 0n && isFunded) {
                  statusBadge = <span className="badge badge-emerald">Claimable</span>;
                } else if (item.claimableAmount > 0n && !isFunded) {
                  statusBadge = <span className="badge badge-amber">Awaiting Issuer Funds</span>;
                } else if (item.snapshotBalance > 0n) {
                  statusBadge = <span className="badge badge-blue">Scheduled</span>;
                } else {
                  statusBadge = <span className="badge">No Snapshot Balance</span>;
                }

                return (
                  <tr key={item.period}>
                    <td className="font-mono" style={{ fontWeight: 700 }}>
                      Period {item.period}
                    </td>
                    <td className="font-mono">
                      {snapBonds} Bonds
                    </td>
                    <td className="font-mono" style={{ fontWeight: 700, color: "var(--accent-emerald)" }}>
                      ${payoutFormatted} USDC
                    </td>
                    <td>
                      {isFunded ? (
                        <span style={{ color: "#10b981", fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <CheckCircle2 size={12} /> Funded (${fmtNumber(fromUnits(distributorPool, USDC_DECIMALS))} pool)
                        </span>
                      ) : (
                        <span style={{ color: "#f59e0b", fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <Clock size={12} /> Underfunded
                        </span>
                      )}
                    </td>
                    <td>{statusBadge}</td>
                    <td style={{ textAlign: "right" }}>
                      {canClaim ? (
                        <button
                          className="btn btn-emerald btn-sm"
                          disabled={claimingPeriod === item.period}
                          onClick={() => handleClaimCoupon(item.period)}
                          style={{ gap: 3 }}
                        >
                          <Coins size={12} />
                          <span>{claimingPeriod === item.period ? "Claiming..." : "Claim Coupon"}</span>
                        </button>
                      ) : item.hasClaimed ? (
                        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Paid</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Claim History & On-Chain Audit Table */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              <FileText size={17} color="#10b981" /> Verified Coupon Payment Receipts
            </h3>
            <p className="card-subtitle">Immutable on-chain execution history for your coupon claims on Sepolia.</p>
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Period</th>
                <th>Amount Paid</th>
                <th>Block</th>
                <th style={{ textAlign: "right" }}>Etherscan Receipt</th>
              </tr>
            </thead>
            <tbody>
              {claimEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2.5rem" }}>
                    No claim receipts found yet. Once you claim an active coupon period, your transaction receipt will be indexed here.
                  </td>
                </tr>
              ) : (
                claimEvents.map((claim, idx) => {
                  const url = txUrl(network, claim.tx_hash);
                  const payout = claim.args?.payout || claim.args?.amount || 0;
                  return (
                    <tr key={claim.tx_hash || idx}>
                      <td>
                        <span className="badge badge-emerald">CouponClaimed</span>
                      </td>
                      <td className="font-mono">Period {claim.args?.periodId || claim.args?.period || "1"}</td>
                      <td className="font-mono" style={{ fontWeight: 700, color: "var(--accent-emerald)" }}>
                        +${fmtNumber(fromUnits(BigInt(payout), USDC_DECIMALS))} MockUSDC
                      </td>
                      <td className="font-mono">{claim.blockNumber || "-"}</td>
                      <td style={{ textAlign: "right" }}>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--accent-blue)", display: "inline-flex", alignItems: "center", gap: 3 }}
                          >
                            <span className="font-mono">{shortAddr(claim.tx_hash)}</span>
                            <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className="font-mono">{shortAddr(claim.tx_hash)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Faucet Modal */}
      <TestUsdcFaucetModal
        isOpen={faucetOpen}
        onClose={() => setFaucetOpen(false)}
        initialAmount="5000"
        onSuccess={() => {
          setRefreshTrigger((n) => n + 1);
          loadIncomeData();
        }}
      />
    </div>
  );
}


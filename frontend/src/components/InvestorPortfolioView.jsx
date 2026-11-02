import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  getContract,
  loadTerms,
  hasFn,
  BOND_DECIMALS,
  USDC_DECIMALS,
  addressUrl,
  txUrl,
} from "../contracts/platform";
import { toUnits, fromUnits, fmtNumber, countdown, shortAddr } from "../lib/utils";
import { fetchBackendEvents, seedDemoInvestor } from "../lib/backend";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import { Modal, useTxRunner, StatusBanner } from "./ui";
import TestUsdcFaucetModal from "./TestUsdcFaucetModal";
import BondAnalyticsView from "./BondAnalyticsView";
import {
  Layers,
  DollarSign,
  TrendingUp,
  Coins,
  Calendar,
  Gift,
  RefreshCw,
  ExternalLink,
  History,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";

export default function InvestorPortfolioView({ onExplore }) {
  const { account, readProvider, signer, network, isKycVerified, refreshTrigger, setRefreshTrigger, roles } = useAuth();
  const toast = useToast();

  const [terms, setTerms] = useState(null);
  const [bondBalance, setBondBalance] = useState(0n);
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [distributorUsdc, setDistributorUsdc] = useState(0n);
  const [period, setPeriod] = useState("1");
  const [periodList, setPeriodList] = useState([]);
  const [snap, setSnap] = useState({ balance: 0n, claimed: false, payout: 0n });
  const [annualEstimate, setAnnualEstimate] = useState(0n);
  const [loading, setLoading] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState("");
  const [txEvents, setTxEvents] = useState([]);
  const [faucetOpen, setFaucetOpen] = useState(false);
  const [viewMode, setViewMode] = useState("holdings"); // "holdings" | "analytics"
  const [seedingBusy, setSeedingBusy] = useState(false);

  const handleSeedDemo = async () => {
    const targetWallet = account || "0xE3a9419109499d6A67507F67D04ce97075f6E78C";
    setSeedingBusy(true);
    toast.info("Configuring test investments on Sepolia (Whitelisting, 25 AURA-BOND tokens, and Period 1 coupon snapshot)...");
    try {
      const res = await seedDemoInvestor(targetWallet, 25, 1);
      if (res.ok) {
        toast.success("Successfully provisioned 25 AURA-BOND ($25,000) and Period 1 Coupon snapshot on Sepolia!");
        setRefreshTrigger((n) => n + 1);
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

  const onDone = useCallback(() => setRefreshTrigger((n) => n + 1), [setRefreshTrigger]);
  const { status, setStatus, busy, run } = useTxRunner(onDone);

  const isMatured = terms ? Date.now() >= terms.maturity.getTime() : false;
  const canTransact = Boolean(signer);

  // Load balances & terms
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!account || !readProvider) return;
      setLoading(true);
      try {
        const t = await loadTerms(readProvider, network);
        const bond = getContract("BondToken", readProvider, network);
        const usdc = getContract("MockUSDC", readProvider, network);
        const dist = getContract("CouponDistributor", readProvider, network);
        const distAddr = await dist.getAddress();

        let list = [];
        if (hasFn(dist, "getActivePeriods")) {
          try {
            list = (await dist.getActivePeriods()).map((p) => Number(p));
          } catch {
            list = [];
          }
        }
        if (list.length > 0 && !list.includes(Number(period))) {
          if (!cancelled) setPeriod(String(list[list.length - 1]));
        }

        const periodId = /^\d+$/.test(period) ? BigInt(period) : null;
        const [bBal, uBal, dBal] = await Promise.all([
          bond.balanceOf(account),
          usdc.balanceOf(account),
          usdc.balanceOf(distAddr),
        ]);

        let snapBal = 0n,
          claimed = false,
          payout = 0n;
        if (periodId !== null) {
          [snapBal, claimed] = await Promise.all([
            dist.snapshotBalances(periodId, account),
            dist.hasClaimed(periodId, account),
          ]);
          if (hasFn(dist, "getClaimableCoupon")) {
            payout = await dist.getClaimableCoupon(periodId, account);
          } else if (snapBal > 0n) {
            payout = await dist.calculateCoupon(snapBal);
          }
        }

        const est = bBal > 0n ? await dist.calculateCoupon(bBal) : 0n;

        if (!cancelled) {
          setTerms(t);
          setBondBalance(bBal);
          setUsdcBalance(uBal);
          setDistributorUsdc(dBal);
          setSnap({ balance: snapBal, claimed, payout });
          setPeriodList(list);
          setAnnualEstimate(est);
        }
      } catch (err) {
        console.warn("Error loading portfolio:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, readProvider, network, period, refreshTrigger]);

  // Load investor transaction history from indexed backend events
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!account) return;
      const res = await fetchBackendEvents(100);
      if (res.ok && Array.isArray(res.data) && !cancelled) {
        const addrLower = account.toLowerCase();
        // Filter events related to this account
        const userEvents = res.data.filter((e) => {
          const args = e.args || {};
          return (
            (args.from && args.from.toLowerCase() === addrLower) ||
            (args.to && args.to.toLowerCase() === addrLower) ||
            (args.buyer && args.buyer.toLowerCase() === addrLower) ||
            (args.seller && args.seller.toLowerCase() === addrLower) ||
            (args.investor && args.investor.toLowerCase() === addrLower) ||
            (args.account && args.account.toLowerCase() === addrLower)
          );
        });
        setTxEvents(userEvents);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, refreshTrigger]);

  const handleFaucet = () => {
    if (!signer) return toast.warn("Connect wallet to mint test tokens");
    run("Minting 1,000 test MockUSDC...", async () => {
      return getContract("MockUSDC", signer, network).mint(account, toUnits("1000", USDC_DECIMALS));
    }, "1,000 test MockUSDC credited to your wallet.");
  };

  const handleClaim = () => {
    if (!signer) return toast.warn("Connect your wallet first");
    if (!isKycVerified) return toast.error("KYC verification required before claiming coupons");
    if (!/^\d+$/.test(period) || BigInt(period) === 0n) return toast.error("Enter a valid coupon period");
    if (snap.claimed) return toast.error(`Period ${period} was already claimed`);
    if (snap.balance === 0n) return toast.error(`Your address was not in the snapshot for period ${period}`);
    if (distributorUsdc < snap.payout) return toast.error("The coupon contract does not hold enough liquidity yet");

    run(`Claiming coupon yield for Period ${period}...`, () =>
      getContract("CouponDistributor", signer, network).claimCoupon(BigInt(period)),
      `Coupon yield for Period ${period} claimed successfully.`
    );
  };

  // Redemption calculation
  let redeemRaw = 0n,
    redeemError = null;
  if (redeemAmount) {
    try {
      redeemRaw = toUnits(redeemAmount, BOND_DECIMALS);
      if (redeemRaw === 0n) redeemError = "Amount must be greater than 0.";
      else if (redeemRaw > bondBalance) redeemError = "You do not hold that many bonds.";
    } catch (e) {
      redeemError = e.message;
    }
  }
  const redeemPayout = terms && redeemRaw > 0n ? (redeemRaw * terms.faceValue) / 10n ** BigInt(BOND_DECIMALS) : 0n;

  const confirmRedeem = async () => {
    if (redeemError || redeemRaw === 0n) return;
    setRedeemOpen(false);
    await run(
      `Redeeming ${redeemAmount} bonds...`,
      () => getContract("CouponDistributor", signer, network).redeem(redeemRaw),
      `Redeemed ${redeemAmount} bonds for $${fmtNumber(fromUnits(redeemPayout, USDC_DECIMALS))} MockUSDC.`
    );
  };

  // Defensive BigInt coercions
  const safeBondBal = typeof bondBalance === "bigint" ? bondBalance : BigInt(bondBalance || 0);
  const safeUsdcBal = typeof usdcBalance === "bigint" ? usdcBalance : BigInt(usdcBalance || 0);
  const safeDistUsdc = typeof distributorUsdc === "bigint" ? distributorUsdc : BigInt(distributorUsdc || 0);
  const safeSnapBal = typeof snap.balance === "bigint" ? snap.balance : BigInt(snap.balance || 0);
  const safeSnapPay = typeof snap.payout === "bigint" ? snap.payout : BigInt(snap.payout || 0);
  const safeAnnualEst = typeof annualEstimate === "bigint" ? annualEstimate : BigInt(annualEstimate || 0);
  const safeFaceValue = terms ? (typeof terms.faceValue === "bigint" ? terms.faceValue : BigInt(terms.faceValue || 0)) : 1000000n;

  const faceVal = terms ? fromUnits(safeFaceValue, USDC_DECIMALS) : "1,000";
  const holdingVal = terms
    ? fromUnits((safeBondBal * safeFaceValue) / 10n ** BigInt(BOND_DECIMALS), USDC_DECIMALS)
    : "0";
  const couponPct = terms ? (Number(terms.couponRateBps) / 100).toFixed(2) : "8.00";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Portfolio Header Banner */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="badge badge-blue">MY PORTFOLIO</span>
              {isKycVerified ? (
                <span className="badge badge-emerald">Whitelisted</span>
              ) : (
                <span className="badge badge-amber">KYC Pending</span>
              )}
            </div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Fixed-Income Holdings & Yield
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Track tokenized bond assets, accrued coupon cashflows, and principal redemptions on Sepolia.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", background: "rgba(15, 23, 42, 0.6)", padding: "0.25rem", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
              <button
                className={`btn btn-sm ${viewMode === "holdings" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setViewMode("holdings")}
                style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem" }}
              >
                <Layers size={13} />
                <span>Holdings & Redemption</span>
              </button>
              <button
                className={`btn btn-sm ${viewMode === "analytics" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setViewMode("analytics")}
                style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem" }}
              >
                <TrendingUp size={13} />
                <span>Market & Yield Analytics</span>
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
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
            <button className="btn btn-emerald btn-sm" onClick={() => setFaucetOpen(true)} title="Mint test MockUSDC">
              <Coins size={14} />
              <span>Get Test USDC</span>
            </button>
            <button className="btn-icon" onClick={onDone} aria-label="Refresh portfolio data" title="Refresh">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Portfolio Stats Grid */}
        <div className="grid-4" style={{ marginTop: "1.5rem" }}>
          <div className="stat-box">
            <div className="stat-label">
              <span>Bond Balance</span>
              <Layers size={16} color="#3b82f6" />
            </div>
            <div className="stat-value font-mono">
              {fmtNumber(fromUnits(safeBondBal, BOND_DECIMALS), 4)} {terms?.symbol || "CB28"}
            </div>
            <div className="stat-sub">≈ ${fmtNumber(holdingVal)} face value</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">
              <span>Available MockUSDC</span>
              <DollarSign size={16} color="#10b981" />
            </div>
            <div className="stat-value font-mono">${fmtNumber(fromUnits(safeUsdcBal, USDC_DECIMALS))}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.35rem" }}>
              <span className="stat-sub">Trading & settlement</span>
              <button
                onClick={() => setFaucetOpen(true)}
                className="btn btn-emerald btn-sm"
                style={{ fontSize: "0.68rem", padding: "0.15rem 0.5rem", gap: "0.25rem" }}
              >
                <Sparkles size={10} />
                <span>Faucet</span>
              </button>
            </div>
          </div>

          <div className="stat-box">
            <div className="stat-label">
              <span>Claimable (Period {period})</span>
              <ArrowUpRight size={16} color="#f59e0b" />
            </div>
            <div className="stat-value font-mono" style={{ color: "var(--accent-emerald)" }}>
              ${fmtNumber(fromUnits(snap.claimed ? 0n : snap.payout, USDC_DECIMALS))}
            </div>
            <div className="stat-sub">
              {snap.claimed ? "Already claimed" : snap.balance === 0n ? "Not in snapshot" : `Snapshot: ${fmtNumber(fromUnits(snap.balance, BOND_DECIMALS), 2)} bonds`}
            </div>
          </div>

          <div className="stat-box">
            <div className="stat-label">
              <span>Maturity Lock-in</span>
              <Calendar size={16} color="#94a3b8" />
            </div>
            <div className="stat-value" style={{ fontSize: "1.2rem", marginTop: "0.6rem" }}>
              {isMatured ? <span className="badge badge-emerald">Ready for Redemption</span> : <span className="badge badge-amber">Lock-in Active</span>}
            </div>
            <div className="stat-sub" style={{ marginTop: "0.3rem" }}>
              {terms ? `${terms.maturity.toLocaleDateString()} (${countdown(terms.maturity)})` : "..."}
            </div>
          </div>
        </div>
      </div>

      <StatusBanner status={status} onClose={() => setStatus(null)} network={network} />

      {viewMode === "analytics" ? (
        <BondAnalyticsView />
      ) : (
        <>
          {/* Holdings Table */}
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <Layers size={18} color="#3b82f6" /> Tokenized Bond Position
                </h3>
                <p className="card-subtitle">Active ERC-20 debt units held in your connected wallet.</p>
              </div>
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Quantity</th>
                    <th>Face Value</th>
                    <th>Total Valuation</th>
                    <th>Coupon Rate</th>
                    <th>Maturity</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bondBalance === 0n ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2.5rem 1rem" }}>
                        <div>No bond holdings found in your connected wallet.</div>
                        {onExplore && (
                          <div style={{ marginTop: "0.75rem" }}>
                            <button className="btn btn-primary btn-sm" onClick={onExplore}>
                              Browse Available Offerings
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td>
                        <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{terms?.name || "Corporate Bond 2028"}</div>
                        <div className="font-mono" style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{terms?.symbol || "CB28"}</div>
                      </td>
                      <td className="font-mono" style={{ fontWeight: 700 }}>
                        {fmtNumber(fromUnits(bondBalance, BOND_DECIMALS), 4)}
                      </td>
                      <td className="font-mono">${fmtNumber(faceVal)}</td>
                      <td className="font-mono" style={{ fontWeight: 700, color: "var(--accent-blue)" }}>
                        ${fmtNumber(holdingVal)}
                      </td>
                      <td style={{ color: "var(--accent-emerald)", fontWeight: 700 }}>{couponPct}% p.a.</td>
                      <td>{terms ? terms.maturity.toLocaleDateString() : "-"}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn btn-emerald btn-sm"
                          disabled={!isMatured || bondBalance === 0n}
                          onClick={() => setRedeemOpen(true)}
                        >
                          Redeem at Maturity
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Maturity Timeline & Principal Repayment Verification */}
          <div className="card" style={{ border: "1px solid rgba(59, 130, 246, 0.25)" }}>
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <Calendar size={18} color="#3b82f6" /> Maturity Timeline & Principal Repayment Lifecycle
                </h3>
                <p className="card-subtitle">
                  Verify redemption eligibility, smart contract liquidity, and settlement steps.
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {isMatured ? (
                  <span className="badge badge-emerald">Eligible for Redemption</span>
                ) : (
                  <span className="badge badge-amber">Lock-in Period ({countdown(terms?.maturity)})</span>
                )}
              </div>
            </div>

            {/* 4-Step Visual Timeline */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "1rem",
                marginTop: "0.75rem",
                padding: "1rem",
                background: "rgba(15, 23, 42, 0.4)",
                borderRadius: "10px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ borderLeft: "3px solid #10b981", paddingLeft: "0.75rem" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--accent-emerald)", fontWeight: 700, textTransform: "uppercase" }}>Stage 1 • Completed</div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginTop: "0.2rem" }}>Bond Issuance</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                  Primary subscription closed on Sepolia testnet.
                </div>
              </div>

              <div style={{ borderLeft: "3px solid #3b82f6", paddingLeft: "0.75rem" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--accent-blue)", fontWeight: 700, textTransform: "uppercase" }}>Stage 2 • Active</div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginTop: "0.2rem" }}>Coupon Servicing</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                  Quarterly/semi-annual interest distribution via CouponDistributor.
                </div>
              </div>

              <div style={{ borderLeft: `3px solid ${isMatured ? "#10b981" : "#f59e0b"}`, paddingLeft: "0.75rem" }}>
                <div style={{ fontSize: "0.7rem", color: isMatured ? "var(--accent-emerald)" : "var(--accent-amber)", fontWeight: 700, textTransform: "uppercase" }}>
                  Stage 3 • {isMatured ? "Reached" : "Maturity Date"}
                </div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginTop: "0.2rem" }}>
                  {terms ? terms.maturity.toLocaleDateString() : "2028-12-31"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                  Trading halts, final snapshot, and redemption pool funding.
                </div>
              </div>

              <div style={{ borderLeft: `3px solid ${isMatured && bondBalance > 0n ? "#10b981" : "var(--border-subtle)"}`, paddingLeft: "0.75rem" }}>
                <div style={{ fontSize: "0.7rem", color: isMatured ? "var(--accent-emerald)" : "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>
                  Stage 4 • Redemption
                </div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginTop: "0.2rem" }}>Principal Repayment</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                  Holders burn ERC-20 bonds and receive 100% MockUSDC principal.
                </div>
              </div>
            </div>

            {/* Principal Calculation & Contract Liquidity Verification Grid */}
            <div className="grid-3" style={{ marginTop: "1rem" }}>
              <div className="stat-box" style={{ background: "rgba(15, 23, 42, 0.5)" }}>
                <div className="stat-label">
                  <span>Your Repayment Value</span>
                  <DollarSign size={14} color="#10b981" />
                </div>
                <div className="stat-value font-mono" style={{ fontSize: "1.25rem", color: "var(--accent-emerald)" }}>
                  ${fmtNumber(holdingVal)} USDC
                </div>
                <div className="stat-sub">
                  {fmtNumber(fromUnits(safeBondBal, BOND_DECIMALS), 2)} bonds × ${fmtNumber(faceVal)} par
                </div>
              </div>

              <div className="stat-box" style={{ background: "rgba(15, 23, 42, 0.5)" }}>
                <div className="stat-label">
                  <span>Contract Liquidity Pool</span>
                  <Coins size={14} color="#3b82f6" />
                </div>
                <div className="stat-value font-mono" style={{ fontSize: "1.25rem" }}>
                  ${fmtNumber(fromUnits(safeDistUsdc, USDC_DECIMALS))} USDC
                </div>
                <div className="stat-sub">
                  {safeDistUsdc >= ((safeBondBal * safeFaceValue) / 10n**18n) ? (
                    <span style={{ color: "var(--accent-emerald)", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                      <CheckCircle2 size={12} /> Solvency Verified
                    </span>
                  ) : (
                    <span style={{ color: "var(--accent-amber)" }}>Partial Liquidity</span>
                  )}
                </div>
              </div>

              <div className="stat-box" style={{ background: "rgba(15, 23, 42, 0.5)" }}>
                <div className="stat-label">
                  <span>Redemption Action</span>
                  <Clock size={14} color="#f59e0b" />
                </div>
                <div style={{ marginTop: "0.5rem" }}>
                  <button
                    className="btn btn-emerald btn-sm"
                    style={{ width: "100%", justifyContent: "center" }}
                    disabled={!isMatured || bondBalance === 0n || busy || !canTransact}
                    onClick={() => setRedeemOpen(true)}
                  >
                    {isMatured ? "Execute Redemption" : "Locked Until Maturity"}
                  </button>
                </div>
                <div className="stat-sub" style={{ textAlign: "center", marginTop: "0.35rem" }}>
                  {isMatured ? "Burn tokens to claim par value" : `Unlocks in ${countdown(terms?.maturity)}`}
                </div>
              </div>
            </div>
          </div>

          {/* Coupon Servicing Panel */}
          <div className="grid-2">
            <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div className="card-header">
                  <div>
                    <h3 className="card-title"><Coins size={18} color="#3b82f6" /> Claim Accrued Coupon</h3>
                    <p className="card-subtitle">Coupons are paid out in MockUSDC based on official issuer snapshot.</p>
                  </div>
                </div>
                <div className="input-group">
                  <label className="input-label" htmlFor="couponPeriodSelect">Snapshot Period</label>
                  {periodList.length > 0 ? (
                    <select
                      id="couponPeriodSelect"
                      className="input-field"
                      value={period}
                      onChange={(e) => setPeriod(e.target.value)}
                    >
                      {periodList.map((p) => (
                        <option key={p} value={String(p)}>Period {p}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="couponPeriodSelect"
                      className="input-field"
                      inputMode="numeric"
                      value={period}
                      onChange={(e) => setPeriod(e.target.value.trim())}
                      placeholder="1"
                    />
                  )}
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
                  Full period coupon estimate on current holdings: <b className="font-mono">${fmtNumber(fromUnits(annualEstimate, USDC_DECIMALS))} USDC</b>.
                </p>
              </div>
              <button
                onClick={handleClaim}
                disabled={busy || !canTransact || snap.claimed || snap.payout === 0n}
                className="btn btn-primary"
                style={{ marginTop: "1rem" }}
              >
                Claim Period {period} (${fmtNumber(fromUnits(snap.claimed ? 0n : snap.payout, USDC_DECIMALS))} USDC)
              </button>
            </div>

            <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div className="card-header">
                  <div>
                    <h3 className="card-title"><Layers size={18} color="#10b981" /> Direct Redemption Terminal</h3>
                    <p className="card-subtitle">Burn bonds at maturity to retrieve face value principal.</p>
                  </div>
                </div>
                <p style={{ fontSize: "0.825rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Redemption Pool balance: <b className="font-mono">${fmtNumber(fromUnits(distributorUsdc, USDC_DECIMALS))} MockUSDC</b> held by the smart contract.
                  {!isMatured && " Redemptions open once the maturity date has passed."}
                </p>
              </div>
              <button
                onClick={() => setRedeemOpen(true)}
                disabled={busy || !canTransact || !isMatured || bondBalance === 0n}
                className="btn btn-emerald"
                style={{ marginTop: "1rem" }}
              >
                Redeem Principal
              </button>
            </div>
          </div>

          {/* Transaction History Section */}
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <History size={18} color="#f59e0b" /> On-Chain Activity History
                </h3>
                <p className="card-subtitle">Indexed blockchain ledger transactions for your wallet.</p>
              </div>
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Contract</th>
                    <th>Block</th>
                    <th>Details</th>
                    <th style={{ textAlign: "right" }}>Transaction Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {txEvents.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "1.5rem" }}>
                        No recent indexed transactions found for {account ? shortAddr(account) : "this wallet"}.
                      </td>
                    </tr>
                  ) : (
                    txEvents.slice(0, 15).map((e, idx) => {
                      const url = txUrl(network, e.tx_hash);
                      return (
                        <tr key={`${e.tx_hash}-${idx}`}>
                          <td>
                            <span className="badge badge-blue">{e.type}</span>
                          </td>
                          <td>{e.contract}</td>
                          <td className="font-mono">{e.block_number}</td>
                          <td style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                            {e.type === "Transfer" && `Transfer of ${e.args?.value ? fmtNumber(fromUnits(e.args.value, BOND_DECIMALS), 2) : "tokens"}`}
                            {e.type === "OrderFilled" && `Marketplace trade Lot #${e.args?.id || ""}`}
                            {e.type === "CouponClaimed" && `Period ${e.args?.period || ""} coupon claimed`}
                            {e.type === "BondRedeemed" && `Bond redeemed for face value`}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono"
                                style={{ color: "var(--accent-blue)", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                              >
                                <span>{shortAddr(e.tx_hash)}</span>
                                <ExternalLink size={12} />
                              </a>
                            ) : (
                              <span className="font-mono">{shortAddr(e.tx_hash)}</span>
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
        </>
      )}

      {/* Redemption Modal */}
      {redeemOpen && (
        <Modal title="Redeem Bond Principal at Maturity" onClose={() => setRedeemOpen(false)}>
          <div className="input-group">
            <label className="input-label" htmlFor="redeemAmountInput">Bond Units to Redeem</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                id="redeemAmountInput"
                className="input-field"
                inputMode="decimal"
                value={redeemAmount}
                onChange={(e) => setRedeemAmount(e.target.value.trim())}
                placeholder="e.g. 5"
                autoFocus
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setRedeemAmount(fromUnits(bondBalance, BOND_DECIMALS))}
              >
                Max
              </button>
            </div>
          </div>

          {redeemError && (
            <p style={{ color: "var(--accent-rose)", fontSize: "0.8rem", marginTop: "0.5rem" }}>{redeemError}</p>
          )}

          {redeemRaw > 0n && !redeemError && (
            <p style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
              You will burn <b>{redeemAmount} bonds</b> and receive{" "}
              <b className="font-mono" style={{ color: "var(--accent-emerald)" }}>
                ${fmtNumber(fromUnits(redeemPayout, USDC_DECIMALS))} MockUSDC
              </b>{" "}
              principal.
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.25rem" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setRedeemOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-emerald btn-sm"
              disabled={!redeemAmount || Boolean(redeemError)}
              onClick={confirmRedeem}
            >
              Confirm Redemption
            </button>
          </div>
        </Modal>
      )}

      {/* Test MockUSDC Faucet Modal */}
      <TestUsdcFaucetModal
        isOpen={faucetOpen}
        onClose={() => setFaucetOpen(false)}
        initialAmount="5000"
        onSuccess={() => onDone()}
      />
    </div>
  );
}


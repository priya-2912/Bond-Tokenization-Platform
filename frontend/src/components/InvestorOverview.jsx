import React, { useState, useEffect, useCallback } from "react";
import { getContract, loadTerms, hasFn, BOND_DECIMALS, USDC_DECIMALS } from "../contracts/platform";
import { fromUnits, fmtNumber, shortAddr } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import { fetchBackendEvents } from "../lib/backend";
import {
  TrendingUp,
  DollarSign,
  Layers,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Sparkles,
  Coins,
  ChevronRight,
  Activity,
  Calendar,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import TestUsdcFaucetModal from "./TestUsdcFaucetModal";

export default function InvestorOverview({ onExplore, onGoToAccount, onGoToInvestments }) {
  const { account, readProvider, signer, network, user, isKycVerified, refreshTrigger, setRefreshTrigger } = useAuth();

  const [terms, setTerms] = useState(null);
  const [bondBalance, setBondBalance] = useState(0n);
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [claimableUsdc, setClaimableUsdc] = useState(0n);
  const [annualIncome, setAnnualIncome] = useState(0n);
  const [recentEvents, setRecentEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [faucetOpen, setFaucetOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!account || !readProvider) return;
    setLoading(true);
    try {
      const t = await loadTerms(readProvider, network);
      setTerms(t);

      const bond = getContract("BondToken", readProvider, network);
      const usdc = getContract("MockUSDC", readProvider, network);
      const dist = getContract("CouponDistributor", readProvider, network);
      const distAddr = await dist.getAddress();

      const [bBal, uBal] = await Promise.all([
        bond.balanceOf(account),
        usdc.balanceOf(account),
      ]);
      setBondBalance(bBal);
      setUsdcBalance(uBal);

      // Annual estimated coupon income
      if (bBal > 0n) {
        try {
          const est = await dist.calculateCoupon(bBal);
          setAnnualIncome(est);
        } catch {
          setAnnualIncome(0n);
        }
      } else {
        setAnnualIncome(0n);
      }

      // Check claimable coupons for recent active periods
      let claimable = 0n;
      try {
        if (hasFn(dist, "getActivePeriods")) {
          const periods = await dist.getActivePeriods();
          for (const p of periods) {
            const hasClaimed = await dist.hasClaimed(p, account);
            if (!hasClaimed) {
              if (hasFn(dist, "getClaimableCoupon")) {
                const payout = await dist.getClaimableCoupon(p, account);
                claimable += payout;
              } else {
                const snapBal = await dist.snapshotBalances(p, account);
                if (snapBal > 0n) {
                  claimable += await dist.calculateCoupon(snapBal);
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn("Could not check claimable coupons:", e);
      }
      setClaimableUsdc(claimable);

      // Fetch recent transactions
      try {
        const res = await fetchBackendEvents(5);
        if (res && res.ok && Array.isArray(res.data)) {
          setRecentEvents(res.data);
        } else {
          setRecentEvents([]);
        }
      } catch {
        setRecentEvents([]);
      }
    } catch (err) {
      console.warn("Error loading overview data:", err);
    } finally {
      setLoading(false);
    }
  }, [account, readProvider, network]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  // Defensive BigInt coercions to prevent "Cannot mix BigInt and other types" crashes
  const safeBondBal = typeof bondBalance === "bigint" ? bondBalance : BigInt(bondBalance || 0);
  const safeUsdcBal = typeof usdcBalance === "bigint" ? usdcBalance : BigInt(usdcBalance || 0);
  const safeAnnualIncome = typeof annualIncome === "bigint" ? annualIncome : BigInt(annualIncome || 0);
  const safeClaimable = typeof claimableUsdc === "bigint" ? claimableUsdc : BigInt(claimableUsdc || 0);

  const bondCount = terms ? Number(fromUnits(safeBondBal, BOND_DECIMALS)) : 0;
  const holdingValue = terms && safeBondBal > 0n
    ? (safeBondBal * BigInt(terms.faceValue)) / 10n ** BigInt(BOND_DECIMALS)
    : 0n;
  const portfolioValueFormatted = fmtNumber(fromUnits(holdingValue, USDC_DECIMALS));
  const availableUsdcFormatted = fmtNumber(fromUnits(safeUsdcBal, USDC_DECIMALS));
  const annualIncomeFormatted = fmtNumber(fromUnits(safeAnnualIncome, USDC_DECIMALS));
  const couponRatePct = terms ? (Number(terms.couponRateBps) / 100).toFixed(2) : "8.00";

  // Determine the primary Next Action
  let nextAction = null;
  if (!isKycVerified) {
    nextAction = {
      title: "Complete Identity Verification",
      description: "Verify your profile to unlock primary bond investments and secondary trading.",
      cta: "Verify Account",
      onClick: onGoToAccount,
      type: "warning",
      icon: <ShieldAlert size={18} color="#f59e0b" />,
    };
  } else if (safeClaimable > 0n) {
    nextAction = {
      title: "Claim Earned Coupon Payout",
      description: `You have $${fmtNumber(fromUnits(safeClaimable, USDC_DECIMALS))} ready to claim from your bond holdings.`,
      cta: "Claim Coupons",
      onClick: onGoToInvestments,
      type: "success",
      icon: <Coins size={18} color="#10b981" />,
    };
  } else if (safeBondBal === 0n) {
    nextAction = {
      title: "Make Your First Investment",
      description: "Institutional-grade US Treasury backed tokenized bonds are available for subscription.",
      cta: "Explore Bonds",
      onClick: onExplore,
      type: "primary",
      icon: <TrendingUp size={18} color="#3b82f6" />,
    };
  } else {
    nextAction = {
      title: "Portfolio in Good Standing",
      description: "Your holdings are actively accruing yield. Next coupon snapshot is monitored on-chain.",
      cta: "View Holdings",
      onClick: onGoToInvestments,
      type: "neutral",
      icon: <CheckCircle2 size={18} color="#10b981" />,
    };
  }

  const displayName = user?.fullName ? user.fullName.split(" ")[0] : "Investor";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem", maxWidth: 1080, margin: "0 auto" }}>
      {/* 1. Welcome & High-level Status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <h1 style={{ fontSize: "1.85rem", fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
              Welcome back, {displayName}
            </h1>
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "0.25rem" }}>
            Real-World Asset Portfolio Overview & Fixed Income Performance
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Small Verification Badge */}
          {isKycVerified ? (
            <div
              onClick={onGoToAccount}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.35rem 0.75rem",
                borderRadius: "var(--radius-full)",
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.25)",
                color: "#10b981",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Identity verified & whitelisted on-chain"
            >
              <ShieldCheck size={14} />
              <span>KYC Verified</span>
            </div>
          ) : (
            <div
              onClick={onGoToAccount}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.35rem 0.75rem",
                borderRadius: "var(--radius-full)",
                background: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.25)",
                color: "#f59e0b",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Click to complete verification"
            >
              <ShieldAlert size={14} />
              <span>Verification Needed</span>
            </div>
          )}

          {/* Test USDC Faucet quick action */}
          <button
            onClick={() => setFaucetOpen(true)}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem" }}
            title="Request testnet USDC tokens"
          >
            <Coins size={13} color="#10b981" />
            <span>Test USDC</span>
          </button>
        </div>
      </div>

      {/* 2. One Primary Portfolio Summary Card */}
      <div
        className="card"
        style={{
          background: "linear-gradient(135deg, rgba(21, 29, 44, 0.95) 0%, rgba(15, 23, 42, 0.9) 100%)",
          border: "1px solid var(--border-active)",
          padding: "2rem",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "2rem", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.05em" }}>
              Total Portfolio Value
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginTop: "0.35rem" }}>
              <span className="font-mono" style={{ fontSize: "2.4rem", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
                ${portfolioValueFormatted}
              </span>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>USDC</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.6rem", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
              <span>Backed by Short-Term US Treasury Bills</span>
              <span>•</span>
              <span style={{ color: "var(--accent-emerald)", fontWeight: 600 }}>{couponRatePct}% Annual Yield</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", paddingLeft: "1rem", borderLeft: "1px solid var(--border-subtle)" }}>
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                Expected Annual Income
              </div>
              <div className="font-mono" style={{ fontSize: "1.35rem", fontWeight: 700, color: "var(--accent-emerald)", marginTop: "0.25rem" }}>
                ${annualIncomeFormatted}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                Scheduled coupon distributions
              </div>
            </div>

            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                Available Cash Balance
              </div>
              <div className="font-mono" style={{ fontSize: "1.35rem", fontWeight: 700, color: "var(--text-primary)", marginTop: "0.25rem" }}>
                ${availableUsdcFormatted}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                Available to invest
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. One Clear Next Action Banner */}
      {nextAction && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "1rem",
            padding: "1.25rem 1.5rem",
            borderRadius: "var(--radius-md)",
            background:
              nextAction.type === "warning"
                ? "rgba(245, 158, 11, 0.08)"
                : nextAction.type === "success"
                ? "rgba(16, 185, 129, 0.08)"
                : "rgba(59, 130, 246, 0.08)",
            border: `1px solid ${
              nextAction.type === "warning"
                ? "rgba(245, 158, 11, 0.25)"
                : nextAction.type === "success"
                ? "rgba(16, 185, 129, 0.25)"
                : "rgba(59, 130, 246, 0.25)"
            }`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  nextAction.type === "warning"
                    ? "rgba(245, 158, 11, 0.15)"
                    : nextAction.type === "success"
                    ? "rgba(16, 185, 129, 0.15)"
                    : "rgba(59, 130, 246, 0.15)",
              }}
            >
              {nextAction.icon}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-primary)" }}>
                {nextAction.title}
              </div>
              <div style={{ fontSize: "0.825rem", color: "var(--text-secondary)", marginTop: "0.15rem" }}>
                {nextAction.description}
              </div>
            </div>
          </div>

          <button
            onClick={nextAction.onClick}
            className={`btn btn-sm ${
              nextAction.type === "warning"
                ? "btn-amber"
                : nextAction.type === "success"
                ? "btn-emerald"
                : "btn-primary"
            }`}
            style={{ padding: "0.5rem 1.1rem", fontSize: "0.825rem", gap: "0.4rem" }}
          >
            <span>{nextAction.cta}</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* 4. Bonds You Own & Quick Exploration */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem" }}>
        {/* Bonds Owned Card */}
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Layers size={17} color="#3b82f6" />
                <h3 style={{ fontSize: "1rem", fontWeight: 700 }}>Bonds You Own</h3>
              </div>
              <span className="badge badge-blue">{bondCount} Position{bondCount === 1 ? "" : "s"}</span>
            </div>

            {bondCount > 0 && terms ? (
              <div
                style={{
                  padding: "1rem",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{terms.name}</div>
                    <div className="font-mono" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                      {terms.symbol} • Matures {terms.maturity.toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="font-mono" style={{ fontWeight: 700, fontSize: "1rem" }}>
                      {fmtNumber(fromUnits(safeBondBal, BOND_DECIMALS))} Units
                    </div>
                    <div className="font-mono" style={{ fontSize: "0.75rem", color: "var(--accent-emerald)" }}>
                      ${portfolioValueFormatted}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: "1.75rem 1rem",
                  textAlign: "center",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-secondary)",
                  border: "1px dashed var(--border-subtle)",
                }}
              >
                <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  You do not currently hold any bond positions.
                </div>
                <div style={{ marginTop: "0.75rem" }}>
                  <button onClick={onExplore} className="btn btn-primary btn-sm">
                    Browse Offerings
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: "1.25rem", paddingTop: "0.85rem", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={onGoToInvestments}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: "0.75rem", gap: "0.35rem" }}
            >
              <span>Manage Portfolio & Claims</span>
              <ChevronRight size={13} />
            </button>
          </div>
        </div>

        {/* Explore Bonds Card */}
        <div
          className="card"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background: "linear-gradient(135deg, rgba(30, 58, 138, 0.15) 0%, rgba(21, 29, 44, 0.95) 100%)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <TrendingUp size={17} color="#3b82f6" />
              <h3 style={{ fontSize: "1rem", fontWeight: 700 }}>Featured Offering</h3>
            </div>

            <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>
              {terms ? terms.name : "Aura US Treasury Short-Duration Bond"}
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginTop: "0.35rem", lineHeight: 1.5 }}>
              Institutional fixed-income tokenized debt backed by reserve collateral. Pays periodic coupon distributions directly in USDC.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "1rem" }}>
              <div style={{ padding: "0.6rem 0.75rem", borderRadius: "var(--radius-sm)", background: "var(--bg-secondary)" }}>
                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Coupon Yield</div>
                <div style={{ fontWeight: 700, color: "var(--accent-emerald)", fontSize: "1rem", marginTop: "0.15rem" }}>
                  {couponRatePct}% APY
                </div>
              </div>
              <div style={{ padding: "0.6rem 0.75rem", borderRadius: "var(--radius-sm)", background: "var(--bg-secondary)" }}>
                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Face Value</div>
                <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "1rem", marginTop: "0.15rem" }}>
                  ${terms ? fmtNumber(fromUnits(terms.faceValue, USDC_DECIMALS)) : "1,000"} USDC
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "1.25rem", paddingTop: "0.85rem", borderTop: "1px solid var(--border-subtle)" }}>
            <button
              onClick={onExplore}
              className="btn btn-primary"
              style={{ width: "100%", justifyContent: "center", gap: "0.5rem" }}
            >
              <span>Explore All Bond Offerings</span>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* 5. Recent Activity (minimal table) */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Activity size={17} color="#94a3b8" />
            <h3 style={{ fontSize: "1rem", fontWeight: 700 }}>Recent Activity</h3>
          </div>
          <button
            onClick={onGoToInvestments}
            className="btn btn-secondary btn-sm"
            style={{ fontSize: "0.75rem" }}
          >
            Full History
          </button>
        </div>

        {Array.isArray(recentEvents) && recentEvents.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {recentEvents.slice(0, 4).map((evt, idx) => (
              <div
                key={evt.id || idx}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.7rem 0.9rem",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-secondary)",
                  fontSize: "0.825rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: evt.event_name?.includes("Buy") || evt.event_name?.includes("Mint") ? "#10b981" : "#3b82f6",
                    }}
                  />
                  <div>
                    <span style={{ fontWeight: 600 }}>{evt.event_name || "Transaction"}</span>
                    <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem", fontSize: "0.75rem" }}>
                      {evt.created_at ? new Date(evt.created_at).toLocaleDateString() : ""}
                    </span>
                  </div>
                </div>
                <div className="font-mono" style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
                  {evt.tx_hash ? shortAddr(evt.tx_hash) : "Completed"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            No recent activity recorded for this account.
          </div>
        )}
      </div>

      {/* Embedded Test USDC Faucet Modal */}
      <TestUsdcFaucetModal
        isOpen={faucetOpen}
        onClose={() => setFaucetOpen(false)}
        initialAmount="5000"
        onSuccess={() => setRefreshTrigger((n) => n + 1)}
      />
    </div>
  );
}


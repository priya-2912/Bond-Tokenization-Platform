import React, { useState, useEffect } from "react";
import { getAdminMetrics } from "../lib/backend";
import { getContract, loadTerms, BOND_DECIMALS, USDC_DECIMALS } from "../contracts/platform";
import { fromUnits, fmtNumber, timeAgo, shortAddr } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import {
  Users,
  ShieldCheck,
  Clock,
  XCircle,
  Layers,
  Activity,
  ArrowUpRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Bell,
  RefreshCw,
} from "lucide-react";

export default function AdminDashboardView({ onNavigateTab }) {
  const { readProvider, network, refreshTrigger, setRefreshTrigger } = useAuth();

  const [metrics, setMetrics] = useState(null);
  const [supply, setSupply] = useState(0n);
  const [reserves, setReserves] = useState(0n);
  const [ratioBps, setRatioBps] = useState(10000);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [mRes, bond, guard] = await Promise.all([
          getAdminMetrics(),
          getContract("BondToken", readProvider, network),
          getContract("ReserveGuard", readProvider, network),
        ]);

        const [sup, res, rat, paused] = await Promise.all([
          bond.totalSupply(),
          guard.reserves().catch(() => ({ amount: 0n })),
          guard.reserveRatioBps().catch(() => 10000n),
          bond.paused().catch(() => false),
        ]);

        if (!cancelled) {
          if (mRes.ok) setMetrics(mRes.data);
          setSupply(sup);
          setReserves(res.amount || 0n);
          setRatioBps(Number(rat));
          setIsPaused(paused);
        }
      } catch (err) {
        console.warn("Could not load admin metrics:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readProvider, network, refreshTrigger]);

  const healthy = ratioBps >= 10000;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Overview Banner */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="badge badge-amber">INSTITUTIONAL CONSOLE</span>
              {isPaused ? (
                <span className="badge badge-rose">Emergency Paused</span>
              ) : (
                <span className="badge badge-emerald">Operational</span>
              )}
            </div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.35rem" }}>
              System Health & Overview
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Comprehensive real-time dashboard of investor onboarding, KYC verification pipeline, and token supply.
            </p>
          </div>

          <button
            className="btn-icon"
            onClick={() => setRefreshTrigger((n) => n + 1)}
            aria-label="Refresh admin metrics"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Top KPI Metrics */}
        <div className="grid-4" style={{ marginTop: "1.5rem" }}>
          <div className="stat-box" style={{ cursor: "pointer" }} onClick={() => onNavigateTab("investors")}>
            <div className="stat-label">
              <span>Total Registered</span>
              <Users size={16} color="#3b82f6" />
            </div>
            <div className="stat-value font-mono">{metrics?.totalUsers ?? "0"}</div>
            <div className="stat-sub">Investor profiles in database</div>
          </div>

          <div
            className="stat-box"
            style={{
              cursor: "pointer",
              borderColor: (metrics?.pendingKyc || 0) > 0 ? "rgba(245, 158, 11, 0.4)" : undefined,
            }}
            onClick={() => onNavigateTab("kyc")}
          >
            <div className="stat-label">
              <span>Pending KYC Queue</span>
              <Clock size={16} color="#f59e0b" />
            </div>
            <div className="stat-value font-mono" style={{ color: (metrics?.pendingKyc || 0) > 0 ? "#f59e0b" : undefined }}>
              {metrics?.pendingKyc ?? "0"}
            </div>
            <div className="stat-sub">Awaiting compliance review</div>
          </div>

          <div className="stat-box" style={{ cursor: "pointer" }} onClick={() => onNavigateTab("investors")}>
            <div className="stat-label">
              <span>Whitelisted Investors</span>
              <ShieldCheck size={16} color="#10b981" />
            </div>
            <div className="stat-value font-mono" style={{ color: "var(--accent-emerald)" }}>
              {metrics?.approvedKyc ?? "0"}
            </div>
            <div className="stat-sub">Approved for on-chain trading</div>
          </div>

          <div className="stat-box">
            <div className="stat-label">
              <span>Active Supply</span>
              <Layers size={16} color="#94a3b8" />
            </div>
            <div className="stat-value font-mono">
              {fmtNumber(fromUnits(supply, BOND_DECIMALS), 0, 0)} CB28
            </div>
            <div className="stat-sub">Total minted debt tokens</div>
          </div>
        </div>
      </div>

      {/* Operational Highlights Grid */}
      <div className="grid-2">
        {/* Reserve Coverage Status */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <Activity size={18} color="#3b82f6" /> Collateral & Reserve Health
              </h3>
              <p className="card-subtitle">Monitored continuously by `ReserveGuard` smart contract.</p>
            </div>
            {healthy ? (
              <span className="badge badge-emerald"><CheckCircle2 size={12} /> Adequate</span>
            ) : (
              <span className="badge badge-rose"><AlertTriangle size={12} /> Undercollateralized</span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", margin: "0.5rem 0" }}>
            <span className="font-mono" style={{ fontSize: "2.4rem", fontWeight: 800, color: healthy ? "#10b981" : "#f43f5e" }}>
              {(ratioBps / 100).toFixed(1)}%
            </span>
            <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              (${fmtNumber(fromUnits(reserves, USDC_DECIMALS), 0, 0)} reported reserves)
            </span>
          </div>

          <div className="gauge-container">
            <div
              className="gauge-fill"
              style={{
                width: `${Math.min(ratioBps / 100, 100)}%`,
                backgroundColor: healthy ? "var(--accent-emerald)" : "var(--accent-rose)",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            <span>Minimum required ratio: 100.0%</span>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigateTab("oracles")}>
              Manage Oracles
            </button>
          </div>
        </div>

        {/* Quick Administrative Actions */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <TrendingUp size={18} color="#f59e0b" /> Operations Quick Jump
              </h3>
              <p className="card-subtitle">Direct shortcuts to privileged institutional operations.</p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <button
              className="btn btn-secondary"
              onClick={() => onNavigateTab("kyc")}
              style={{ justifyContent: "space-between", padding: "0.75rem 1rem" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Clock size={16} color="#f59e0b" />
                <span>Review Pending KYC Submissions ({metrics?.pendingKyc || 0})</span>
              </div>
              <ArrowUpRight size={14} />
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => onNavigateTab("issuance")}
              style={{ justifyContent: "space-between", padding: "0.75rem 1rem" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Layers size={16} color="#3b82f6" />
                <span>Create New Primary Offering Lot</span>
              </div>
              <ArrowUpRight size={14} />
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => onNavigateTab("finance")}
              style={{ justifyContent: "space-between", padding: "0.75rem 1rem" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <ShieldCheck size={16} color="#10b981" />
                <span>Deposit Coupon & Redemption Pool Funds</span>
              </div>
              <ArrowUpRight size={14} />
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => onNavigateTab("audit")}
              style={{ justifyContent: "space-between", padding: "0.75rem 1rem" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Bell size={16} color="#94a3b8" />
                <span>Inspect Regulatory Audit Logs ({metrics?.totalAudits || 0})</span>
              </div>
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Recent Submissions Snippet */}
      {metrics?.recentKyc && metrics.recentKyc.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Recent KYC Submissions</h3>
              <p className="card-subtitle">Latest investor applications awaiting or finalized by compliance.</p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigateTab("kyc")}>
              View All KYC Applications
            </button>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Wallet Address</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {metrics.recentKyc.map((k) => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{k.name}</td>
                    <td className="font-mono">{shortAddr(k.wallet)}</td>
                    <td>{k.country || "United States"}</td>
                    <td>
                      {k.status === "approved" ? (
                        <span className="badge badge-emerald">Approved</span>
                      ) : k.status === "rejected" ? (
                        <span className="badge badge-rose">Rejected</span>
                      ) : (
                        <span className="badge badge-amber">Pending</span>
                      )}
                    </td>
                    <td style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {timeAgo(new Date(k.created_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


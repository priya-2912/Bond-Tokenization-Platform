import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { getAdminInvestors, updateUserRole, getAdminMetrics } from "../../lib/backend";
import { getContract, getAddresses, addressUrl } from "../../contracts/platform";
import { shortAddr, timeAgo, friendlyError } from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../Toast";
import { ConfirmModal } from "../ui";
import {
  ShieldAlert,
  Users,
  Settings,
  Building,
  Wrench,
  Pause,
  Play,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RefreshCw,
  Search,
  Key,
} from "lucide-react";

export default function SuperAdminPanel() {
  const { account, readProvider, signer, network, roles, refreshTrigger, setRefreshTrigger } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [confirmPause, setConfirmPause] = useState(null);
  const [checks, setChecks] = useState([]);
  const [updatingWallet, setUpdatingWallet] = useState(null);

  const addrs = getAddresses(network);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, bond, kyc] = await Promise.all([
        getAdminInvestors({ search, limit: 100 }),
        getContract("BondToken", readProvider, network),
        getContract("KYCRegistry", readProvider, network),
      ]);

      const [paused, marketOk, oracleAddr, distIssuer] = await Promise.all([
        bond.paused().catch(() => false),
        kyc.isVerified(addrs.Marketplace).catch(() => false),
        bond.reserveOracle().catch(() => ethers.ZeroAddress),
        bond.hasRole(ethers.id("ISSUER_ROLE"), addrs.CouponDistributor).catch(() => false),
      ]);

      if (uRes.ok && uRes.data) {
        setUsers(uRes.data.users || []);
      }
      setIsPaused(paused);
      setChecks([
        {
          id: "market",
          ok: marketOk,
          label: "Marketplace Contract Whitelisted",
          why: "Required for bond token escrow during trades",
        },
        {
          id: "oracle",
          ok: oracleAddr.toLowerCase() === addrs.ReserveOracle.toLowerCase(),
          label: "BondToken Points to ReserveOracle",
          why: `Currently ${shortAddr(oracleAddr)}`,
        },
        {
          id: "distributor",
          ok: distIssuer,
          label: "CouponDistributor Has Burn Role",
          why: "Required for redemption at maturity",
        },
      ]);
    } catch (err) {
      console.warn("Super admin load error:", err);
    } finally {
      setLoading(false);
    }
  }, [search, readProvider, network]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const handleRoleChange = async (targetWallet, newRole) => {
    setUpdatingWallet(targetWallet);
    try {
      const res = await updateUserRole(targetWallet, newRole);
      if (!res.ok) throw new Error(res.error || "Role update failed");
      toast.success(`Role for ${shortAddr(targetWallet)} updated to ${newRole.toUpperCase()}`);
      setRefreshTrigger((n) => n + 1);
      loadData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUpdatingWallet(null);
    }
  };

  const handleTogglePause = async () => {
    setConfirmPause(null);
    if (!signer) return toast.warn("Connect your administrator wallet on Sepolia");
    try {
      toast.info(isPaused ? "Unpausing all bond transfers..." : "Pausing all bond transfers...");
      const bond = getContract("BondToken", signer, network);
      const tx = isPaused ? await bond.unpause() : await bond.pause();
      await tx.wait();
      toast.success(isPaused ? "Bond transfers resumed." : "Emergency pause active.");
      setIsPaused(!isPaused);
      setRefreshTrigger((n) => n + 1);
    } catch (err) {
      toast.error(`Pause operation failed: ${friendlyError(err)}`);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Super Admin Header */}
      <div className="card" style={{ borderColor: "rgba(59, 130, 246, 0.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="badge badge-blue">SUPER ADMIN CONSOLE</span>
              <span className="badge badge-emerald">Master Authority</span>
            </div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Governance, Roles & Platform Settings
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Manage system users, assign institutional roles, control emergency circuit breakers, and supervise issuers.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button
              className={`btn ${isPaused ? "btn-emerald" : "btn-rose"} btn-sm`}
              onClick={() =>
                setConfirmPause({
                  title: isPaused ? "Resume Bond Transfers?" : "Trigger Emergency Circuit Breaker?",
                  message: isPaused
                    ? "Resuming will allow investors and secondary orders to execute transfers again."
                    : "Emergency pause will immediately freeze all on-chain bond transfers, trades, mints, and redemptions across Sepolia.",
                  confirmLabel: isPaused ? "Resume Transfers" : "Activate Emergency Pause",
                  danger: !isPaused,
                  onConfirm: handleTogglePause,
                })
              }
            >
              {isPaused ? <Play size={14} /> : <Pause size={14} />}
              <span>{isPaused ? "Resume Transfers" : "Emergency Pause"}</span>
            </button>

            <button className="btn-icon" onClick={loadData} title="Refresh">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Role & User Management Matrix */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              <Users size={18} color="#3b82f6" /> User & Role Delegation Matrix
            </h3>
            <p className="card-subtitle">
              Authorize Compliance Officers and Asset Issuers by assigning permissions to their wallet addresses.
            </p>
          </div>

          <div className="search-input-wrapper" style={{ maxWidth: 320 }}>
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search by name, email, or wallet..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Account / Name</th>
                <th>Wallet Address</th>
                <th>Assigned Role</th>
                <th>KYC Status</th>
                <th style={{ textAlign: "right" }}>Assign Role Permission</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
                    {loading ? "Querying accounts..." : "No accounts found matching search."}
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const url = addressUrl(network, u.wallet);
                  const isMaster = u.wallet.toLowerCase() === "0xc992ddeb354F51EDc472c7FB9D84Db200FaAf5DA".toLowerCase();

                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                          {u.full_name || "Anonymous User"}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{u.email || "No email"}</div>
                      </td>
                      <td className="font-mono">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--accent-blue)", display: "inline-flex", gap: "0.25rem", alignItems: "center" }}
                          >
                            <span>{shortAddr(u.wallet)}</span>
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          shortAddr(u.wallet)
                        )}
                        {isMaster && <span className="badge badge-amber" style={{ marginLeft: "0.4rem" }}>Master</span>}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            u.role === "admin"
                              ? "badge-blue"
                              : u.role === "compliance"
                              ? "badge-emerald"
                              : u.role === "issuer"
                              ? "badge-amber"
                              : "badge"
                          }`}
                          style={{ textTransform: "uppercase", fontSize: "0.7rem" }}
                        >
                          {u.role === "admin"
                            ? "Super Admin"
                            : u.role === "compliance"
                            ? "Compliance Officer"
                            : u.role === "issuer"
                            ? "Asset Issuer"
                            : "Investor"}
                        </span>
                      </td>
                      <td>
                        {u.kyc_status === "approved" ? (
                          <span className="badge badge-emerald">Whitelisted</span>
                        ) : (
                          <span className="badge badge-amber">{u.kyc_status || "Pending"}</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <select
                          className="input-field"
                          value={u.role}
                          disabled={isMaster || updatingWallet === u.wallet}
                          onChange={(e) => handleRoleChange(u.wallet, e.target.value)}
                          style={{
                            width: "auto",
                            display: "inline-block",
                            fontSize: "0.75rem",
                            padding: "0.3rem 0.6rem",
                            background: "var(--bg-card)",
                          }}
                        >
                          <option value="investor">Investor</option>
                          <option value="compliance">Compliance Officer</option>
                          <option value="issuer">Asset Issuer</option>
                          <option value="admin">Super Admin</option>
                        </select>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Platform Settings & System Wiring */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <Wrench size={18} color="#f59e0b" /> Deployment Wiring & Setup Checks
              </h3>
              <p className="card-subtitle">Core smart contract linkage required for platform execution.</p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {checks.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.75rem 1rem",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  {c.ok ? <CheckCircle2 size={18} color="#10b981" /> : <XCircle size={18} color="#f43f5e" />}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{c.label}</div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{c.why}</div>
                  </div>
                </div>
                <span className={`badge ${c.ok ? "badge-emerald" : "badge-rose"}`}>{c.ok ? "Healthy" : "Attention"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <Settings size={18} color="#3b82f6" /> Contract Addresses on Sepolia
              </h3>
              <p className="card-subtitle">Direct links to verified contract code on Etherscan.</p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {Object.entries(addrs)
              .filter(([k, v]) => typeof v === "string" && v.startsWith("0x") && v.length === 42)
              .slice(0, 5)
              .map(([name, addr]) => {
                const link = addressUrl(network, addr);
                return (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.5rem 0.75rem",
                      borderBottom: "1px solid var(--border-subtle)",
                      fontSize: "0.8rem",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{name}</span>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono"
                      style={{ color: "var(--accent-blue)", display: "inline-flex", gap: "0.25rem", alignItems: "center" }}
                    >
                      <span>{shortAddr(addr)}</span>
                      <ExternalLink size={10} />
                    </a>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {confirmPause && <ConfirmModal {...confirmPause} onCancel={() => setConfirmPause(null)} />}
    </div>
  );
}


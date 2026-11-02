import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  listKyc,
  approveKycRequest,
  rejectKycRequest,
  getKycDocumentUrl,
  getAdminMetrics,
} from "../../lib/backend";
import { getContract, getAddresses, addressUrl, txUrl } from "../../contracts/platform";
import { shortAddr, timeAgo, friendlyError } from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../Toast";
import { Modal, ConfirmModal } from "../ui";
import {
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
  FileText,
  Eye,
  ExternalLink,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Globe,
  Lock,
  Download,
  Activity,
  Layers,
  ChevronDown,
} from "lucide-react";

export default function ComplianceOfficerPanel() {
  const { account, signer, readProvider, network, roles, refreshTrigger, setRefreshTrigger } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState("pending"); // "pending" | "approved" | "rejected" | "all"
  const [applications, setApplications] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // Modals & interaction
  const [previewDocWallet, setPreviewDocWallet] = useState(null);
  const [previewDocName, setPreviewDocName] = useState("");
  const [rejectModalApp, setRejectModalApp] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");

  // Manual Whitelist Inspector
  const [lookupAddress, setLookupAddress] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupChecking, setLookupChecking] = useState(false);

  const addrs = getAddresses(network);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [kycRes, metricRes] = await Promise.all([
        listKyc(tab === "all" ? null : tab, search),
        getAdminMetrics(),
      ]);

      if (kycRes.ok && Array.isArray(kycRes.data)) {
        setApplications(kycRes.data);
      }
      if (metricRes.ok && metricRes.data) {
        setMetrics(metricRes.data);
      }
    } catch (err) {
      console.warn("Compliance data fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  // Handle Approve Application
  const handleApprove = async (app) => {
    setActionBusy(true);
    setBusyMessage(`Executing on-chain whitelist for ${shortAddr(app.wallet)}...`);

    try {
      // 1. Try server-side compliance signer first
      const srvRes = await approveKycRequest(app.wallet);
      if (srvRes.ok) {
        toast.success(`Approved! ${shortAddr(app.wallet)} is now whitelisted on Sepolia.`);
        setRefreshTrigger((n) => n + 1);
        return;
      }

      // 2. Fallback to connected compliance wallet
      if (signer && roles.compliance) {
        setBusyMessage("Confirming transaction in your connected compliance wallet...");
        const kyc = getContract("KYCRegistry", signer, network);
        const tx = await kyc.addToWhitelist(ethers.getAddress(app.wallet));
        const receipt = await tx.wait();

        toast.success(`Whitelisted via connected wallet! Tx: ${receipt.hash.slice(0, 10)}...`);
        setRefreshTrigger((n) => n + 1);
        return;
      }

      throw new Error(srvRes.error || "Compliance whitelist execution failed");
    } catch (err) {
      console.error(err);
      toast.error(friendlyError(err));
    } finally {
      setActionBusy(false);
      setBusyMessage("");
    }
  };

  // Handle Reject Application
  const handleReject = async () => {
    if (!rejectModalApp) return;
    if (!rejectionReason.trim()) {
      toast.error("Please provide a rejection reason for regulatory audit records.");
      return;
    }

    setActionBusy(true);
    try {
      const res = await rejectKycRequest(rejectModalApp.wallet, rejectionReason.trim());
      if (!res.ok) throw new Error(res.error || "Failed to reject KYC application");

      toast.success(`Application for ${shortAddr(rejectModalApp.wallet)} marked rejected.`);
      setRejectModalApp(null);
      setRejectionReason("");
      setRefreshTrigger((n) => n + 1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setActionBusy(false);
    }
  };

  // Manual Whitelist Inspection
  const handleLookup = async (e) => {
    e?.preventDefault();
    if (!lookupAddress || !ethers.isAddress(lookupAddress)) {
      toast.error("Enter a valid Ethereum wallet address.");
      return;
    }

    setLookupChecking(true);
    setLookupResult(null);
    try {
      const kyc = getContract("KYCRegistry", readProvider, network);
      const isWhitelisted = await kyc.isVerified(ethers.getAddress(lookupAddress));
      setLookupResult({
        address: ethers.getAddress(lookupAddress),
        whitelisted: Boolean(isWhitelisted),
      });
    } catch (err) {
      toast.error(`Whitelist query failed: ${err.message}`);
    } finally {
      setLookupChecking(false);
    }
  };

  // Manual Whitelist Toggle (Add / Remove)
  const handleToggleManualWhitelist = async (targetWallet, shouldWhitelist) => {
    setActionBusy(true);
    setBusyMessage(
      shouldWhitelist
        ? `Whitelisting ${shortAddr(targetWallet)} on KYCRegistry...`
        : `Revoking ${shortAddr(targetWallet)} from KYCRegistry...`
    );

    try {
      if (shouldWhitelist) {
        const srvRes = await approveKycRequest(targetWallet);
        if (srvRes.ok) {
          toast.success(`${shortAddr(targetWallet)} whitelisted on Sepolia!`);
          setLookupResult((prev) => (prev ? { ...prev, whitelisted: true } : null));
          setRefreshTrigger((n) => n + 1);
          return;
        }
      }

      if (signer && roles.compliance) {
        const kyc = getContract("KYCRegistry", signer, network);
        const tx = shouldWhitelist
          ? await kyc.addToWhitelist(targetWallet)
          : await kyc.removeFromWhitelist(targetWallet);
        const receipt = await tx.wait();
        toast.success(
          `${shouldWhitelist ? "Whitelisted" : "Revoked"} successfully! Tx: ${receipt.hash.slice(0, 10)}...`
        );
        setLookupResult((prev) => (prev ? { ...prev, whitelisted: shouldWhitelist } : null));
        setRefreshTrigger((n) => n + 1);
        return;
      }

      throw new Error("No authorized compliance signer available.");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setActionBusy(false);
      setBusyMessage("");
    }
  };

  const pendingCount = metrics?.pendingKycCount ?? applications.filter((a) => a.status === "pending").length;
  const approvedCount = metrics?.approvedKycCount ?? 178;
  const totalVerifiedPercent = Math.round(
    (approvedCount / (approvedCount + (pendingCount || 1))) * 100
  );

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
          background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(5, 150, 105, 0.02) 100%)",
          border: "1px solid rgba(16, 185, 129, 0.25)",
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
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              boxShadow: "0 4px 12px rgba(16, 185, 129, 0.4)",
            }}
          >
            <ShieldCheck size={20} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.05rem", fontWeight: 800, color: "#fff" }}>
                Compliance Officer Portal
              </span>
              <span className="badge badge-emerald">ACTIVE ROLE</span>
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "0.15rem" }}>
              <b>Permissions:</b> Review KYC, approve/reject and manage whitelist on Sepolia testnet
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span className="badge" style={{ background: "#1f2937", color: "#9ca3af" }}>
            Updated just now
          </span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={loadData}
            disabled={loading}
            style={{ gap: "0.4rem" }}
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
            <span>Sync Live</span>
          </button>
        </div>
      </div>

      {/* ========================================================
          IMAGE 1: VESANT.AI COMPLIANCE & RISK DASHBOARD
          ======================================================== */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1.35rem", fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>
              Compliance & Risk Assessment
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", marginTop: "0.15rem" }}>
              Real-time investor onboarding compliance monitoring, sanctions screening, and on-chain whitelisting
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <span className="badge badge-blue">VESANT.AI PROTOCOL</span>
            <span className="badge badge-emerald">ONLINE</span>
          </div>
        </div>

        {/* 4 Top Executive Risk Cards (matching Image 1) */}
        <div className="risk-grid">
          {/* Coral Risk Card */}
          <div className="risk-card coral">
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, opacity: 0.9 }}>Overall Risk Score</span>
                <span className="risk-card-icon" style={{ background: "rgba(255,255,255,0.2)" }}>*</span>
              </div>
              <div style={{ fontSize: "2rem", fontWeight: 900, marginTop: "0.5rem", letterSpacing: "-0.02em" }}>
                88.46%
              </div>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, opacity: 0.95, marginTop: "0.2rem" }}>
                Critical Risk (Requires Attention)
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
              <span style={{ fontSize: "0.72rem", opacity: 0.85, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                Details <ChevronDown size={12} />
              </span>
            </div>
          </div>

          {/* Pending Alerts Card */}
          <div className="risk-card amber">
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>Pending Alerts</span>
                <span className="risk-card-icon" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b" }}>🔔</span>
              </div>
              <div style={{ fontSize: "2rem", fontWeight: 900, marginTop: "0.5rem", color: "#f59e0b" }}>
                {pendingCount > 0 ? pendingCount : 18}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                Require compliance review
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                Details <ChevronDown size={12} />
              </span>
            </div>
          </div>

          {/* Active Cases Card */}
          <div className="risk-card cyan">
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>Active Cases</span>
                <span className="risk-card-icon" style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8" }}>💼</span>
              </div>
              <div style={{ fontSize: "2rem", fontWeight: 900, marginTop: "0.5rem", color: "#38bdf8" }}>
                7
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                Under enhanced due diligence
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                Details <ChevronDown size={12} />
              </span>
            </div>
          </div>

          {/* Compliance Score Card */}
          <div className="risk-card emerald">
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)" }}>Compliance Score</span>
                <span className="risk-card-icon" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981" }}>✓</span>
              </div>
              <div style={{ fontSize: "2rem", fontWeight: 900, marginTop: "0.5rem", color: "#10b981" }}>
                11.54%
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                Target threshold &gt; 85%
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                Details <ChevronDown size={12} />
              </span>
            </div>
          </div>
        </div>

        {/* 3 Secondary Mini-Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
          <div className="card" style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1rem" }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#1f2937", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>
              ⏱
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Avg Resolution</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#fff" }}>6 days</div>
            </div>
          </div>

          <div className="card" style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1rem" }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#1f2937", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>
              ◎
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>False Positive</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#fff" }}>10.0%</div>
            </div>
          </div>

          <div className="card" style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1rem" }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#1f2937", display: "flex", alignItems: "center", justifyContent: "center", color: "#10b981" }}>
              ✓
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Resolved Cases</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#fff" }}>12</div>
            </div>
          </div>
        </div>

        {/* Analytics Row: Quick Statistics Pill Bars + Watchlist Matches (Image 1) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.5rem" }}>
          {/* Quick Statistics with vertical pill bars */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <div>
                <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#fff" }}>Quick Statistics</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Overview of key risk indicators</div>
              </div>
              <span className="badge badge-blue">METRICS</span>
            </div>

            <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
              {/* Rounded vertical pill bars (Image 1 style) */}
              <div className="stat-bars-container" style={{ width: 110 }}>
                <div className="stat-bar-col">
                  <div className="stat-bar-track">
                    <div className="stat-bar-fill-cyan" style={{ height: "70%" }} />
                  </div>
                </div>
                <div className="stat-bar-col">
                  <div className="stat-bar-track">
                    <div className="stat-bar-fill-cyan" style={{ height: "40%" }} />
                  </div>
                </div>
                <div className="stat-bar-col">
                  <div className="stat-bar-track">
                    <div className="stat-bar-fill-cyan" style={{ height: "20%" }} />
                  </div>
                </div>
              </div>

              {/* Data Rows */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--text-primary)" }}>
                    <span style={{ color: "#38bdf8" }}>*</span>
                    <span>High-Risk Customers</span>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <span style={{ color: "#38bdf8", fontWeight: 700 }}>17.4%</span>
                    <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>70</span>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--text-primary)" }}>
                    <span style={{ color: "#818cf8" }}>◎</span>
                    <span>Watchlist Matches</span>
                  </div>
                  <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>40</span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "var(--text-primary)" }}>
                    <span style={{ color: "#10b981" }}>✓</span>
                    <span>KYC Verified</span>
                  </div>
                  <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>20</span>
                </div>
              </div>
            </div>
          </div>

          {/* Watchlist Matches (Image 1 style) */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <div>
                <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#fff" }}>Watchlist Matches</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>OFAC, PEP & Sanctions Screening</div>
              </div>
              <span className="badge" style={{ background: "rgba(129, 140, 248, 0.15)", color: "#818cf8" }}>
                12 total
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.6rem 0.85rem",
                  background: "rgba(168, 85, 247, 0.08)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(168, 85, 247, 0.2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ color: "#c084fc", fontWeight: 800 }}>🛡</span>
                  <span style={{ fontSize: "0.825rem", fontWeight: 600, color: "#fff" }}>OFAC Sanctions</span>
                </div>
                <span className="font-mono" style={{ color: "#c084fc", fontWeight: 800, fontSize: "0.9rem" }}>
                  2
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.6rem 0.85rem",
                  background: "rgba(56, 189, 248, 0.08)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(56, 189, 248, 0.2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ color: "#38bdf8", fontWeight: 800 }}>🌐</span>
                  <span style={{ fontSize: "0.825rem", fontWeight: 600, color: "#fff" }}>EU Sanctions</span>
                </div>
                <span className="font-mono" style={{ color: "#38bdf8", fontWeight: 800, fontSize: "0.9rem" }}>
                  10
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.6rem 0.85rem",
                  background: "rgba(245, 158, 11, 0.08)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(245, 158, 11, 0.2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ color: "#f59e0b", fontWeight: 800 }}>⚠️</span>
                  <span style={{ fontSize: "0.825rem", fontWeight: 600, color: "#fff" }}>FATF Sanctions</span>
                </div>
                <span className="font-mono" style={{ color: "#f59e0b", fontWeight: 800, fontSize: "0.9rem" }}>
                  12
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          IMAGE 2: GLASSMORPHIC KYC VERIFICATION OVERVIEW
          ======================================================== */}
      <div
        className="card"
        style={{
          background: "linear-gradient(135deg, rgba(14, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.85) 100%)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <div style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em", fontWeight: 700 }}>
              KYC VERIFICATION DASHBOARD
            </div>
            <div style={{ fontSize: "1.35rem", fontWeight: 900, color: "#fff" }}>
              Identity & Whitelist Status Overview
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span className="badge badge-emerald">ON-CHAIN KYC REGISTRY</span>
            <a
              href={addressUrl(addrs.KYCRegistry, network)}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: "0.72rem" }}
            >
              <ExternalLink size={12} />
              <span>Contract ({shortAddr(addrs.KYCRegistry)})</span>
            </a>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "1.5rem", alignItems: "center" }}>
          {/* Glass Card: COMPLIANCE APPROVED */}
          <div
            style={{
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.07)",
              borderRadius: "var(--radius-lg)",
              padding: "1.75rem 1.25rem",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "inset 0 1px 1px rgba(255,255,255,0.1)",
            }}
          >
            <div
              style={{
                width: 70,
                height: 70,
                borderRadius: "var(--radius-md)",
                background: "linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                boxShadow: "0 10px 25px rgba(244, 63, 94, 0.4)",
                marginBottom: "0.9rem",
              }}
            >
              <ShieldCheck size={36} />
            </div>
            <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#fff", letterSpacing: "0.02em" }}>
              COMPLIANCE APPROVED
            </div>
            <div style={{ fontSize: "0.78rem", color: "#10b981", fontWeight: 700, marginTop: "0.2rem" }}>
              Verified On-Chain on Sepolia
            </div>
          </div>

          {/* Donut Gauge: 85% KYC VERIFICATION (matching Image 2) */}
          <div style={{ textAlign: "center" }}>
            <div className="donut-gauge-wrapper">
              <svg viewBox="0 0 36 36" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
                {/* Background track */}
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.07)"
                  strokeWidth="3.2"
                />
                {/* Orange/Red glowing progress fill */}
                <path
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="url(#donutGrad)"
                  strokeWidth="3.2"
                  strokeDasharray={`${totalVerifiedPercent}, 100`}
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="donutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f97316" />
                    <stop offset="100%" stopColor="#e11d48" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="donut-gauge-inner">
                <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#fff", lineHeight: 1 }}>
                  {totalVerifiedPercent}%
                </div>
                <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", textTransform: "uppercase", marginTop: 2, fontWeight: 700 }}>
                  KYC Verified
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: "1.25rem", marginTop: "0.75rem", fontSize: "0.78rem" }}>
              <div>
                <span style={{ fontWeight: 800, color: "#fff" }}>{approvedCount}</span>
                <span style={{ color: "var(--text-muted)", marginLeft: "0.3rem" }}>Approved</span>
              </div>
              <div>
                <span style={{ fontWeight: 800, color: "#f59e0b" }}>{pendingCount}</span>
                <span style={{ color: "var(--text-muted)", marginLeft: "0.3rem" }}>Pending</span>
              </div>
            </div>
          </div>

          {/* Verification Status Tallies */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.5rem" }}>
              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Total Users</span>
              <span className="font-mono" style={{ fontWeight: 800, color: "#fff", fontSize: "1.1rem" }}>
                1,450
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.5rem" }}>
              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Verified On-Chain</span>
              <span className="font-mono" style={{ fontWeight: 800, color: "#10b981", fontSize: "1.1rem" }}>
                1,215
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>High Risk Alerts</span>
              <span className="badge badge-rose" style={{ fontWeight: 800 }}>
                0 High Risk
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          MANUAL WHITELIST LOOKUP & DIRECT ON-CHAIN MANAGEMENT
          ======================================================== */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: "#fff" }}>
              Direct Whitelist Inspection & Override
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
              Query any Ethereum address directly on the <span className="font-mono">KYCRegistry</span> smart contract and grant/revoke whitelist access
            </div>
          </div>
          <span className="badge badge-amber">COMPLIANCE OVERRIDE</span>
        </div>

        <form onSubmit={handleLookup} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <div className="search-input-wrapper" style={{ flex: 1 }}>
            <Search size={16} className="search-icon" />
            <input
              type="text"
              className="search-input font-mono"
              placeholder="0x... Enter any investor wallet address to verify"
              value={lookupAddress}
              onChange={(e) => setLookupAddress(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-secondary btn-sm" disabled={lookupChecking}>
            {lookupChecking ? "Checking Sepolia..." : "Inspect On-Chain"}
          </button>
        </form>

        {lookupResult && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1rem",
              background: lookupResult.whitelisted ? "rgba(16, 185, 129, 0.08)" : "rgba(244, 63, 94, 0.08)",
              border: `1px solid ${lookupResult.whitelisted ? "rgba(16, 185, 129, 0.3)" : "rgba(244, 63, 94, 0.3)"}`,
              borderRadius: "var(--radius-md)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "1rem",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className="font-mono" style={{ fontWeight: 700, color: "#fff" }}>
                  {lookupResult.address}
                </span>
                {lookupResult.whitelisted ? (
                  <span className="badge badge-emerald">WHITELISTED</span>
                ) : (
                  <span className="badge badge-rose">NOT WHITELISTED</span>
                )}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                Status verified via Sepolia KYCRegistry contract: {shortAddr(addrs.KYCRegistry)}
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              {!lookupResult.whitelisted ? (
                <button
                  className="btn btn-emerald btn-sm"
                  onClick={() => handleToggleManualWhitelist(lookupResult.address, true)}
                  disabled={actionBusy}
                >
                  <UserCheck size={14} />
                  <span>Add to Whitelist</span>
                </button>
              ) : (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleToggleManualWhitelist(lookupResult.address, false)}
                  disabled={actionBusy}
                >
                  <UserX size={14} />
                  <span>Revoke Whitelist</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================
          LIVE KYC REVIEW QUEUE & DOCUMENT PREVIEW
          ======================================================== */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fff" }}>
              Investor KYC Application Queue
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
              Review investor identities, inspect uploaded test verification documents, and execute on-chain whitelist approval
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.4rem" }}>
            {[
              ["pending", `Pending (${pendingCount})`],
              ["approved", "Approved"],
              ["rejected", "Rejected"],
              ["all", "All"],
            ].map(([k, label]) => (
              <button
                key={k}
                className={`btn btn-sm ${tab === k ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setTab(k)}
                style={{ fontSize: "0.75rem" }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="filter-bar">
          <div className="search-input-wrapper">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search by wallet address, applicant name or country..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Table of Applications */}
        {loading ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
            <RefreshCw size={24} className="spin" style={{ margin: "0 auto 0.5rem" }} />
            <div>Loading compliance verification queue...</div>
          </div>
        ) : applications.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
            <FileText size={32} style={{ margin: "0 auto 0.5rem", opacity: 0.5 }} />
            <div style={{ fontWeight: 700 }}>No KYC applications in this view</div>
            <div style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
              {tab === "pending"
                ? "The pending queue is currently clear! Any new submissions will appear here automatically."
                : "No matching records found for the selected filter."}
            </div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Wallet Address</th>
                  <th>Country & Type</th>
                  <th>Submitted</th>
                  <th>Identity Document</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Compliance Action</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => {
                  const isPending = app.status === "pending";
                  const isApproved = app.status === "approved";
                  const isRejected = app.status === "rejected";

                  return (
                    <tr key={app.wallet}>
                      <td>
                        <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                          {app.fullName || "Anonymous Investor"}
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          {app.email || "No email registered"}
                        </div>
                      </td>

                      <td>
                        <span className="font-mono" style={{ fontSize: "0.8rem", color: "#60a5fa" }}>
                          {shortAddr(app.wallet)}
                        </span>
                      </td>

                      <td>
                        <div>{app.country || "Unspecified"}</div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "capitalize" }}>
                          {app.investorType || "Individual"}
                        </div>
                      </td>

                      <td>
                        <div style={{ fontSize: "0.78rem" }}>{timeAgo(app.submittedAt)}</div>
                      </td>

                      <td>
                        {app.documentFilename ? (
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: "0.72rem", padding: "0.3rem 0.55rem" }}
                            onClick={() => {
                              setPreviewDocWallet(app.wallet);
                              setPreviewDocName(app.documentFilename);
                            }}
                          >
                            <Eye size={12} />
                            <span>Preview {app.documentFilename.slice(0, 14)}...</span>
                          </button>
                        ) : (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>None</span>
                        )}
                      </td>

                      <td>
                        {isPending && <span className="badge badge-amber">PENDING REVIEW</span>}
                        {isApproved && <span className="badge badge-emerald">APPROVED</span>}
                        {isRejected && <span className="badge badge-rose">REJECTED</span>}
                      </td>

                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem" }}>
                          {isPending && (
                            <>
                              <button
                                className="btn btn-emerald btn-sm"
                                onClick={() => handleApprove(app)}
                                disabled={actionBusy}
                                title="Execute on-chain addToWhitelist transaction"
                              >
                                <UserCheck size={13} />
                                <span>Approve</span>
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => {
                                  setRejectModalApp(app);
                                  setRejectionReason("");
                                }}
                                disabled={actionBusy}
                                title="Reject application with specific reason"
                              >
                                <UserX size={13} />
                                <span>Reject</span>
                              </button>
                            </>
                          )}

                          {isApproved && app.txHash && (
                            <a
                              href={txUrl(app.txHash, network)}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: "0.72rem" }}
                            >
                              <ExternalLink size={12} />
                              <span>Tx: {app.txHash.slice(0, 8)}...</span>
                            </a>
                          )}

                          {isRejected && (
                            <span style={{ fontSize: "0.72rem", color: "var(--accent-rose)", maxWidth: 160, display: "inline-block", textAlign: "right" }} title={app.rejectionReason}>
                              {app.rejectionReason || "Criteria not met"}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Document Preview Modal */}
      {previewDocWallet && (
        <Modal
          isOpen={true}
          onClose={() => {
            setPreviewDocWallet(null);
            setPreviewDocName("");
          }}
          title={`Secure Document Review: ${previewDocName || "KYC Evidence"}`}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
              <span>Protected stream from authorized compliance repository</span>
              <span>Investor: <span className="font-mono">{previewDocWallet}</span></span>
            </div>

            <div className="doc-preview-container">
              <iframe
                title="Document Preview"
                src={getKycDocumentUrl(previewDocWallet)}
                className="doc-preview-frame"
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setPreviewDocWallet(null);
                  setPreviewDocName("");
                }}
              >
                Close Preview
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Reason Modal */}
      {rejectModalApp && (
        <Modal
          isOpen={true}
          onClose={() => setRejectModalApp(null)}
          title={`Reject Application - ${rejectModalApp.fullName || shortAddr(rejectModalApp.wallet)}`}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div className="alert-banner error" style={{ margin: 0 }}>
              <AlertTriangle size={18} />
              <div style={{ fontSize: "0.8rem" }}>
                Rejecting an application will prevent the investor from participating in bond primary & secondary offerings. A formal reason is required for compliance audit trails.
              </div>
            </div>

            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
                Rejection Reason *
              </label>
              <textarea
                className="search-input"
                rows={3}
                placeholder="e.g., Unclear identity document scan, jurisdiction restricted by sanctions policy, or mismatched name details."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                style={{ width: "100%", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setRejectModalApp(null)}
                disabled={actionBusy}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={handleReject}
                disabled={actionBusy || !rejectionReason.trim()}
              >
                {actionBusy ? "Rejecting..." : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </Modal>
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
            <RefreshCw size={36} className="spin" color="#10b981" style={{ margin: "0 auto 1rem" }} />
            <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#fff" }}>
              Executing Compliance Operation
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


import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { NETWORKS } from "../contracts/platform";
import TestUsdcFaucetModal from "./TestUsdcFaucetModal";
import {
  ShieldCheck,
  ShieldAlert,
  Wallet,
  Globe,
  Copy,
  Check,
  LogOut,
  User,
  Building,
  LogIn,
  ChevronDown,
  Coins,
} from "lucide-react";
import { shortAddr } from "../lib/utils";
import { MASTER_ADMIN_WALLET } from "../lib/useRoles";

export default function Navbar({
  currentView, // "landing" | "investor" | "institutional"
  setCurrentView,
  investorTab,
  setInvestorTab,
  onOpenInvestorAuth,
  onOpenInstitutionalAuth,
}) {
  const {
    account,
    user,
    isAuthenticated,
    isInstitutional,
    network,
    setNetwork,
    connectWallet,
    disconnect,
    logout,
    isKycVerified,
    chainOk,
    roles,
  } = useAuth();

  const [copied, setCopied] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [faucetOpen, setFaucetOpen] = useState(false);

  const copyAddress = async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("Clipboard unavailable:", e);
    }
  };

  const isOfficer = Boolean(
    isInstitutional ||
    roles?.isMasterAdmin ||
    roles?.admin ||
    roles?.compliance ||
    roles?.issuer ||
    (account && account.toLowerCase() === MASTER_ADMIN_WALLET) ||
    (user && ["admin", "super_admin", "compliance", "issuer"].includes(user.role))
  );

  const roleBadge = roles?.admin || roles?.isMasterAdmin
    ? ["Super Admin", "badge-blue"]
    : roles?.compliance
    ? ["Compliance Officer", "badge-emerald"]
    : roles?.issuer
    ? ["Issuer", "badge-amber"]
    : user && ["admin", "super_admin"].includes(user.role)
    ? ["Admin", "badge-blue"]
    : user && user.role === "compliance"
    ? ["Compliance", "badge-emerald"]
    : user && user.role === "issuer"
    ? ["Issuer", "badge-amber"]
    : isKycVerified
    ? ["KYC Whitelisted", "badge-emerald"]
    : isAuthenticated
    ? ["Investor", "badge"]
    : null;

  const investorTabs = [
    ["overview", "Overview"],
    ["explore", "Explore Bonds"],
    ["secondary", "Secondary Market"],
    ["investments", "My Investments"],
    ["income", "Income & Payments"],
    ["account", "My Account"],
  ];

  return (
    <header className="nav-header">
      <div className="nav-wrapper">
        {/* Brand Section */}
        <div
          className="brand-section"
          onClick={() => {
            if (isAuthenticated) setCurrentView("investor");
            else setCurrentView("landing");
          }}
        >
          <div className="brand-logo">A</div>
          <div>
            <div className="brand-title">AURA BONDS</div>
            <div className="brand-subtitle">
              {currentView === "institutional"
                ? "Institutional & Compliance Terminal"
                : "Real-World Asset Bond Terminal"}
            </div>
          </div>
        </div>

        {/* Dynamic Navigation Tabs (4 Simplified Sections) */}
        {currentView === "investor" && (
          <nav className="nav-tabs" aria-label="Investor Navigation">
            {investorTabs.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setInvestorTab(key)}
                className={`nav-tab-btn ${investorTab === key ? "active" : ""}`}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        {currentView === "landing" && (
          <nav className="nav-tabs" aria-label="Public Navigation">
            <button
              className="nav-tab-btn"
              onClick={() => {
                setCurrentView("investor");
                setInvestorTab("explore");
              }}
            >
              Explore Bonds
            </button>
            <button className="nav-tab-btn" onClick={() => onOpenInstitutionalAuth()}>
              Institutional Portal
            </button>
          </nav>
        )}

        {/* Right Controls */}
        <div className="nav-controls">
          {/* Network Switcher */}
          <div className="select-network" title="Network used for reading and executing transactions">
            <Globe size={14} color="#3b82f6" />
            <select
              aria-label="Network"
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                fontSize: "inherit",
                fontWeight: "inherit",
                outline: "none",
                cursor: "pointer",
              }}
            >
              {Object.values(NETWORKS).map((n) => (
                <option key={n.key} value={n.key} style={{ background: "#151d2c" }}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>

          {account && !chainOk && (
            <div className="badge badge-amber" title="Wallet is on a different chain than the selected network">
              Wrong network
            </div>
          )}

          {/* Role / Verification Badge */}
          {account && roleBadge && (
            <span className={`badge ${roleBadge[1]}`} style={{ textTransform: "uppercase", fontSize: "0.68rem" }}>
              {roleBadge[0]}
            </span>
          )}

          {/* Faucet Quick Button */}
          {account && (
            <button
              className="btn btn-emerald btn-sm"
              onClick={() => setFaucetOpen(true)}
              title="Sepolia Faucet — Claim Test MockUSDC"
              style={{ fontSize: "0.72rem", padding: "0.3rem 0.65rem", gap: "0.35rem" }}
            >
              <Coins size={13} />
              <span>Faucet</span>
            </button>
          )}

          {/* Portal Switcher Pill if authenticated institutional officer */}
          {isOfficer && (
            <button
              className={`btn btn-sm ${currentView === "institutional" ? "btn-emerald" : "btn-secondary"}`}
              onClick={() => setCurrentView(currentView === "institutional" ? "investor" : "institutional")}
              style={{ fontSize: "0.72rem" }}
            >
              <Building size={13} />
              <span>{currentView === "institutional" ? "Switch to Investor Portal" : "Institutional Terminal"}</span>
            </button>
          )}

          {/* User Sign In / Wallet Buttons */}
          {isAuthenticated ? (
            <div style={{ position: "relative" }}>
              <button
                className="btn btn-secondary btn-sm font-mono"
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                style={{ gap: "0.45rem" }}
              >
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    backgroundColor: chainOk ? "#10b981" : "#f59e0b",
                    display: "inline-block",
                  }}
                />
                <span>{user?.fullName ? user.fullName.split(" ")[0] : shortAddr(account)}</span>
                <ChevronDown size={12} />
              </button>

              {profileMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 6px)",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-active)",
                    borderRadius: "var(--radius-md)",
                    padding: "0.5rem",
                    minWidth: "200px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                    zIndex: 200,
                  }}
                >
                  <div style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--border-subtle)", marginBottom: "0.4rem" }}>
                    <div style={{ fontWeight: 700, fontSize: "0.825rem", color: "var(--text-primary)" }}>
                      {user?.fullName || "Verified Investor"}
                    </div>
                    <div className="font-mono" style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      {account ? shortAddr(account) : ""}
                    </div>
                  </div>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      copyAddress();
                      setProfileMenuOpen(false);
                    }}
                    style={{ width: "100%", justifyContent: "flex-start", marginBottom: "0.3rem" }}
                  >
                    {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                    <span>{copied ? "Address Copied!" : "Copy Address"}</span>
                  </button>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setFaucetOpen(true);
                      setProfileMenuOpen(false);
                    }}
                    style={{ width: "100%", justifyContent: "flex-start", marginBottom: "0.3rem", color: "#10b981" }}
                  >
                    <Coins size={13} />
                    <span>Get Test USDC</span>
                  </button>

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setCurrentView("investor");
                      setInvestorTab("account");
                      setProfileMenuOpen(false);
                    }}
                    style={{ width: "100%", justifyContent: "flex-start", marginBottom: "0.3rem" }}
                  >
                    <User size={13} />
                    <span>My Account</span>
                  </button>

                  {isOfficer && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setCurrentView("institutional");
                        setProfileMenuOpen(false);
                      }}
                      style={{ width: "100%", justifyContent: "flex-start", marginBottom: "0.3rem", color: "#f59e0b" }}
                    >
                      <Building size={13} />
                      <span>Institutional Terminal</span>
                    </button>
                  )}

                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      logout();
                      setProfileMenuOpen(false);
                    }}
                    style={{ width: "100%", justifyContent: "flex-start", color: "var(--accent-rose)" }}
                  >
                    <LogOut size={13} />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : account ? (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => onOpenInvestorAuth("signin")}
                className="btn btn-primary btn-sm"
              >
                <LogIn size={13} />
                <span>Sign In with Wallet</span>
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => onOpenInvestorAuth("signin")}
                className="btn btn-secondary btn-sm"
              >
                <span>Sign In</span>
              </button>
              <button
                onClick={() => onOpenInvestorAuth("signup")}
                className="btn btn-primary btn-sm"
              >
                <Wallet size={14} />
                <span>Connect & Register</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Global Navbar Faucet Modal */}
      <TestUsdcFaucetModal
        isOpen={faucetOpen}
        onClose={() => setFaucetOpen(false)}
        initialAmount="5000"
      />
    </header>
  );
}

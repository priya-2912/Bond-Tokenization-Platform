import React from "react";
import { ShieldCheck, ShieldAlert, Wallet, Globe, Copy, Check, UserCheck, Shield } from "lucide-react";

export default function Navbar({
  account,
  network,
  setNetwork,
  connectWallet,
  isKycVerified,
  userRoles,
  activeTab,
  setActiveTab
}) {
  const [copied, setCopied] = React.useState(false);

  const copyAddress = () => {
    if (!account) return;
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getRoleLabel = () => {
    if (!userRoles) return null;
    if (userRoles.isAdmin) return { label: "Admin", class: "badge-blue" };
    if (userRoles.isCompliance) return { label: "Compliance", class: "badge-emerald" };
    if (userRoles.isIssuer) return { label: "Issuer", class: "badge-amber" };
    return { label: "Investor", class: "badge" };
  };

  const roleInfo = getRoleLabel();

  return (
    <header className="nav-header">
      <div className="nav-wrapper">
        {/* Brand */}
        <div className="brand-section" onClick={() => setActiveTab("investor")}>
          <div className="brand-logo">B</div>
          <div>
            <div className="brand-title">AURA BONDS</div>
            <div className="brand-subtitle">Institutional RWA Debt Terminal</div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="nav-tabs">
          <button
            onClick={() => setActiveTab("investor")}
            className={`nav-tab-btn ${activeTab === "investor" ? "active" : ""}`}
          >
            Investor Portfolio
          </button>
          <button
            onClick={() => setActiveTab("marketplace")}
            className={`nav-tab-btn ${activeTab === "marketplace" ? "active" : ""}`}
          >
            Secondary Market
          </button>
          <button
            onClick={() => setActiveTab("admin")}
            className={`nav-tab-btn ${activeTab === "admin" ? "active" : ""}`}
          >
            Issuer & Compliance
          </button>
          <button
            onClick={() => setActiveTab("transparency")}
            className={`nav-tab-btn ${activeTab === "transparency" ? "active" : ""}`}
          >
            Audit & Oracles
          </button>
        </nav>

        {/* Controls */}
        <div className="nav-controls">
          {/* Network Switcher */}
          <div className="select-network">
            <Globe size={14} color="#3b82f6" />
            <select
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
              <option value="localhost" style={{ background: "#151d2c" }}>Localhost (8545)</option>
              <option value="sepolia" style={{ background: "#151d2c" }}>Sepolia Testnet</option>
            </select>
          </div>

          {/* Role Badge (if connected) */}
          {account && roleInfo && (
            <span className={`badge ${roleInfo.class}`} style={{ textTransform: "uppercase", fontSize: "0.68rem" }}>
              {roleInfo.label}
            </span>
          )}

          {/* KYC Status Badge */}
          {account && (
            <div className={`badge ${isKycVerified ? "badge-emerald" : "badge-amber"}`}>
              {isKycVerified ? (
                <>
                  <ShieldCheck size={14} />
                  <span>KYC Verified</span>
                </>
              ) : (
                <>
                  <ShieldAlert size={14} />
                  <span>KYC Pending</span>
                </>
              )}
            </div>
          )}

          {/* Wallet Address / Connect */}
          {account ? (
            <button
              onClick={copyAddress}
              className="btn btn-secondary btn-sm font-mono"
              title="Click to copy full address"
              style={{ gap: "0.4rem" }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: "#10b981",
                  display: "inline-block",
                }}
              ></span>
              <span>{account.slice(0, 6)}...{account.slice(-4)}</span>
              {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} color="#94a3b8" />}
            </button>
          ) : (
            <button onClick={connectWallet} className="btn btn-primary btn-sm">
              <Wallet size={14} />
              <span>Connect Wallet</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

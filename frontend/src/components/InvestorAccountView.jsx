import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import KycApplication from "./KycApplication";
import InvestorProfile from "./InvestorProfile";
import TestUsdcFaucetModal from "./TestUsdcFaucetModal";
import {
  User,
  ShieldCheck,
  ShieldAlert,
  Wallet,
  Settings,
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  Coins,
} from "lucide-react";
import { shortAddr, fmtNumber, fromUnits } from "../lib/utils";
import { addressUrl, NETWORKS, USDC_DECIMALS, BOND_DECIMALS } from "../contracts/platform";

export default function InvestorAccountView({ onNavigateToExplore }) {
  const {
    account,
    user,
    network,
    isKycVerified,
    chainOk,
    refreshTrigger,
    setRefreshTrigger,
  } = useAuth();

  const [activeSubTab, setActiveSubTab] = useState(isKycVerified ? "profile" : "verification");
  const [copied, setCopied] = useState(false);
  const [faucetOpen, setFaucetOpen] = useState(false);

  // Determine onboarding step progress
  // Step 1: Profile created (user?.fullName)
  // Step 2: Verification submitted
  // Step 3: Compliance approval (isKycVerified)
  // Step 4: First investment
  const step1Done = Boolean(user?.fullName || account);
  const step2Done = Boolean(user?.kycStatus === "pending" || isKycVerified);
  const step3Done = Boolean(isKycVerified);

  const copyAddress = async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const explorerUrl = account ? addressUrl(network, account) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem", maxWidth: 1080, margin: "0 auto" }}>
      {/* Onboarding Checklist Banner */}
      <div
        className="card"
        style={{
          background: "linear-gradient(135deg, rgba(21, 29, 44, 0.95) 0%, rgba(15, 23, 42, 0.9) 100%)",
          border: "1px solid var(--border-active)",
          padding: "1.5rem 1.75rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>
              Investor Onboarding Progress
            </div>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginTop: "0.2rem" }}>
              {isKycVerified ? "Your Account is Fully Verified" : "Complete Account Setup to Begin Investing"}
            </h2>
          </div>
          {isKycVerified ? (
            <span className="badge badge-emerald" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}>
              <ShieldCheck size={14} /> Ready to Invest
            </span>
          ) : (
            <span className="badge badge-amber" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}>
              <Clock size={14} /> Verification In Progress
            </span>
          )}
        </div>

        {/* 4 Step Progress Tracker */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
          {/* Step 1 */}
          <div
            style={{
              padding: "0.85rem",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-secondary)",
              border: `1px solid ${step1Done ? "rgba(16, 185, 129, 0.3)" : "var(--border-subtle)"}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              {step1Done ? <CheckCircle2 size={15} color="#10b981" /> : <div className="step-circle active">1</div>}
              <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>1. Create Profile</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {step1Done ? "Personal information recorded" : "Enter name and country"}
            </div>
          </div>

          {/* Step 2 */}
          <div
            style={{
              padding: "0.85rem",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-secondary)",
              border: `1px solid ${step2Done ? "rgba(16, 185, 129, 0.3)" : "var(--border-subtle)"}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              {step2Done ? <CheckCircle2 size={15} color="#10b981" /> : <div className="step-circle">2</div>}
              <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>2. Identity Verification</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {step2Done ? "Document submitted" : "Upload sample ID document"}
            </div>
          </div>

          {/* Step 3 */}
          <div
            style={{
              padding: "0.85rem",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-secondary)",
              border: `1px solid ${step3Done ? "rgba(16, 185, 129, 0.3)" : "var(--border-subtle)"}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              {step3Done ? <CheckCircle2 size={15} color="#10b981" /> : <div className="step-circle">3</div>}
              <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>3. Compliance Whitelist</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {step3Done ? "Whitelisted on KYCRegistry" : "Compliance officer review"}
            </div>
          </div>

          {/* Step 4 */}
          <div
            style={{
              padding: "0.85rem",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              <div className="step-circle">4</div>
              <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>4. Bond Subscription</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Subscribe to primary debt offerings
            </div>
          </div>
        </div>
      </div>

      {/* Account Section Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.5rem" }}>
        <button
          className={`btn btn-sm ${activeSubTab === "profile" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveSubTab("profile")}
          style={{ gap: "0.4rem" }}
        >
          <User size={14} />
          <span>Profile Details</span>
        </button>

        <button
          className={`btn btn-sm ${activeSubTab === "verification" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveSubTab("verification")}
          style={{ gap: "0.4rem" }}
        >
          <ShieldCheck size={14} />
          <span>Identity Verification (KYC)</span>
          {isKycVerified && <span className="badge badge-emerald" style={{ fontSize: "0.6rem", padding: "0.1rem 0.4rem" }}>Verified</span>}
        </button>

        <button
          className={`btn btn-sm ${activeSubTab === "wallet" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveSubTab("wallet")}
          style={{ gap: "0.4rem" }}
        >
          <Wallet size={14} />
          <span>Connected Wallet & Test Funds</span>
        </button>
      </div>

      {/* Tab Content 1: Profile Details */}
      {activeSubTab === "profile" && (
        <InvestorProfile onNavigateToKyc={() => setActiveSubTab("verification")} />
      )}

      {/* Tab Content 2: Identity & KYC Verification */}
      {activeSubTab === "verification" && (
        <KycApplication
          account={account}
          isKycVerified={isKycVerified}
          refreshTrigger={refreshTrigger}
          onDone={() => setRefreshTrigger((n) => n + 1)}
        />
      )}

      {/* Tab Content 3: Connected Wallet & Test Funds */}
      {activeSubTab === "wallet" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="card">
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              Connected Wallet Details
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
              Your Ethereum address acts as your primary account identifier and custody address for bond tokens.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-secondary)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                    Wallet Address
                  </div>
                  <div className="font-mono" style={{ fontSize: "0.95rem", fontWeight: 600, marginTop: "0.2rem" }}>
                    {account || "No wallet connected"}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button onClick={copyAddress} className="btn btn-secondary btn-sm" title="Copy address">
                    {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                  {explorerUrl && (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary btn-sm"
                      title="View on Etherscan"
                    >
                      <ExternalLink size={13} />
                      <span>Etherscan</span>
                    </a>
                  )}
                </div>
              </div>

              <div
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-secondary)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                    Network
                  </div>
                  <div style={{ fontSize: "0.95rem", fontWeight: 600, marginTop: "0.2rem" }}>
                    {NETWORKS[network]?.label || network}
                  </div>
                </div>
                <span className={`badge ${chainOk ? "badge-emerald" : "badge-amber"}`}>
                  {chainOk ? "Connected & Synchronized" : "Wrong Network"}
                </span>
              </div>
            </div>
          </div>

          {/* Test Funds Box */}
          <div className="card" style={{ background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(21, 29, 44, 0.95) 100%)", border: "1px solid rgba(16, 185, 129, 0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <h4 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>
                  Need Testnet Funds?
                </h4>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem", maxWidth: 500 }}>
                  You can claim test MockUSDC directly to your connected wallet to participate in bond offerings and test payouts.
                </p>
              </div>

              <button
                onClick={() => setFaucetOpen(true)}
                className="btn btn-emerald"
                style={{ gap: "0.4rem" }}
              >
                <Coins size={15} />
                <span>Get Test USDC</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Faucet Modal */}
      <TestUsdcFaucetModal
        isOpen={faucetOpen}
        onClose={() => setFaucetOpen(false)}
        initialAmount="5000"
        onSuccess={() => setRefreshTrigger((n) => n + 1)}
      />
    </div>
  );
}


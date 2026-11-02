import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import { User, Mail, Phone, Globe, Shield, ShieldCheck, ShieldAlert, Copy, Check, ExternalLink, Save } from "lucide-react";
import { addressUrl, NETWORKS } from "../contracts/platform";

export default function InvestorProfile({ onNavigateToKyc }) {
  const { user, account, network, isKycVerified, kycData, updateUserProfile } = useAuth();
  const toast = useToast();

  const [fullName, setFullName] = useState(user?.fullName || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [country, setCountry] = useState(user?.country || "United States");
  const [investorType, setInvestorType] = useState(user?.investorType || "Individual");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || "");
      setEmail(user.email || "");
      setPhone(user.phone || "");
      setCountry(user.country || "United States");
      setInvestorType(user.investorType || "Individual");
    }
  }, [user]);

  // Calculate profile completeness score
  const fields = [fullName, email, phone, country, investorType, account];
  const filledCount = fields.filter(Boolean).length;
  const completionPct = Math.round((filledCount / fields.length) * 100);

  const handleCopy = async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.info("Wallet address copied to clipboard");
    } catch {}
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateUserProfile({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        country,
        investorType,
      });
      toast.success("Investor profile updated successfully");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const explorerLink = account ? addressUrl(network, account) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Header Card */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="badge badge-blue">ACCOUNT & SECURITY</span>
              {isKycVerified ? (
                <span className="badge badge-emerald">
                  <ShieldCheck size={12} /> Verified Investor
                </span>
              ) : (
                <span className="badge badge-amber">
                  <ShieldAlert size={12} /> Verification Required
                </span>
              )}
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>
              {user?.fullName || "Investor Profile"}
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Manage your verified investor identity, legal residency, and regulatory categorization.
            </p>
          </div>

          {!isKycVerified && (
            <button className="btn btn-primary btn-sm" onClick={onNavigateToKyc}>
              <Shield size={14} />
              <span>Complete KYC Application</span>
            </button>
          )}
        </div>

        {/* Profile Completeness Bar */}
        <div style={{ marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", fontWeight: 600 }}>
            <span style={{ color: "var(--text-secondary)" }}>Profile Completeness</span>
            <span style={{ color: completionPct === 100 ? "#10b981" : "#3b82f6" }}>{completionPct}%</span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${completionPct}%` }} />
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
            {completionPct === 100
              ? "Your investor profile is complete."
              : "Complete your profile to unlock full investment allocations and automated tax reporting."}
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* Profile Information Form */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <User size={18} color="#3b82f6" /> Personal & Legal Details
              </h3>
              <p className="card-subtitle">Information stored securely off-chain in encrypted storage.</p>
            </div>
          </div>

          <form onSubmit={handleSave}>
            <div className="input-group">
              <label className="input-label" htmlFor="profName">Full Legal Name</label>
              <input
                id="profName"
                className="input-field"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="As shown on official ID"
                required
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="profEmail">Email Address</label>
              <input
                id="profEmail"
                type="email"
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="profPhone">Contact Phone Number</label>
              <input
                id="profPhone"
                type="tel"
                className="input-field"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 019-2834"
              />
            </div>

            <div className="grid-2" style={{ gap: "0.75rem" }}>
              <div className="input-group">
                <label className="input-label" htmlFor="profCountry">Country of Residence</label>
                <select
                  id="profCountry"
                  className="input-field"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  <option value="United States">United States</option>
                  <option value="United Kingdom">United Kingdom</option>
                  <option value="Singapore">Singapore</option>
                  <option value="Switzerland">Switzerland</option>
                  <option value="Germany">Germany</option>
                  <option value="United Arab Emirates">United Arab Emirates</option>
                  <option value="Canada">Canada</option>
                  <option value="Australia">Australia</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="profType">Investor Type</label>
                <select
                  id="profType"
                  className="input-field"
                  value={investorType}
                  onChange={(e) => setInvestorType(e.target.value)}
                >
                  <option value="Individual">Individual Investor</option>
                  <option value="Accredited">Accredited Investor</option>
                  <option value="Institutional">Institutional / Fund</option>
                  <option value="Family Office">Family Office</option>
                </select>
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: "1rem", width: "100%" }}>
              <Save size={14} />
              <span>{saving ? "Saving Changes..." : "Save Profile Details"}</span>
            </button>
          </form>
        </div>

        {/* Regulatory & Web3 Identifier Details */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="card">
            <div className="card-header">
              <div>
                <h3 className="card-title">
                  <ShieldCheck size={18} color="#10b981" /> Web3 Identity & Whitelist
                </h3>
                <p className="card-subtitle">Verified smart contract address and on-chain permissions.</p>
              </div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                Whitelisted Wallet Address
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.6rem 0.85rem",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  marginTop: "0.35rem",
                }}
              >
                <span className="font-mono" style={{ fontSize: "0.85rem" }}>
                  {account ? `${account.slice(0, 10)}...${account.slice(-8)}` : "No wallet connected"}
                </span>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button className="btn-icon" onClick={handleCopy} title="Copy full address">
                    {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                  </button>
                  {explorerLink && (
                    <a href={explorerLink} target="_blank" rel="noopener noreferrer" className="btn-icon" title="View on Etherscan">
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid var(--border-subtle)", fontSize: "0.825rem" }}>
                <span style={{ color: "var(--text-secondary)" }}>Network</span>
                <span style={{ fontWeight: 600 }}>{NETWORKS[network]?.label || network}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid var(--border-subtle)", fontSize: "0.825rem" }}>
                <span style={{ color: "var(--text-secondary)" }}>On-Chain KYC Whitelist</span>
                <span>
                  {isKycVerified ? (
                    <span className="badge badge-emerald">Whitelisted</span>
                  ) : (
                    <span className="badge badge-amber">Unverified</span>
                  )}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", fontSize: "0.825rem" }}>
                <span style={{ color: "var(--text-secondary)" }}>Application Status</span>
                <span style={{ textTransform: "capitalize", fontWeight: 600 }}>
                  {kycData?.status === "approved" ? (
                    <span style={{ color: "#10b981" }}>Approved</span>
                  ) : kycData?.status === "pending" ? (
                    <span style={{ color: "#f59e0b" }}>Pending Review</span>
                  ) : kycData?.status === "rejected" ? (
                    <span style={{ color: "#f43f5e" }}>Rejected</span>
                  ) : (
                    "Not Submitted"
                  )}
                </span>
              </div>
            </div>
          </div>

          <div
            className="card"
            style={{
              background: "rgba(30, 58, 138, 0.15)",
              borderColor: "rgba(59, 130, 246, 0.25)",
            }}
          >
            <h4 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.35rem" }}>
              Regulatory Disclaimer
            </h4>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.78rem", lineHeight: 1.5 }}>
              This platform provides tokenized debt securities under applicable testnet regulatory exemptions.
              All offerings require valid KYC accreditation. Transactions are settled in test MockUSDC and are not an
              unregistered public offering of securities.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


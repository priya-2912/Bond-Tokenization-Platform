import React, { useState, useEffect, useCallback } from "react";
import { submitKyc, getKycStatus, ID_FILE_LIMIT, ID_FILE_TYPES, BACKEND_URL } from "../lib/backend";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import { txUrl } from "../contracts/platform";
import {
  ShieldCheck,
  ShieldAlert,
  FileText,
  UserCheck,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Clock,
  XCircle,
} from "lucide-react";

const STEPS = ["Personal Details", "Document Upload", "Compliance Review", "Whitelisted"];

export default function KycApplication({ account, isKycVerified, refreshTrigger, onDone }) {
  const { user, network } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(user?.fullName || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [country, setCountry] = useState(user?.country || "United States");
  const [investorType, setInvestorType] = useState(user?.investorType || "Individual");
  const [file, setFile] = useState(null);
  const [dummyOk, setDummyOk] = useState(false);
  const [remote, setRemote] = useState({ status: "none", unreachable: false, data: null });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadStatus = useCallback(async () => {
    if (!account) return;
    const r = await getKycStatus(account);
    if (r.ok) {
      setRemote({ status: r.data.status, unreachable: false, data: r.data });
      if (r.data.name && !name) setName(r.data.name);
    } else if (r.unreachable) {
      setRemote({ status: "none", unreachable: true, data: null });
    } else {
      setRemote({ status: "none", unreachable: false, data: null }); // 404: no application yet
    }
  }, [account]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus, refreshTrigger]);

  // While application is pending, poll periodically
  useEffect(() => {
    if (remote.status !== "pending" || isKycVerified) return undefined;
    const t = setInterval(() => {
      loadStatus();
      if (onDone) onDone();
    }, 10000);
    return () => clearInterval(t);
  }, [remote.status, isKycVerified, loadStatus, onDone]);

  // Determine current stepper stage (1 to 4)
  let currentStep = 1;
  if (isKycVerified) currentStep = 4;
  else if (remote.status === "pending") currentStep = 3;
  else if (file) currentStep = 2;

  const onFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    setMsg(null);
    if (!f) return setFile(null);
    if (!ID_FILE_TYPES.includes(f.type)) {
      setFile(null);
      return setMsg({ type: "error", text: "Please choose a valid PDF, JPG, or PNG document." });
    }
    if (f.size > ID_FILE_LIMIT) {
      setFile(null);
      return setMsg({ type: "error", text: `File size exceeds the 5 MB limit (${(f.size / (1024 * 1024)).toFixed(1)} MB).` });
    }
    setFile(f);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg(null);

    if (name.trim().length < 2) {
      return setMsg({ type: "error", text: "Please enter your full legal name (min 2 characters)." });
    }
    if (!file && remote.status !== "rejected") {
      return setMsg({ type: "error", text: "Please attach a sample identity document (PDF / JPG / PNG)." });
    }
    if (!dummyOk) {
      return setMsg({ type: "error", text: "Please acknowledge that you are using dummy test data on this testnet prototype." });
    }

    setSubmitting(true);
    const r = await submitKyc({
      wallet: account,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      country,
      investorType,
      file,
    });
    setSubmitting(false);

    if (r.ok) {
      setMsg({ type: "success", text: "KYC application submitted. Compliance officers will review your submission." });
      toast.success("KYC submission uploaded. Status: Pending Review");
      setFile(null);
      setDummyOk(false);
      loadStatus();
      if (onDone) onDone();
    } else if (r.unreachable) {
      setMsg({
        type: "error",
        text: `The KYC backend service is not reachable (${r.error}). Make sure backend is running on http://localhost:4000.`,
      });
      toast.error("KYC backend service offline");
    } else {
      setMsg({ type: "error", text: r.error });
      toast.error(r.error);
    }
  };

  const txLink = remote.data?.tx_hash ? txUrl(network, remote.data.tx_hash) : null;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span className="badge badge-blue">REGULATORY CLEARANCE</span>
            {isKycVerified ? (
              <span className="badge badge-emerald">On-Chain Whitelisted</span>
            ) : remote.status === "pending" ? (
              <span className="badge badge-amber">Under Review</span>
            ) : remote.status === "rejected" ? (
              <span className="badge badge-rose">Application Rejected</span>
            ) : (
              <span className="badge badge-amber">Action Required</span>
            )}
          </div>
          <h3 className="card-title" style={{ marginTop: "0.4rem" }}>
            {isKycVerified ? <ShieldCheck size={20} color="#10b981" /> : <UserCheck size={20} color="#3b82f6" />}
            <span>Investor KYC & Accreditation Verification</span>
          </h3>
          <p className="card-subtitle">
            Tokenized fixed-income debt requires verified wallet whitelisting per institutional compliance standards.
          </p>
        </div>
      </div>

      {/* Modern Stepper */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "1rem 0 1.75rem 0" }} aria-label="KYC progress">
        {STEPS.map((label, i) => {
          const stepNum = i + 1;
          const isDone = currentStep > stepNum || (stepNum === 4 && isKycVerified);
          const isActive = currentStep === stepNum;
          return (
            <React.Fragment key={label}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    background: isDone ? "var(--accent-emerald)" : isActive ? "var(--accent-blue)" : "var(--bg-input)",
                    color: isDone || isActive ? "#fff" : "var(--text-muted)",
                    border: "1px solid var(--border-active)",
                    boxShadow: isActive ? "0 0 10px rgba(59, 130, 246, 0.4)" : "none",
                  }}
                >
                  {isDone ? "✓" : stepNum}
                </span>
                <span
                  style={{
                    fontSize: "0.8rem",
                    color: isDone || isActive ? "var(--text-primary)" : "var(--text-muted)",
                    fontWeight: isDone || isActive ? 700 : 500,
                  }}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: "var(--border-active)", minWidth: 16 }} />}
            </React.Fragment>
          );
        })}
      </div>

      {/* State A: Wallet not connected */}
      {!account && (
        <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
          Please connect your MetaMask wallet to submit or check your KYC verification.
        </div>
      )}

      {/* State B: Already Whitelisted On-Chain */}
      {account && isKycVerified && (
        <div
          style={{
            padding: "1.25rem",
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid var(--accent-emerald-border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <CheckCircle2 size={24} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <h4 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)" }}>
                Your Wallet is KYC Verified and Whitelisted
              </h4>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginTop: "0.25rem", lineHeight: 1.5 }}>
                Your address <span className="font-mono">{account}</span> is recorded in the Sepolia{" "}
                <span className="font-mono">KYCRegistry</span> contract. You have full clearance to invest in primary
                offerings, trade on the secondary order book, collect coupon yields, and redeem at maturity.
              </p>
              {txLink && (
                <div style={{ marginTop: "0.75rem" }}>
                  <a
                    href={txLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary btn-sm"
                    style={{ display: "inline-flex", gap: "0.4rem", color: "var(--accent-emerald)" }}
                  >
                    <span>View Whitelist Transaction on Sepolia Etherscan</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* State C: Pending Review */}
      {account && !isKycVerified && remote.status === "pending" && (
        <div
          style={{
            padding: "1.25rem",
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid var(--accent-amber-border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <Clock size={24} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <h4 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)" }}>
                Application Submitted — Under Review
              </h4>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginTop: "0.25rem", lineHeight: 1.5 }}>
                Your identity details and test document have been received by the compliance team. Once an authorized
                Compliance Officer approves your request, the on-chain whitelist transaction will be executed
                automatically and this page will update.
              </p>
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.85rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                <span>Applicant: <b>{remote.data?.name || name}</b></span>
                <span>•</span>
                <span>Submitted: {remote.data?.created_at ? new Date(remote.data.created_at).toLocaleString() : "Recently"}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* State D: Rejected Application */}
      {account && !isKycVerified && remote.status === "rejected" && (
        <div
          style={{
            padding: "1.25rem",
            background: "rgba(244, 63, 94, 0.08)",
            border: "1px solid var(--accent-rose-border)",
            borderRadius: "var(--radius-md)",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <XCircle size={24} color="#f43f5e" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <h4 style={{ fontSize: "1rem", fontWeight: 700, color: "#fda4af" }}>
                Application Rejected by Compliance Officer
              </h4>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginTop: "0.25rem", lineHeight: 1.5 }}>
                Reason given: <b>{remote.data?.rejection_reason || "Document details could not be verified."}</b>
              </p>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", marginTop: "0.4rem" }}>
                Please review your legal details, upload a replacement sample document, and submit a corrected application below.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* State E: Form for New Submission or Re-submission */}
      {account && !isKycVerified && remote.status !== "pending" && (
        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="input-group">
              <label className="input-label" htmlFor="kycName">Full Legal Name *</label>
              <input
                id="kycName"
                className="input-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="As stated on government-issued ID"
                required
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="kycEmail">Email Address</label>
              <input
                id="kycEmail"
                type="email"
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="input-group">
              <label className="input-label" htmlFor="kycCountry">Country of Residence</label>
              <select
                id="kycCountry"
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
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="kycType">Investor Category</label>
              <select
                id="kycType"
                className="input-field"
                value={investorType}
                onChange={(e) => setInvestorType(e.target.value)}
              >
                <option value="Individual">Individual Investor</option>
                <option value="Accredited">Accredited Investor (Rule 501)</option>
                <option value="Institutional">Qualified Institutional Buyer (QIB)</option>
                <option value="Family Office">Family Office / Fund</option>
              </select>
            </div>
          </div>

          {/* Document Upload Area */}
          <div className="input-group" style={{ marginTop: "0.5rem" }}>
            <label className="input-label">Sample Proof of Identity / Accreditation Document *</label>
            <div
              style={{
                border: "2px dashed var(--border-active)",
                borderRadius: "var(--radius-md)",
                padding: "1.75rem 1.5rem",
                textAlign: "center",
                backgroundColor: "var(--bg-input)",
                cursor: "pointer",
              }}
              onClick={() => document.getElementById("kycFileInput").click()}
            >
              <UploadCloud size={32} color="#3b82f6" style={{ margin: "0 auto 0.5rem auto", opacity: 0.8 }} />
              <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                {file ? file.name : "Click to select a sample ID file (PDF, JPG, PNG)"}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                Max file size: 5 MB. Prototype uses dummy test documents only.
              </div>
              <input
                id="kycFileInput"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={onFileChange}
                style={{ display: "none" }}
              />
            </div>
            {file && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", color: "var(--accent-emerald)", marginTop: "0.4rem" }}>
                <FileText size={14} />
                <span>Selected: {file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
              </div>
            )}
          </div>

          {/* Prototype disclaimer checkbox */}
          <label
            style={{
              display: "flex",
              gap: "0.6rem",
              alignItems: "flex-start",
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              marginTop: "1rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={dummyOk}
              onChange={(e) => setDummyOk(e.target.checked)}
              style={{ marginTop: "0.15rem" }}
            />
            <span>
              <b>Testnet Prototype Confirmation:</b> I confirm that this is a testnet deployment on Sepolia and that I am
              submitting synthetic/dummy test documentation, not sensitive personal records.
            </span>
          </label>

          {msg && (
            <div className={`alert-banner ${msg.type}`} style={{ marginTop: "1rem", marginBottom: 0 }}>
              <span>{msg.text}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !file || !dummyOk}
            style={{ marginTop: "1.25rem", width: "100%" }}
          >
            {submitting ? "Uploading & Submitting Application..." : "Submit KYC Application"}
          </button>
        </form>
      )}
    </div>
  );
}

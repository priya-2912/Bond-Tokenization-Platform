import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import { Modal } from "./ui";
import { Wallet, ShieldCheck, ArrowRight, UserPlus, LogIn, CheckCircle2, AlertCircle } from "lucide-react";
import { shortAddr } from "../lib/utils";

export default function InvestorAuthModal({ isOpen, onClose, initialMode = "signin", onSuccess }) {
  const { account, connectWallet, loginWithWallet } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState(initialMode); // "signin" | "signup"
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("United States");
  const [investorType, setInvestorType] = useState("Individual");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleConnect = async () => {
    setError(null);
    setLoading(true);
    try {
      await connectWallet();
      toast.info("Wallet connected. Please sign the authentication challenge.");
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const metadata = mode === "signup" ? { name: fullName.trim(), email: email.trim(), phone, country, investorType } : {};
      const user = await loginWithWallet(metadata);
      toast.success(`Welcome back, ${user.fullName || shortAddr(user.wallet)}!`);
      onClose();
      if (onSuccess) onSuccess(user);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={mode === "signup" ? "Create Investor Account" : "Investor Sign In"} onClose={onClose}>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button
          type="button"
          className={`btn btn-sm ${mode === "signin" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => { setMode("signin"); setError(null); }}
          style={{ flex: 1 }}
        >
          <LogIn size={14} /> Sign In
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === "signup" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => { setMode("signup"); setError(null); }}
          style={{ flex: 1 }}
        >
          <UserPlus size={14} /> Register
        </button>
      </div>

      {error && (
        <div className="alert-banner error" style={{ marginBottom: "1rem" }}>
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {!account ? (
        <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
          <div
            style={{
              width: 50,
              height: 50,
              borderRadius: "50%",
              background: "rgba(59, 130, 246, 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1rem auto",
            }}
          >
            <Wallet size={24} color="#3b82f6" />
          </div>
          <h4 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.35rem" }}>Connect MetaMask</h4>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginBottom: "1.25rem", lineHeight: 1.5 }}>
            Aura Bonds uses secure Web3 signature authentication. No password needed — your private key never leaves your device.
          </p>
          <button className="btn btn-primary" onClick={handleConnect} disabled={loading} style={{ width: "100%" }}>
            <Wallet size={16} />
            <span>{loading ? "Connecting..." : "Connect MetaMask"}</span>
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              borderRadius: "var(--radius-md)",
              marginBottom: "1.25rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <CheckCircle2 size={16} color="#10b981" />
              <div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Connected Wallet</div>
                <div className="font-mono" style={{ fontSize: "0.85rem", fontWeight: 700, color: "#10b981" }}>
                  {account.slice(0, 8)}...{account.slice(-6)}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleConnect}
              style={{ fontSize: "0.7rem", padding: "0.25rem 0.5rem" }}
            >
              Change
            </button>
          </div>

          {mode === "signup" && (
            <>
              <div className="input-group">
                <label className="input-label" htmlFor="regName">Full Legal Name *</label>
                <input
                  id="regName"
                  className="input-field"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Alexander Vance"
                  required
                />
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="regEmail">Work or Personal Email *</label>
                <input
                  id="regEmail"
                  type="email"
                  className="input-field"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. alex@auracapital.com"
                  required
                />
              </div>

              <div className="grid-2" style={{ gap: "0.75rem" }}>
                <div className="input-group">
                  <label className="input-label" htmlFor="regCountry">Country of Residence</label>
                  <select
                    id="regCountry"
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
                    <option value="Other">Other Jurisdiction</option>
                  </select>
                </div>

                <div className="input-group">
                  <label className="input-label" htmlFor="regType">Investor Category</label>
                  <select
                    id="regType"
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
            </>
          )}

          <div style={{ marginTop: "1rem", fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
            Clicking below will request a one-time cryptographic challenge signature in your MetaMask extension.
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: "100%", marginTop: "1rem" }}
          >
            <ShieldCheck size={16} />
            <span>{loading ? "Verifying signature in wallet..." : mode === "signup" ? "Sign Challenge & Complete Registration" : "Sign Authentication Challenge"}</span>
          </button>
        </form>
      )}
    </Modal>
  );
}


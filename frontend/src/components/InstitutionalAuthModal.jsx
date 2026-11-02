import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import { Modal } from "./ui";
import { Shield, Key, Wallet, AlertCircle, Building, CheckCircle2 } from "lucide-react";
import { shortAddr } from "../lib/utils";

export default function InstitutionalAuthModal({ isOpen, onClose, onSuccess }) {
  const { account, connectWallet, loginInstitutional } = useAuth();
  const toast = useToast();

  const [authMethod, setAuthMethod] = useState("wallet"); // "wallet" | "key"
  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleWalletSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      if (!account) {
        await connectWallet();
      }
      const user = await loginInstitutional();
      toast.success(`Institutional access granted: ${user.role.toUpperCase()}`);
      onClose();
      if (onSuccess) onSuccess(user);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeySignIn = async (e) => {
    e.preventDefault();
    if (!adminKey.trim()) {
      return setError("Please provide the institutional administrative key");
    }
    setError(null);
    setLoading(true);
    try {
      const user = await loginInstitutional({ adminKey: adminKey.trim() });
      toast.success("Institutional terminal unlocked via administrative credential");
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
    <Modal title="Institutional & Compliance Gateway" onClose={onClose}>
      <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "rgba(245, 158, 11, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 0.75rem auto",
          }}
        >
          <Building size={24} color="#f59e0b" />
        </div>
        <h4 style={{ fontSize: "1.1rem", fontWeight: 800 }}>Restricted Institutional Terminal</h4>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.825rem", marginTop: "0.25rem" }}>
          For authorized Compliance Officers, Issuers, and Platform Administrators only.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button
          type="button"
          className={`btn btn-sm ${authMethod === "wallet" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => { setAuthMethod("wallet"); setError(null); }}
          style={{ flex: 1 }}
        >
          <Wallet size={14} /> Web3 Role Signature
        </button>
        <button
          type="button"
          className={`btn btn-sm ${authMethod === "key" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => { setAuthMethod("key"); setError(null); }}
          style={{ flex: 1 }}
        >
          <Key size={14} /> Compliance Key
        </button>
      </div>

      {error && (
        <div className="alert-banner error" style={{ marginBottom: "1rem" }}>
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {authMethod === "wallet" ? (
        <div>
          {account ? (
            <div
              style={{
                padding: "0.75rem 1rem",
                background: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.25)",
                borderRadius: "var(--radius-md)",
                marginBottom: "1.25rem",
              }}
            >
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Selected Wallet</div>
              <div className="font-mono" style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f59e0b", marginTop: 2 }}>
                {account}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.35rem" }}>
                The backend will verify if this address holds on-chain administrative or compliance roles on Sepolia.
              </div>
            </div>
          ) : (
            <p style={{ fontSize: "0.825rem", color: "var(--text-secondary)", marginBottom: "1.25rem", lineHeight: 1.5 }}>
              Connect your authorized institutional officer wallet. You will be prompted to sign a cryptographic challenge to prove address ownership.
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleWalletSignIn}
            disabled={loading}
            style={{ width: "100%", background: "linear-gradient(135deg, #d97706 0%, #b45309 100%)" }}
          >
            <Shield size={16} />
            <span>{loading ? "Verifying on-chain role..." : account ? "Sign Institutional Challenge" : "Connect & Verify Role"}</span>
          </button>
        </div>
      ) : (
        <form onSubmit={handleKeySignIn}>
          <div className="input-group">
            <label className="input-label" htmlFor="adminKey">Institutional API / Compliance Secret</label>
            <input
              id="adminKey"
              type="password"
              className="input-field font-mono"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="e.g. AURA_ADMIN_..."
              autoFocus
              required
            />
          </div>

          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
            For testnet and institutional officer evaluation. In production, multi-signature hardware credentials (Safe / Ledger) are recommended.
          </p>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !adminKey}
            style={{ width: "100%", background: "linear-gradient(135deg, #d97706 0%, #b45309 100%)" }}
          >
            <Key size={16} />
            <span>{loading ? "Authenticating..." : "Unlock Institutional Console"}</span>
          </button>
        </form>
      )}
    </Modal>
  );
}


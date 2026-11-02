import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  listKyc,
  approveKycRequest,
  rejectKycRequest,
  getKycDocumentUrl,
} from "../lib/backend";
import { getContract, addressUrl, txUrl } from "../contracts/platform";
import { shortAddr, timeAgo } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import { Modal, ConfirmModal } from "./ui";
import {
  UserCheck,
  UserX,
  FileText,
  Eye,
  ExternalLink,
  RefreshCw,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Search,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export default function AdminKycReview() {
  const { provider, signer, network, roles, refreshTrigger, setRefreshTrigger } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState("pending"); // "pending" | "approved" | "rejected" | "all"
  const [applications, setApplications] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  const [previewDocWallet, setPreviewDocWallet] = useState(null);
  const [rejectModalApp, setRejectModalApp] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listKyc(tab === "all" ? null : tab, search);
      if (res.ok && Array.isArray(res.data)) {
        setApplications(res.data);
      }
    } catch (err) {
      console.warn("Failed to load KYC queue:", err);
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue, refreshTrigger]);

  // Handle Approve
  const handleApprove = async (app) => {
    setActionBusy(true);
    setBusyMessage(`Executing on-chain whitelist transaction for ${shortAddr(app.wallet)}...`);

    try {
      // 1. Try server-side approval with compliance key first
      const srvRes = await approveKycRequest(app.wallet);

      if (srvRes.ok) {
        toast.success(`Approved! ${shortAddr(app.wallet)} is now whitelisted on-chain.`);
        setRefreshTrigger((n) => n + 1);
        setSelectedApp(null);
        return;
      }

      // 2. If server-side key lacks permission, fallback to connected wallet with COMPLIANCE_ROLE
      if (signer && roles.compliance) {
        setBusyMessage("Signing whitelist transaction in your compliance wallet...");
        const kyc = getContract("KYCRegistry", signer, network);
        const tx = await kyc.addToWhitelist(ethers.getAddress(app.wallet));
        const receipt = await tx.wait();

        toast.success(`Approved via connected compliance wallet! Tx: ${receipt.hash.slice(0, 10)}...`);
        setRefreshTrigger((n) => n + 1);
        setSelectedApp(null);
        return;
      }

      throw new Error(srvRes.error || "Compliance whitelist execution failed");
    } catch (err) {
      console.error(err);
      toast.error(err.reason || err.shortMessage || err.message || "Failed to execute whitelist transaction");
    } finally {
      setActionBusy(false);
      setBusyMessage("");
    }
  };

  // Handle Reject
  const handleRejectConfirm = async () => {
    if (!rejectModalApp) return;
    setActionBusy(true);
    setBusyMessage("Recording KYC rejection...");

    try {
      const res = await rejectKycRequest(
        rejectModalApp.wallet,
        rejectionReason.trim() || "Verification documents did not meet requirements"
      );

      if (!res.ok) throw new Error(res.error || "Failed to record rejection");

      toast.warn(`Application for ${shortAddr(rejectModalApp.wallet)} marked as rejected.`);
      setRejectModalApp(null);
      setRejectionReason("");
      setSelectedApp(null);
      setRefreshTrigger((n) => n + 1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setActionBusy(false);
      setBusyMessage("");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Banner */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="badge badge-amber">COMPLIANCE REVIEW QUEUE</span>
              <span className="badge badge-blue">{applications.length} Items</span>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>
              KYC & Accreditation Decisions
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Inspect submitted applicant data and sample identity documents. Approvals trigger on-chain{" "}
              <span className="font-mono">KYCRegistry.addToWhitelist()</span> execution.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            {["pending", "approved", "rejected", "all"].map((t) => (
              <button
                key={t}
                className={`btn btn-sm ${tab === t ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setTab(t)}
                style={{ textTransform: "capitalize" }}
              >
                {t}
              </button>
            ))}
            <button className="btn-icon" onClick={loadQueue} aria-label="Refresh queue" title="Refresh">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="filter-bar">
        <div className="search-input-wrapper">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search queue by legal name, email, or wallet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {actionBusy && (
        <div className="alert-banner info">
          <Clock size={14} className="animate-spin" />
          <span>{busyMessage}</span>
        </div>
      )}

      {/* Table */}
      <div className="card">
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Wallet Address</th>
                <th>Jurisdiction</th>
                <th>Category</th>
                <th>Identity Document</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {applications.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
                    {loading ? "Loading queue..." : `No ${tab} applications found.`}
                  </td>
                </tr>
              ) : (
                applications.map((app) => {
                  const hasDoc = Boolean(app.id_file);
                  const docUrl = hasDoc ? getKycDocumentUrl(app.wallet) : null;
                  const txExplorer = app.tx_hash ? txUrl(network, app.tx_hash) : null;

                  return (
                    <tr key={app.id}>
                      <td>
                        <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{app.name}</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          {app.email || "No email on file"}
                        </div>
                      </td>
                      <td className="font-mono">{shortAddr(app.wallet)}</td>
                      <td>{app.country || "United States"}</td>
                      <td>
                        <span className="badge badge-blue" style={{ fontSize: "0.68rem" }}>
                          {app.investor_type || "Individual"}
                        </span>
                      </td>
                      <td>
                        {hasDoc ? (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setPreviewDocWallet(app.wallet)}
                            title="Preview submitted document"
                            style={{ fontSize: "0.72rem", padding: "0.3rem 0.6rem" }}
                          >
                            <FileText size={12} color="#3b82f6" />
                            <span>Preview</span>
                          </button>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>None</span>
                        )}
                      </td>
                      <td>
                        {app.status === "approved" ? (
                          <div>
                            <span className="badge badge-emerald">Approved</span>
                            {txExplorer && (
                              <div style={{ marginTop: "0.2rem" }}>
                                <a
                                  href={txExplorer}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono"
                                  style={{ fontSize: "0.68rem", color: "var(--accent-blue)", display: "inline-flex", gap: "0.2rem", alignItems: "center" }}
                                >
                                  <span>{shortAddr(app.tx_hash)}</span>
                                  <ExternalLink size={8} />
                                </a>
                              </div>
                            )}
                          </div>
                        ) : app.status === "rejected" ? (
                          <div>
                            <span className="badge badge-rose">Rejected</span>
                            {app.rejection_reason && (
                              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", maxWidth: 180, marginTop: "0.2rem" }}>
                                {app.rejection_reason}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="badge badge-amber">Pending</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {app.status === "pending" ? (
                          <div style={{ display: "inline-flex", gap: "0.4rem" }}>
                            <button
                              className="btn btn-emerald btn-sm"
                              disabled={actionBusy}
                              onClick={() => handleApprove(app)}
                            >
                              <UserCheck size={13} />
                              <span>Approve</span>
                            </button>
                            <button
                              className="btn btn-rose btn-sm"
                              disabled={actionBusy}
                              onClick={() => {
                                setRejectModalApp(app);
                                setRejectionReason("");
                              }}
                            >
                              <UserX size={13} />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setSelectedApp(app)}
                          >
                            <Eye size={12} />
                            <span>Details</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Document Preview Modal */}
      {previewDocWallet && (
        <Modal title="Confidential Identity Document Preview" onClose={() => setPreviewDocWallet(null)}>
          <div style={{ marginBottom: "1rem" }}>
            <p style={{ fontSize: "0.825rem", color: "var(--text-secondary)" }}>
              Viewing uploaded credential for wallet <span className="font-mono">{previewDocWallet}</span>.
              Access is protected with institutional officer authorization.
            </p>
          </div>

          <div className="doc-preview-container">
            <iframe
              src={getKycDocumentUrl(previewDocWallet)}
              className="doc-preview-frame"
              title="KYC Document Preview"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.25rem" }}>
            <a
              href={getKycDocumentUrl(previewDocWallet)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
            >
              <ExternalLink size={14} />
              <span>Open in New Tab</span>
            </a>
            <button className="btn btn-secondary btn-sm" onClick={() => setPreviewDocWallet(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* Rejection Reason Modal */}
      {rejectModalApp && (
        <Modal title={`Reject KYC Application — ${rejectModalApp.name}`} onClose={() => setRejectModalApp(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              Please provide a clear compliance reason. This message will be presented directly to the investor in their portal.
            </p>

            <div className="input-group">
              <label className="input-label" htmlFor="rejectReasonInput">Compliance Rejection Reason</label>
              <textarea
                id="rejectReasonInput"
                className="input-field"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Identity document expired or illegible. Please submit a valid passport or government ID."
                autoFocus
                rows={3}
              />
            </div>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setRejectModalApp(null)}
                disabled={actionBusy}
              >
                Cancel
              </button>
              <button
                className="btn btn-rose btn-sm"
                onClick={handleRejectConfirm}
                disabled={actionBusy || !rejectionReason.trim()}
              >
                {actionBusy ? "Recording..." : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Details Modal */}
      {selectedApp && (
        <Modal title="KYC Application Decision Record" onClose={() => setSelectedApp(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "0.825rem" }}>
              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Applicant Name</div>
                <div style={{ fontWeight: 700, marginTop: "0.2rem" }}>{selectedApp.name}</div>
              </div>
              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Wallet</div>
                <div className="font-mono" style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>{shortAddr(selectedApp.wallet)}</div>
              </div>
              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Email</div>
                <div style={{ fontWeight: 600, marginTop: "0.2rem" }}>{selectedApp.email || "-"}</div>
              </div>
              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Decision Status</div>
                <div style={{ fontWeight: 700, marginTop: "0.2rem", textTransform: "capitalize" }}>{selectedApp.status}</div>
              </div>
            </div>

            {selectedApp.tx_hash && (
              <div style={{ padding: "0.75rem", background: "rgba(16, 185, 129, 0.08)", border: "1px solid var(--accent-emerald-border)", borderRadius: "var(--radius-md)", fontSize: "0.8rem" }}>
                <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>Blockchain Whitelist Tx</div>
                <div className="font-mono" style={{ color: "#10b981", marginTop: 2 }}>{selectedApp.tx_hash}</div>
              </div>
            )}

            {selectedApp.rejection_reason && (
              <div style={{ padding: "0.75rem", background: "rgba(244, 63, 94, 0.08)", border: "1px solid var(--accent-rose-border)", borderRadius: "var(--radius-md)", fontSize: "0.8rem" }}>
                <div style={{ color: "#fda4af", fontSize: "0.7rem", textTransform: "uppercase" }}>Rejection Reason</div>
                <div style={{ marginTop: 2 }}>{selectedApp.rejection_reason}</div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedApp(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}


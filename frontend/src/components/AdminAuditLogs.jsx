import React, { useState, useEffect, useCallback } from "react";
import { getAdminAuditLogs } from "../lib/backend";
import { txUrl } from "../contracts/platform";
import { shortAddr, timeAgo } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import {
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  History,
  FileCheck2,
  Lock,
  Calendar,
} from "lucide-react";

export default function AdminAuditLogs() {
  const { network } = useAuth();

  const [logs, setLogs] = useState([]);
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminAuditLogs({ limit: 150, action: actionFilter || null });
      if (res.ok && Array.isArray(res.data)) {
        setLogs(res.data);
      }
    } catch (err) {
      console.warn("Failed to load audit logs:", err);
    } finally {
      setLoading(false);
    }
  }, [actionFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Banner */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <span className="badge badge-amber">REGULATORY AUDIT TRAIL</span>
              <span className="badge badge-emerald">Immutable Log</span>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Compliance & Administrative Audit Trail
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Chronological ledger of privileged officer actions, KYC approvals, oracle updates, and smart contract transactions.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <select
              className="input-field"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              style={{ width: "auto", minWidth: 180 }}
            >
              <option value="">All Actions</option>
              <option value="KYC_APPROVED">KYC Approved</option>
              <option value="KYC_REJECTED">KYC Rejected</option>
              <option value="KYC_SUBMITTED">KYC Submitted</option>
              <option value="USER_LOGIN">User Logins</option>
              <option value="INSTITUTIONAL_LOGIN">Institutional Logins</option>
              <option value="PROFILE_UPDATED">Profile Updates</option>
            </select>

            <button className="btn-icon" onClick={loadLogs} aria-label="Refresh audit logs" title="Refresh">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor Wallet</th>
                <th>Role</th>
                <th>Action</th>
                <th>Target Wallet</th>
                <th>Details</th>
                <th style={{ textAlign: "right" }}>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
                    {loading ? "Querying audit logs..." : "No audit trail records found."}
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const txExplorer = log.tx_hash ? txUrl(network, log.tx_hash) : null;
                  let parsedDetails = null;
                  try {
                    parsedDetails = log.details ? JSON.parse(log.details) : null;
                  } catch {
                    parsedDetails = log.details;
                  }

                  return (
                    <tr key={log.id}>
                      <td style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                        <div>{new Date(log.created_at).toLocaleDateString()}</div>
                        <div style={{ color: "var(--text-muted)" }}>{new Date(log.created_at).toLocaleTimeString()}</div>
                      </td>
                      <td className="font-mono">{shortAddr(log.actor_wallet)}</td>
                      <td>
                        <span
                          className={`badge ${
                            log.actor_role === "admin"
                              ? "badge-blue"
                              : log.actor_role === "compliance"
                              ? "badge-emerald"
                              : "badge-amber"
                          }`}
                          style={{ fontSize: "0.68rem" }}
                        >
                          {log.actor_role}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontWeight: 700,
                            color:
                              log.action === "KYC_APPROVED"
                                ? "#10b981"
                                : log.action === "KYC_REJECTED"
                                ? "#f43f5e"
                                : "var(--text-primary)",
                          }}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="font-mono">
                        {log.target_wallet ? shortAddr(log.target_wallet) : "-"}
                      </td>
                      <td style={{ fontSize: "0.75rem", color: "var(--text-secondary)", maxWidth: 220 }}>
                        {parsedDetails && typeof parsedDetails === "object"
                          ? Object.entries(parsedDetails)
                              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                              .join(", ")
                          : log.details || "-"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {txExplorer ? (
                          <a
                            href={txExplorer}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono"
                            style={{ color: "var(--accent-blue)", display: "inline-flex", gap: "0.25rem", alignItems: "center" }}
                          >
                            <span>{shortAddr(log.tx_hash)}</span>
                            <ExternalLink size={10} />
                          </a>
                        ) : log.tx_hash ? (
                          <span className="font-mono">{shortAddr(log.tx_hash)}</span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>-</span>
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
    </div>
  );
}


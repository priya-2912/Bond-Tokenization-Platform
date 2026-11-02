import React, { useState, useEffect, useCallback } from "react";
import { getAdminInvestors } from "../lib/backend";
import { addressUrl, NETWORKS } from "../contracts/platform";
import { shortAddr, timeAgo } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import { Modal } from "./ui";
import {
  Users,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  User,
  Mail,
  Phone,
  Globe,
  CheckCircle2,
  XCircle,
  Eye,
} from "lucide-react";

export default function AdminInvestorManagement() {
  const { network } = useAuth();

  const [investors, setInvestors] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const loadInvestors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminInvestors({ search, role: roleFilter, limit: 100 });
      if (res.ok && res.data) {
        setInvestors(res.data.users || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      console.warn("Failed to load investors:", err);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    loadInvestors();
  }, [loadInvestors]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Top Banner */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <span className="badge badge-blue">REGULATORY COMPLIANCE</span>
              <span className="badge badge-emerald">{total} Total Accounts</span>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>Investor Management</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Directory of verified and prospective investors, profile details, and on-chain KYC status.
            </p>
          </div>

          <button className="btn-icon" onClick={loadInvestors} aria-label="Refresh investors list" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-bar">
        <div className="search-input-wrapper">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search by legal name, email, or 0x wallet address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="input-field"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          style={{ width: "auto", minWidth: 160 }}
        >
          <option value="">All Roles</option>
          <option value="investor">Investors</option>
          <option value="compliance">Compliance Officers</option>
          <option value="issuer">Issuers</option>
          <option value="admin">Administrators</option>
        </select>
      </div>

      {/* Investors Table */}
      <div className="card">
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Investor / Name</th>
                <th>Wallet Address</th>
                <th>Email & Phone</th>
                <th>Country</th>
                <th>Category</th>
                <th>KYC Status</th>
                <th style={{ textAlign: "right" }}>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {investors.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
                    {loading ? "Loading investor accounts..." : "No investors found matching the search criteria."}
                  </td>
                </tr>
              ) : (
                investors.map((u) => {
                  const url = addressUrl(network, u.wallet);
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                          {u.full_name || "Anonymous Investor"}
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          Role: <span style={{ textTransform: "capitalize" }}>{u.role}</span>
                        </div>
                      </td>
                      <td className="font-mono">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--accent-blue)", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
                          >
                            <span>{shortAddr(u.wallet)}</span>
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          shortAddr(u.wallet)
                        )}
                      </td>
                      <td>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{u.email || "-"}</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{u.phone || ""}</div>
                      </td>
                      <td>{u.country || "United States"}</td>
                      <td>
                        <span className="badge badge-blue" style={{ fontSize: "0.68rem" }}>
                          {u.investor_type || "Individual"}
                        </span>
                      </td>
                      <td>
                        {u.kyc_status === "approved" ? (
                          <span className="badge badge-emerald">Whitelisted</span>
                        ) : u.kyc_status === "pending" ? (
                          <span className="badge badge-amber">Pending</span>
                        ) : u.kyc_status === "rejected" ? (
                          <span className="badge badge-rose">Rejected</span>
                        ) : (
                          <span className="badge" style={{ background: "rgba(100, 116, 139, 0.2)", color: "#94a3b8" }}>
                            Unregistered
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedUser(u)}
                          title="Inspect profile"
                        >
                          <Eye size={12} />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspect Profile Modal */}
      {selectedUser && (
        <Modal title="Investor Profile Review" onClose={() => setSelectedUser(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "1rem",
                background: "var(--bg-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div>
                <h4 style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                  {selectedUser.full_name || "Anonymous Investor"}
                </h4>
                <div className="font-mono" style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                  {selectedUser.wallet}
                </div>
              </div>
              <span className={`badge ${selectedUser.kyc_status === "approved" ? "badge-emerald" : selectedUser.kyc_status === "pending" ? "badge-amber" : "badge-rose"}`}>
                {selectedUser.kyc_status ? selectedUser.kyc_status.toUpperCase() : "UNVERIFIED"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "0.825rem" }}>
              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Email Address</div>
                <div style={{ fontWeight: 600, marginTop: "0.2rem" }}>{selectedUser.email || "Not provided"}</div>
              </div>

              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Phone Number</div>
                <div style={{ fontWeight: 600, marginTop: "0.2rem" }}>{selectedUser.phone || "Not provided"}</div>
              </div>

              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Jurisdiction</div>
                <div style={{ fontWeight: 600, marginTop: "0.2rem" }}>{selectedUser.country || "United States"}</div>
              </div>

              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Investor Category</div>
                <div style={{ fontWeight: 600, marginTop: "0.2rem" }}>{selectedUser.investor_type || "Individual"}</div>
              </div>

              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Assigned Role</div>
                <div style={{ fontWeight: 600, marginTop: "0.2rem", textTransform: "capitalize" }}>{selectedUser.role}</div>
              </div>

              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase" }}>Registration Date</div>
                <div style={{ fontWeight: 600, marginTop: "0.2rem" }}>
                  {selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleDateString() : "-"}
                </div>
              </div>
            </div>

            {selectedUser.kyc_tx_hash && (
              <div style={{ padding: "0.75rem", background: "rgba(16, 185, 129, 0.08)", border: "1px solid var(--accent-emerald-border)", borderRadius: "var(--radius-md)", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--text-muted)" }}>On-chain whitelist tx: </span>
                <span className="font-mono" style={{ color: "#10b981" }}>{selectedUser.kyc_tx_hash}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedUser(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}


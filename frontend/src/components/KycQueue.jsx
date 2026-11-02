import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { getContract } from "../contracts/platform";
import { listKyc, approveKycRequest, rejectKycRequest, hasAdminKey } from "../lib/backend";
import { friendlyError, shortAddr } from "../lib/utils";
import { StatusBanner, useTxRunner } from "./ui";
import { FileText, UserCheck, RefreshCw } from "lucide-react";

/** Compliance queue: KYC applications submitted through the investor page. On-chain isVerified stays the source of truth. */
export default function KycQueue({ provider, signer, network, roles, refreshTrigger, setRefreshTrigger }) {
  const [tab, setTab] = useState("pending");
  const [rows, setRows] = useState([]);
  const [verified, setVerified] = useState({});
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState(null);
  const onDone = useCallback(() => setRefreshTrigger((n) => n + 1), [setRefreshTrigger]);
  const { status, setStatus, busy, run } = useTxRunner(onDone);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setProblem(null);
      if (!hasAdminKey()) {
        setRows([]);
        return setProblem("Set VITE_ADMIN_API_KEY in frontend/.env (same value as the backend's ADMIN_API_KEY) to see applications. Development only.");
      }
      setLoading(true);
      const r = await listKyc(tab);
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setRows([]);
        return setProblem(r.unreachable ? "The KYC service is not reachable. Start it with: cd backend && npm start" : r.status === 401 ? "The backend rejected the admin key." : r.error);
      }
      const list = Array.isArray(r.data) ? r.data : [];
      setRows(list);
      try {
        const kyc = getContract("KYCRegistry", provider, network);
        const flags = await Promise.all(list.map((x) => kyc.isVerified(x.wallet)));
        if (!cancelled) setVerified(Object.fromEntries(list.map((x, i) => [x.wallet.toLowerCase(), flags[i]])));
      } catch {
        if (!cancelled) setVerified({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, provider, network, refreshTrigger]);

  const approve = (row) => {
    run(`Approving ${shortAddr(row.wallet)}...`, async () => {
      const already = verified[row.wallet.toLowerCase()];
      if (already) {
        await approveKycRequest(row.wallet); // tidy the service record; ignore the result
        return null;
      }
      // 1) let the service whitelist the wallet with its own compliance key
      const viaService = await approveKycRequest(row.wallet);
      if (viaService.ok) return null;
      // 2) fall back to the connected compliance wallet
      if (!signer || !roles.compliance) throw new Error(`The service could not approve (${viaService.error}) and your wallet lacks the COMPLIANCE role.`);
      return getContract("KYCRegistry", signer, network).addToWhitelist(ethers.getAddress(row.wallet));
    }, `${shortAddr(row.wallet)} is now KYC-verified.`);
  };

  const reject = (row) =>
    run(`Rejecting ${shortAddr(row.wallet)}...`, async () => {
      const r = await rejectKycRequest(row.wallet);
      if (!r.ok) throw new Error(r.error);
      return null;
    }, `Application from ${shortAddr(row.wallet)} rejected.`);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title"><UserCheck size={18} color="#10b981" /> KYC applications</h3>
          <p className="card-subtitle">Review submissions from investors, then approve or reject.</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {["pending", "approved", "rejected"].map((t) => (
            <button key={t} className={`btn btn-sm ${tab === t ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab(t)} style={{ textTransform: "capitalize" }}>{t}</button>
          ))}
          <button className="btn-icon" onClick={onDone} aria-label="Refresh applications"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </div>
      <StatusBanner status={status} onClose={() => setStatus(null)} network={network} />
      {problem && <div className="alert-banner warn"><span>{problem}</span></div>}
      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Wallet</th><th>Document</th><th>On-chain</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "1.25rem" }}>{loading ? "Loading..." : `No ${tab} applications.`}</td></tr>}
            {rows.map((r) => {
              const v = verified[r.wallet.toLowerCase()];
              return (
                <tr key={r.wallet}>
                  <td>{r.name}</td>
                  <td className="font-mono">{shortAddr(r.wallet)}</td>
                  <td>{r.id_file ? <span style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center", color: "var(--text-secondary)" }}><FileText size={12} /> on file</span> : "none"}</td>
                  <td>{v ? <span className="badge badge-emerald">Verified</span> : <span className="badge badge-amber">Not yet</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    {tab === "pending" && (
                      <>
                        <button className="btn btn-emerald btn-sm" disabled={busy} onClick={() => approve(r)}>Approve</button>{" "}
                        <button className="btn btn-rose btn-sm" disabled={busy} onClick={() => reject(r)}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
        Documents are stored by the backend and are not displayed here. Use dummy data only on this prototype.
      </p>
    </div>
  );
}

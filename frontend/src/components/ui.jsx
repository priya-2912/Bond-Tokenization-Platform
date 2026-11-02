import React, { useCallback, useEffect, useRef, useState } from "react";
import { txUrl, NETWORKS } from "../contracts/platform";
import { friendlyError } from "../lib/utils";

/** Status banner with an optional link to the transaction on the block explorer. */
export function StatusBanner({ status, onClose, network }) {
  if (!status) return null;
  const url = status.hash ? txUrl(network, status.hash) : null;
  return (
    <div className={`alert-banner ${status.type}`} role="status" aria-live="polite">
      <span>
        {status.text}
        {status.hash && (
          <>
            {" "}
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>
                View transaction
              </a>
            ) : (
              <span className="font-mono" style={{ opacity: 0.8 }}>
                (tx {status.hash.slice(0, 10)}...)
              </span>
            )}
          </>
        )}
      </span>
      <button onClick={onClose} aria-label="Dismiss message" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "1rem" }}>
        ✕
      </button>
    </div>
  );
}

/** Generic modal: closes on Escape or a click on the dark backdrop. */
export function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} className="btn-icon" aria-label="Close dialog">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, message, confirmLabel = "Confirm", danger = false, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1.25rem" }}>{message}</p>
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        <button className={`btn btn-sm ${danger ? "btn-rose" : "btn-primary"}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
      <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem" }}>{title}</h3>
      <div style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>{children}</div>
    </div>
  );
}

/**
 * Runs a transaction flow with consistent status messages, friendly errors and
 * double-click protection (busy flag). `fn` receives setStatus so multi-step flows
 * (approve -> action) can update the message, and must return the last transaction response.
 */
export function useTxRunner(onDone) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = useCallback(
    async (pendingText, fn, successText) => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setStatus({ type: "info", text: pendingText });
      try {
        const tx = await fn(setStatus);
        const receipt = tx && tx.wait ? await tx.wait() : tx;
        setStatus({ type: "success", text: successText, hash: (receipt && receipt.hash) || (tx && tx.hash) });
        if (onDone) onDone();
        return true;
      } catch (err) {
        console.error(err);
        setStatus({ type: "error", text: friendlyError(err) });
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onDone]
  );
  return { status, setStatus, busy, run };
}

export function RoleBadge({ label, has }) {
  return <span className={`badge ${has ? "badge-emerald" : "badge-amber"}`} title={has ? "You hold this role" : "You do not hold this role"}>{has ? "✓" : "✕"} {label}</span>;
}

export function NetworkLabel({ network }) {
  return <>{NETWORKS[network] ? NETWORKS[network].label : network}</>;
}

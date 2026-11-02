import React from "react";
import { Modal } from "./ui";
import {
  ShieldCheck,
  Calendar,
  DollarSign,
  TrendingUp,
  Layers,
  Clock,
  AlertTriangle,
  Building,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  Info,
} from "lucide-react";
import { fmtNumber, shortAddr } from "../lib/utils";

export default function BondDetailsModal({
  isOpen,
  onClose,
  bond,
  onInvestLive,
}) {
  if (!isOpen || !bond) return null;

  return (
    <Modal title={bond.name} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxHeight: "78vh", overflowY: "auto", paddingRight: "0.25rem" }}>
        {/* Header Tag Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <span className="badge badge-blue">{bond.category}</span>
            <span className="badge badge-emerald">{bond.annualCouponRate}% APY</span>
            {bond.isOnChain ? (
              <span className="badge badge-emerald" style={{ fontWeight: 800 }}>LIVE ON-CHAIN (SEPOLIA)</span>
            ) : (
              <span className="badge badge-amber">DEMO CATALOGUE</span>
            )}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Symbol: <b className="font-mono">{bond.symbol}</b>
          </span>
        </div>

        {/* On-chain vs Demo Notice */}
        {bond.isOnChain ? (
          <div style={{ padding: "0.75rem 1rem", borderRadius: "var(--radius-sm)", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.25)", fontSize: "0.8rem", color: "#6ee7b7" }}>
            <CheckCircle2 size={14} style={{ display: "inline", marginRight: "0.4rem", verticalAlign: "middle" }} />
            This is an active, deployed Real-World Asset debt instrument executing on the <b>Ethereum Sepolia Testnet</b>.
          </div>
        ) : (
          <div style={{ padding: "0.75rem 1rem", borderRadius: "var(--radius-sm)", background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.25)", fontSize: "0.8rem", color: "#fbbf24" }}>
            <Info size={14} style={{ display: "inline", marginRight: "0.4rem", verticalAlign: "middle" }} />
            This offering is part of the demonstration catalogue for platform institutional portfolio simulation. On-chain execution is available on the live primary benchmark bond.
          </div>
        )}

        {/* Financial Specs Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.75rem",
            padding: "1rem",
            background: "var(--bg-secondary)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
            fontSize: "0.825rem",
          }}
        >
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>Face Value</div>
            <div className="font-mono" style={{ fontWeight: 700, fontSize: "1.05rem", marginTop: 2 }}>
              ${fmtNumber(bond.faceValue)} USDC
            </div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>Issue Price</div>
            <div className="font-mono" style={{ fontWeight: 700, fontSize: "1.05rem", marginTop: 2, color: "var(--accent-blue)" }}>
              ${fmtNumber(bond.issuePrice)} USDC
            </div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>Coupon Frequency</div>
            <div style={{ fontWeight: 600, marginTop: 2 }}>{bond.paymentFrequency} ({bond.paymentsPerYear}x / yr)</div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>Maturity Date</div>
            <div style={{ fontWeight: 600, marginTop: 2 }}>{bond.maturityDate}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>Minimum Subscription</div>
            <div className="font-mono" style={{ fontWeight: 600, marginTop: 2 }}>${fmtNumber(bond.minInvestment)} USDC</div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase" }}>Available Tranche</div>
            <div className="font-mono" style={{ fontWeight: 600, marginTop: 2 }}>
              {fmtNumber(bond.availableQuantity)} / {fmtNumber(bond.totalIssuedQuantity)} Bonds
            </div>
          </div>
        </div>

        {/* Issuer & Security Details */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", fontSize: "0.825rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)" }}>Issuer Entity:</span>
            <span style={{ fontWeight: 600 }}>{bond.issuer}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)" }}>Issuer Address:</span>
            <span className="font-mono">{shortAddr(bond.issuerAddress)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)" }}>Credit / Risk Rating:</span>
            <span style={{ fontWeight: 700, color: "var(--accent-emerald)" }}>{bond.riskRating}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--text-muted)" }}>Offering Status:</span>
            <span style={{ fontWeight: 600 }}>{bond.status}</span>
          </div>
        </div>

        {/* Collateral & Use of Proceeds */}
        <div style={{ padding: "0.85rem", background: "var(--bg-input)", borderRadius: "var(--radius-sm)", fontSize: "0.8rem", lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, marginBottom: "0.25rem", color: "var(--text-primary)" }}>Use of Proceeds</div>
          <div style={{ color: "var(--text-secondary)", marginBottom: "0.6rem" }}>{bond.useOfProceeds}</div>

          <div style={{ fontWeight: 700, marginBottom: "0.25rem", color: "var(--text-primary)" }}>Collateral Structure</div>
          <div style={{ color: "var(--text-secondary)" }}>{bond.creditCollateral}</div>
        </div>

        {/* Risk Consideration */}
        <div style={{ padding: "0.75rem", background: "rgba(245, 158, 11, 0.05)", border: "1px solid rgba(245, 158, 11, 0.2)", borderRadius: "var(--radius-sm)", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, color: "#f59e0b", marginBottom: "0.25rem" }}>
            <AlertTriangle size={13} />
            <span>Risk Summary</span>
          </div>
          <div>{bond.riskSummary}</div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
          {bond.isOnChain ? (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                onClose();
                if (onInvestLive) onInvestLive(bond);
              }}
              style={{ gap: "0.4rem" }}
            >
              <span>Invest in Live Offering</span>
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                alert(`Demo Offering: ${bond.name} is a demonstration showcase. To execute on-chain investments, select the live on-chain Sepolia bond.`);
              }}
            >
              Simulate Allocation
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}


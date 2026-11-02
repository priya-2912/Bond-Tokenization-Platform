import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import SuperAdminPanel from "./roles/SuperAdminPanel";
import ComplianceOfficerPanel from "./roles/ComplianceOfficerPanel";
import IssuerPanel from "./roles/IssuerPanel";
import AdminDashboardView from "./AdminDashboardView";
import AdminAuditLogs from "./AdminAuditLogs";
import Transparency from "./Transparency";
import AdminCouponTerminal from "./AdminCouponTerminal";
import {
  ShieldAlert,
  ShieldCheck,
  Layers,
  ArrowLeft,
  LogOut,
  LayoutDashboard,
  History,
  Activity,
  DollarSign,
  Users,
  Settings,
} from "lucide-react";
import { shortAddr } from "../lib/utils";

export default function InstitutionalPortal({ onSwitchToInvestor }) {
  const { account, user, roles, readProvider, network, refreshTrigger, setRefreshTrigger, logout } = useAuth();

  // Determine authorized sections based on auto-detected role
  // Sections: "overview" | "investors_kyc" | "bond_management" | "payments_coupons" | "audit_monitoring" | "admin_roles"
  const isSuperAdmin = Boolean(roles?.isMasterAdmin || roles?.admin || user?.role === "super_admin");
  const isCompliance = Boolean(roles?.compliance || user?.role === "compliance");
  const isIssuer = Boolean(roles?.issuer || user?.role === "issuer");

  const authorizedSections = useMemo(() => {
    const list = [{ id: "overview", label: "Overview", icon: <LayoutDashboard size={14} /> }];

    if (isSuperAdmin || isCompliance) {
      list.push({ id: "investors_kyc", label: "Investors & KYC", icon: <Users size={14} /> });
    }

    if (isSuperAdmin || isIssuer) {
      list.push({ id: "bond_management", label: "Bond Management", icon: <Layers size={14} /> });
      list.push({ id: "payments_coupons", label: "Payments & Coupons", icon: <DollarSign size={14} /> });
    }

    list.push({ id: "audit_monitoring", label: "Audit & Monitoring", icon: <Activity size={14} /> });

    if (isSuperAdmin) {
      list.push({ id: "admin_roles", label: "Access & Governance", icon: <Settings size={14} /> });
    }

    return list;
  }, [isSuperAdmin, isCompliance, isIssuer]);

  const [activeSection, setActiveSection] = useState("overview");
  const [auditSubTab, setAuditSubTab] = useState("logs"); // "logs" | "reserves"

  // Ensure current section is valid for the detected role
  useEffect(() => {
    if (!authorizedSections.find((s) => s.id === activeSection)) {
      setActiveSection(authorizedSections[0]?.id || "overview");
    }
  }, [authorizedSections, activeSection]);

  const roleTitle = isSuperAdmin
    ? "Super Admin"
    : isCompliance
    ? "Compliance Officer"
    : isIssuer
    ? "Asset Issuer"
    : "Institutional Officer";

  const roleBadgeClass = isSuperAdmin ? "badge-blue" : isCompliance ? "badge-emerald" : "badge-amber";

  return (
    <div style={{ minHeight: "calc(100vh - 65px)", backgroundColor: "var(--bg-app)", padding: "1.5rem 2rem" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        {/* Streamlined Institutional Navigation Bar */}
        <div className="role-switcher-bar" style={{ marginBottom: "1.5rem" }}>
          {/* Identity & Role */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--radius-sm)",
                background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: 800,
                fontSize: "0.85rem",
              }}
            >
              A
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.88rem", fontWeight: 800, color: "#fff" }}>
                  Aura Institutional Portal
                </span>
                <span className={`badge ${roleBadgeClass}`} style={{ fontSize: "0.65rem", padding: "0.15rem 0.5rem" }}>
                  {roleTitle}
                </span>
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                Operator: <span className="font-mono" style={{ color: "#60a5fa" }}>{shortAddr(account)}</span>
              </div>
            </div>
          </div>

          {/* 5 Core Sections Navigation */}
          <nav className="role-pills" aria-label="Institutional Portal Sections">
            {authorizedSections.map((sec) => (
              <button
                key={sec.id}
                className={`role-pill-btn ${activeSection === sec.id ? "active admin" : ""}`}
                onClick={() => setActiveSection(sec.id)}
              >
                {sec.icon}
                <span>{sec.label}</span>
              </button>
            ))}
          </nav>

          {/* Right Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onSwitchToInvestor}
              style={{ fontSize: "0.75rem", gap: "0.35rem" }}
            >
              <ArrowLeft size={13} />
              <span>Investor Portal</span>
            </button>

            <button
              className="btn btn-secondary btn-sm"
              onClick={logout}
              title="Sign Out"
              style={{ fontSize: "0.75rem", color: "var(--accent-rose)" }}
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>

        {/* Main Section Content Area */}
        <main>
          {/* SECTION 1: Overview */}
          {activeSection === "overview" && (
            <AdminDashboardView
              onNavigateTab={(tab) => {
                if (tab === "kyc" && (isSuperAdmin || isCompliance)) setActiveSection("investors_kyc");
                else if (tab === "issuance" && (isSuperAdmin || isIssuer)) setActiveSection("bond_management");
                else if (tab === "finance" && (isSuperAdmin || isIssuer)) setActiveSection("payments_coupons");
                else if (tab === "audit") setActiveSection("audit_monitoring");
                else if (tab === "console" && isSuperAdmin) setActiveSection("admin_roles");
              }}
            />
          )}

          {/* SECTION 2: Investors & KYC */}
          {activeSection === "investors_kyc" && <ComplianceOfficerPanel />}

          {/* SECTION 3: Bond Management */}
          {activeSection === "bond_management" && <IssuerPanel initialSubTab="designer" />}

          {/* SECTION 4: Payments & Coupons */}
          {activeSection === "payments_coupons" && <AdminCouponTerminal />}

          {/* SECTION 5: Audit & Monitoring */}
          {activeSection === "audit_monitoring" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.5rem" }}>
                <button
                  className={`btn btn-sm ${auditSubTab === "logs" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setAuditSubTab("logs")}
                  style={{ gap: "0.35rem" }}
                >
                  <History size={13} />
                  <span>Audit Trail Logs</span>
                </button>
                <button
                  className={`btn btn-sm ${auditSubTab === "reserves" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setAuditSubTab("reserves")}
                  style={{ gap: "0.35rem" }}
                >
                  <Activity size={13} />
                  <span>Proof of Reserves & Oracles</span>
                </button>
              </div>

              {auditSubTab === "logs" ? (
                <AdminAuditLogs />
              ) : (
                <Transparency
                  provider={readProvider}
                  network={network}
                  refreshTrigger={refreshTrigger}
                  setRefreshTrigger={setRefreshTrigger}
                />
              )}
            </div>
          )}

          {/* SECTION 6 (Super Admin Only): Access & Governance */}
          {activeSection === "admin_roles" && isSuperAdmin && <SuperAdminPanel />}
        </main>
      </div>
    </div>
  );
}

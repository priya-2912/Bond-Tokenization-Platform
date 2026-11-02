import React, { useState, useEffect, Component } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider, useToast } from "./components/Toast";
import Navbar from "./components/Navbar";
import LandingPage from "./components/LandingPage";
import InvestorOverview from "./components/InvestorOverview";
import BondMarketplaceView from "./components/BondMarketplaceView";
import SecondaryMarketplaceView from "./components/SecondaryMarketplaceView";
import InvestorPortfolioView from "./components/InvestorPortfolioView";
import InvestorIncomeView from "./components/InvestorIncomeView";
import InvestorAccountView from "./components/InvestorAccountView";
import InstitutionalPortal from "./components/InstitutionalPortal";
import InvestorAuthModal from "./components/InvestorAuthModal";
import InstitutionalAuthModal from "./components/InstitutionalAuthModal";
import { EmptyState } from "./components/ui";
import { NETWORKS, isDeployed } from "./contracts/platform";
import { MASTER_ADMIN_WALLET } from "./lib/useRoles";
import { friendlyError } from "./lib/utils";

// Error Boundary to prevent white screen of death
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Platform Runtime Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "3rem 1.5rem", maxWidth: 650, margin: "4rem auto", textAlign: "center" }} className="card">
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>⚠️</div>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 800 }}>Something went wrong</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
            An unexpected view rendering error occurred: {this.state.error?.message || "Render error"}
          </p>
          <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "center", gap: "0.75rem" }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              Reload Platform
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function MainPlatform() {
  const {
    account,
    readProvider,
    signer,
    network,
    user,
    isAuthenticated,
    isInstitutional,
    isKycVerified,
    chainOk,
    walletChainId,
    deployed,
    switchChain,
    refreshTrigger,
    setRefreshTrigger,
    roles,
  } = useAuth();

  const toast = useToast();

  // Navigation state: "landing" | "investor" | "institutional"
  const [currentView, setCurrentView] = useState("landing");
  // 6-section Investor portal tab: "overview" | "explore" | "secondary" | "investments" | "income" | "account"
  const [investorTab, setInvestorTab] = useState("overview");

  // Normalize tab so legacy or alias tab values (dashboard, marketplace, profile, kyc, etc.) NEVER render blank
  const normalizedTab = (() => {
    if (investorTab === "overview" || investorTab === "dashboard") return "overview";
    if (investorTab === "explore" || investorTab === "marketplace") return "explore";
    if (investorTab === "secondary") return "secondary";
    if (investorTab === "investments" || investorTab === "portfolio") return "investments";
    if (investorTab === "income" || investorTab === "coupons") return "income";
    if (investorTab === "account" || investorTab === "kyc" || investorTab === "profile" || investorTab === "transparency") return "account";
    return "overview";
  })();

  // Modals state
  const [investorAuthOpen, setInvestorAuthOpen] = useState(false);
  const [investorAuthMode, setInvestorAuthMode] = useState("signin");
  const [institutionalAuthOpen, setInstitutionalAuthOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  // Auto-switch to institutional view if officer, or investor view if regular investor
  useEffect(() => {
    const isMasterAdmin = account && account.toLowerCase() === MASTER_ADMIN_WALLET;
    const isOfficer = Boolean(
      isInstitutional ||
      isMasterAdmin ||
      roles?.isMasterAdmin ||
      roles?.admin ||
      roles?.compliance ||
      roles?.issuer ||
      (user && ["admin", "super_admin", "compliance", "issuer"].includes(user.role))
    );

    if (currentView === "landing") {
      if (isOfficer) {
        setCurrentView("institutional");
        toast.info("Institutional role detected. Switched to Institutional Terminal.");
      } else if (isAuthenticated) {
        setCurrentView("investor");
      }
    }
  }, [account, isAuthenticated, isInstitutional, roles, user, currentView]);

  const openInvestorAuth = (mode = "signin") => {
    setInvestorAuthMode(mode);
    setInvestorAuthOpen(true);
  };

  const openInstitutionalAuth = () => {
    setInstitutionalAuthOpen(true);
  };

  const handleSwitchNetwork = async () => {
    try {
      await switchChain();
    } catch (err) {
      toast.error(`Could not switch network: ${friendlyError(err)}`);
    }
  };

  const common = {
    account,
    provider: readProvider,
    signer,
    network,
    refreshTrigger,
    setRefreshTrigger,
  };

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <Navbar
        currentView={currentView}
        setCurrentView={setCurrentView}
        investorTab={normalizedTab}
        setInvestorTab={setInvestorTab}
        onOpenInvestorAuth={openInvestorAuth}
        onOpenInstitutionalAuth={openInstitutionalAuth}
      />

      {/* Main Content Area */}
      <main className={currentView === "institutional" ? "" : "main-content"}>
        {/* Network Mismatch Warning Banner */}
        {account && !chainOk && (
          <div className="alert-banner warn" style={{ margin: "1rem auto", maxWidth: 1240 }}>
            <span>
              Your wallet is connected to Chain ID {walletChainId}, but you are viewing {NETWORKS[network].label}.
              Transactions require switching your wallet.
            </span>
            <button className="btn btn-primary btn-sm" onClick={handleSwitchNetwork}>
              Switch to {NETWORKS[network].label}
            </button>
          </div>
        )}

        {/* Missing Deployment Warning */}
        {!deployed ? (
          <EmptyState title={`No deployment found for ${NETWORKS[network].label}`}>
            <p>
              <span className="font-mono">shared/addresses.json</span> has no complete entry for <b>{network}</b>.
            </p>
            <p style={{ marginTop: "0.5rem" }}>
              Run <span className="font-mono">npm run deploy:{network === "sepolia" ? "sepolia" : "local"}</span> in the project root.
            </p>
          </EmptyState>
        ) : (
          <>
            {/* VIEW 1: Public Landing Page */}
            {currentView === "landing" && (
              <LandingPage
                provider={readProvider}
                network={network}
                onExploreMarketplace={() => {
                  setCurrentView("investor");
                  setInvestorTab("explore");
                }}
                onInvestorLogin={() => openInvestorAuth("signin")}
                onInstitutionalLogin={openInstitutionalAuth}
                onSignUp={() => openInvestorAuth("signup")}
              />
            )}

            {/* VIEW 2: Investor Portal Experience (6 Sections) */}
            {currentView === "investor" && (
              <ErrorBoundary>
                {normalizedTab === "overview" && (
                  <InvestorOverview
                    onExplore={() => setInvestorTab("explore")}
                    onGoToAccount={() => setInvestorTab("account")}
                    onGoToInvestments={() => setInvestorTab("investments")}
                    onGoToIncome={() => setInvestorTab("income")}
                  />
                )}
                {normalizedTab === "explore" && (
                  <BondMarketplaceView
                    onNavigateToAccount={() => setInvestorTab("account")}
                    onViewInvestments={() => setInvestorTab("investments")}
                    onNavigateToSecondary={() => setInvestorTab("secondary")}
                  />
                )}
                {normalizedTab === "secondary" && (
                  <SecondaryMarketplaceView
                    onNavigateToAccount={() => setInvestorTab("account")}
                  />
                )}
                {normalizedTab === "investments" && (
                  <InvestorPortfolioView
                    onExplore={() => setInvestorTab("explore")}
                    onGoToIncome={() => setInvestorTab("income")}
                  />
                )}
                {normalizedTab === "income" && (
                  <InvestorIncomeView
                    onExplore={() => setInvestorTab("explore")}
                  />
                )}
                {normalizedTab === "account" && (
                  <InvestorAccountView
                    onNavigateToExplore={() => setInvestorTab("explore")}
                  />
                )}
              </ErrorBoundary>
            )}

            {/* VIEW 3: Institutional & Compliance Portal Experience */}
            {currentView === "institutional" && (
              <ErrorBoundary>
                <InstitutionalPortal onSwitchToInvestor={() => setCurrentView("investor")} />
              </ErrorBoundary>
            )}
          </>
        )}
      </main>

      {/* Global Modals */}
      <InvestorAuthModal
        isOpen={investorAuthOpen}
        onClose={() => setInvestorAuthOpen(false)}
        initialMode={investorAuthMode}
        onSuccess={() => {
          setCurrentView("investor");
          setInvestorTab("overview");
        }}
      />

      <InstitutionalAuthModal
        isOpen={institutionalAuthOpen}
        onClose={() => setInstitutionalAuthOpen(false)}
        onSuccess={() => {
          setCurrentView("institutional");
        }}
      />

      {/* Footer (Public & Investor view) */}
      {currentView !== "institutional" && (
        <footer
          style={{
            borderTop: "1px solid var(--border-subtle)",
            padding: "1.75rem 1.5rem",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            backgroundColor: "rgba(10, 14, 23, 0.95)",
            marginTop: "auto",
          }}
        >
          <div
            style={{
              maxWidth: "1240px",
              margin: "0 auto",
              display: "flex",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.75rem",
              alignItems: "center",
            }}
          >
            <div>
              <b>Aura Bonds</b> • Institutional Debt Tokenization Platform • Ethereum Sepolia Testnet
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              <span>Compliant KYCRegistry</span>
              <span>•</span>
              <span>Proof of Reserves Guard</span>
              <span>•</span>
              <span>Chainlink Oracle Feeds</span>
              <span>•</span>
              <span>P2P Order Book Escrow</span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <MainPlatform />
      </AuthProvider>
    </ToastProvider>
  );
}

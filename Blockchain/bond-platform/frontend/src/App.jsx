import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import Navbar from "./components/Navbar";
import InvestorDashboard from "./components/InvestorDashboard";
import Marketplace from "./components/Marketplace";
import AdminConsole from "./components/AdminConsole";
import Transparency from "./components/Transparency";
import { getBrowserProvider, getContract, getAddresses, ADDRESSES } from "./contracts/platform";
import { AlertTriangle, ArrowRight, ShieldCheck, CheckCircle2 } from "lucide-react";

const CHAIN_CONFIG = {
  localhost: {
    chainIdHex: "0x7a69", // 31337
    chainIdDecimal: 31337,
    name: "Hardhat Localhost (8545)",
    rpcUrl: "http://127.0.0.1:8545",
  },
  sepolia: {
    chainIdHex: "0xaa36a7", // 11155111
    chainIdDecimal: 11155111,
    name: "Sepolia Testnet",
    rpcUrl: "https://rpc.sepolia.org",
  },
};

export default function App() {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [network, setNetwork] = useState("localhost");
  const [walletChainId, setWalletChainId] = useState(null);
  const [isKycVerified, setIsKycVerified] = useState(false);
  const [userRoles, setUserRoles] = useState({
    isAdmin: false,
    isCompliance: false,
    isIssuer: false,
  });
  const [activeTab, setActiveTab] = useState("investor");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [txNotice, setTxNotice] = useState(null);

  // Initialize and listen to MetaMask events
  useEffect(() => {
    async function init() {
      if (typeof window !== "undefined" && window.ethereum) {
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        setProvider(browserProvider);

        try {
          const networkData = await browserProvider.getNetwork();
          setWalletChainId(Number(networkData.chainId));

          const accounts = await browserProvider.send("eth_accounts", []);
          if (accounts.length > 0) {
            setAccount(accounts[0]);
            const s = await browserProvider.getSigner();
            setSigner(s);
          }
        } catch (e) {
          console.warn("MetaMask initialization error:", e);
        }

        // Event listeners
        const handleAccountsChanged = async (accounts) => {
          if (accounts.length > 0) {
            setAccount(accounts[0]);
            const s = await browserProvider.getSigner();
            setSigner(s);
          } else {
            setAccount(null);
            setSigner(null);
          }
          setRefreshTrigger((prev) => prev + 1);
        };

        const handleChainChanged = (chainIdHex) => {
          setWalletChainId(parseInt(chainIdHex, 16));
          setRefreshTrigger((prev) => prev + 1);
        };

        window.ethereum.on("accountsChanged", handleAccountsChanged);
        window.ethereum.on("chainChanged", handleChainChanged);

        return () => {
          window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
          window.ethereum.removeListener("chainChanged", handleChainChanged);
        };
      } else {
        const rpc = network === "sepolia" ? CHAIN_CONFIG.sepolia.rpcUrl : CHAIN_CONFIG.localhost.rpcUrl;
        setProvider(new ethers.JsonRpcProvider(rpc));
      }
    }
    init();
  }, [network]);

  // Check KYC status and roles whenever account or network changes
  useEffect(() => {
    async function checkAccountInfo() {
      if (!account || !provider) {
        setIsKycVerified(false);
        setUserRoles({ isAdmin: false, isCompliance: false, isIssuer: false });
        return;
      }
      try {
        const addrs = getAddresses(network);
        if (!addrs || !addrs.KYCRegistry || !addrs.BondToken) {
          return;
        }

        const kyc = getContract("KYCRegistry", provider, network);
        const bond = getContract("BondToken", provider, network);

        const [verified, adminRole, complianceRole, issuerRole] = await Promise.all([
          kyc.isVerified(account).catch(() => false),
          bond.DEFAULT_ADMIN_ROLE().then((r) => bond.hasRole(r, account)).catch(() => false),
          kyc.COMPLIANCE_ROLE().then((r) => kyc.hasRole(r, account)).catch(() => false),
          bond.ISSUER_ROLE().then((r) => bond.hasRole(r, account)).catch(() => false),
        ]);

        setIsKycVerified(verified);
        setUserRoles({
          isAdmin: adminRole,
          isCompliance: complianceRole,
          isIssuer: issuerRole,
        });
      } catch (e) {
        console.warn("Error checking KYC and roles:", e);
      }
    }
    checkAccountInfo();
  }, [account, provider, network, walletChainId, refreshTrigger]);

  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        alert("MetaMask is not installed. Please install MetaMask to interact with the platform.");
        return;
      }
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await browserProvider.send("eth_requestAccounts", []);
      if (accounts.length > 0) {
        setAccount(accounts[0]);
        const s = await browserProvider.getSigner();
        setSigner(s);
        setProvider(browserProvider);
        const net = await browserProvider.getNetwork();
        setWalletChainId(Number(net.chainId));
      }
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    }
  };

  const switchChain = async (targetNetwork) => {
    if (!window.ethereum) return;
    const target = CHAIN_CONFIG[targetNetwork];
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: target.chainIdHex }],
      });
      setNetwork(targetNetwork);
    } catch (switchError) {
      // Chain not added to MetaMask (error code 4902, nested originalError, or unrecognized chain)
      const isMissingChain =
        switchError.code === 4902 ||
        switchError?.data?.originalError?.code === 4902 ||
        switchError?.message?.toLowerCase().includes("unrecognized chain") ||
        switchError?.message?.toLowerCase().includes("could not be found");

      if (isMissingChain) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: target.chainIdHex,
                chainName: target.name,
                rpcUrls: [target.rpcUrl],
                nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              },
            ],
          });
          setNetwork(targetNetwork);
        } catch (addError) {
          console.error("Failed to add network to MetaMask:", addError);
        }
      } else {
        console.error("Failed to switch network:", switchError);
      }
    }
  };

  const targetChain = CHAIN_CONFIG[network];
  const isWrongChain =
    account &&
    walletChainId !== null &&
    walletChainId !== targetChain.chainIdDecimal &&
    !(network === "localhost" && (walletChainId === 31337 || walletChainId === 1337));

  const hasDeployment = Boolean(ADDRESSES[network]?.BondToken);

  return (
    <div className="app-container">
      <Navbar
        account={account}
        network={network}
        setNetwork={setNetwork}
        connectWallet={connectWallet}
        isKycVerified={isKycVerified}
        userRoles={userRoles}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Network Mismatch Banner */}
      {isWrongChain && (
        <div
          style={{
            backgroundColor: "#7f1d1d",
            borderBottom: "1px solid #991b1b",
            color: "#fecaca",
            padding: "0.75rem 1.5rem",
            fontSize: "0.825rem",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <AlertTriangle size={16} color="#ef4444" />
            <span>
              Network Mismatch: Connected to Chain ID {walletChainId}, but UI is set to {targetChain.name}.
            </span>
          </div>
          <button
            onClick={() => switchChain(network)}
            className="btn btn-sm"
            style={{ backgroundColor: "#ef4444", color: "#fff", border: "none" }}
          >
            <span>Switch MetaMask to {targetChain.name}</span>
            <ArrowRight size={12} />
          </button>
        </div>
      )}

      {/* Sepolia Deployment Warning if Not Deployed */}
      {!hasDeployment && network === "sepolia" && (
        <div
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.15)",
            borderBottom: "1px solid rgba(245, 158, 11, 0.3)",
            color: "#fde68a",
            padding: "0.75rem 1.5rem",
            fontSize: "0.825rem",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <AlertTriangle size={16} color="#f59e0b" />
          <span>
            Sepolia contracts have not been deployed yet. Fund the deployer wallet and run{" "}
            <code style={{ background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px" }}>
              npm run deploy:sepolia
            </code>
            , or switch to <strong>Localhost (Hardhat)</strong> to test.
          </span>
        </div>
      )}

      {/* Global Transaction Hash Notice */}
      {txNotice && (
        <div
          className={`alert-banner ${txNotice.type}`}
          style={{ maxWidth: "1240px", margin: "1rem auto 0 auto", width: "92%" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CheckCircle2 size={16} />
            <span>{txNotice.text}</span>
            {txNotice.hash && network === "sepolia" && (
              <a
                href={`https://sepolia.etherscan.io/tx/${txNotice.hash}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#60a5fa", textDecoration: "underline", marginLeft: "0.5rem" }}
              >
                View on Etherscan
              </a>
            )}
          </div>
          <button
            onClick={() => setTxNotice(null)}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
      )}

      <main className="main-content">
        {activeTab === "investor" && (
          <InvestorDashboard
            account={account}
            provider={provider}
            signer={signer}
            network={network}
            isKycVerified={isKycVerified}
            refreshTrigger={refreshTrigger}
            setRefreshTrigger={setRefreshTrigger}
            setTxNotice={setTxNotice}
          />
        )}

        {activeTab === "marketplace" && (
          <Marketplace
            account={account}
            provider={provider}
            signer={signer}
            network={network}
            isKycVerified={isKycVerified}
            refreshTrigger={refreshTrigger}
            setRefreshTrigger={setRefreshTrigger}
            setTxNotice={setTxNotice}
          />
        )}

        {activeTab === "admin" && (
          <AdminConsole
            account={account}
            provider={provider}
            signer={signer}
            network={network}
            userRoles={userRoles}
            refreshTrigger={refreshTrigger}
            setRefreshTrigger={setRefreshTrigger}
            setTxNotice={setTxNotice}
          />
        )}

        {activeTab === "transparency" && (
          <Transparency
            provider={provider}
            network={network}
            refreshTrigger={refreshTrigger}
          />
        )}
      </main>

      <footer
        style={{
          borderTop: "1px solid var(--border-subtle)",
          padding: "1.75rem 1.5rem",
          textAlign: "center",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          backgroundColor: "rgba(10, 14, 23, 0.95)",
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
          <div>Aura Bonds Tokenization Platform • Institutional RWA Infrastructure</div>
          <div style={{ display: "flex", gap: "1rem" }}>
            <span>Compliant KYC Registry</span>
            <span>•</span>
            <span>Proof of Reserves</span>
            <span>•</span>
            <span>Secondary Order Book</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

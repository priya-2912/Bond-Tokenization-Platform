import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import Navbar from "./components/Navbar";
import InvestorDashboard from "./components/InvestorDashboard";
import Marketplace from "./components/Marketplace";
import AdminConsole from "./components/AdminConsole";
import Transparency from "./components/Transparency";
import { getBrowserProvider, getContract } from "./contracts/platform";

export default function App() {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [network, setNetwork] = useState("localhost");
  const [isKycVerified, setIsKycVerified] = useState(false);
  const [activeTab, setActiveTab] = useState("investor");
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Initialize provider and account
  useEffect(() => {
    async function init() {
      const browserProvider = await getBrowserProvider();
      if (browserProvider) {
        setProvider(browserProvider);
        try {
          const accounts = await browserProvider.send("eth_accounts", []);
          if (accounts.length > 0) {
            setAccount(accounts[0]);
            const s = await browserProvider.getSigner();
            setSigner(s);
          }
        } catch (e) {
          console.warn("Could not retrieve initial accounts:", e);
        }
      } else {
        const rpc = network === "sepolia" ? "https://rpc.sepolia.org" : "http://127.0.0.1:8545";
        setProvider(new ethers.JsonRpcProvider(rpc));
      }
    }
    init();
  }, [network]);

  // Check KYC status on address or network change
  useEffect(() => {
    async function checkKyc() {
      if (!account || !provider) {
        setIsKycVerified(false);
        return;
      }
      try {
        const kyc = getContract("KYCRegistry", provider, network);
        const verified = await kyc.isVerified(account);
        setIsKycVerified(verified);
      } catch (e) {
        console.warn("Error checking KYC status:", e);
        setIsKycVerified(false);
      }
    }
    checkKyc();
  }, [account, provider, network, refreshTrigger]);

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
      }
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    }
  };

  return (
    <div className="app-container">
      <Navbar
        account={account}
        network={network}
        setNetwork={setNetwork}
        connectWallet={connectWallet}
        isKycVerified={isKycVerified}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

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
          />
        )}

        {activeTab === "admin" && (
          <AdminConsole
            account={account}
            provider={provider}
            signer={signer}
            network={network}
            refreshTrigger={refreshTrigger}
            setRefreshTrigger={setRefreshTrigger}
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
        <div style={{ maxWidth: "1240px", margin: "0 auto", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <div>
            Aura Bonds Tokenization Platform • Institutional RWA Infrastructure
          </div>
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

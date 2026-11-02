import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import {
  getContract,
  getAddresses,
  USDC_DECIMALS,
  txUrl,
  addressUrl,
} from "../contracts/platform";
import { toUnits, fromUnits, fmtNumber, shortAddr, friendlyError } from "../lib/utils";
import { requestFaucetFunds, getFaucetInfo } from "../lib/backend";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import { Modal } from "./ui";
import {
  Coins,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Wallet,
  ArrowRight,
  Info,
  Copy,
  Check,
  Zap,
} from "lucide-react";

export default function TestUsdcFaucetModal({
  isOpen,
  onClose,
  initialAmount = "5000",
  onSuccess,
}) {
  const { account, signer, readProvider, network, setRefreshTrigger } = useAuth();
  const toast = useToast();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState(initialAmount);
  const [currentBalance, setCurrentBalance] = useState(null);
  const [faucetMode, setFaucetMode] = useState("sponsored"); // "sponsored" | "direct"
  const [loading, setLoading] = useState(false);
  const [stepMessage, setStepMessage] = useState("");
  const [error, setError] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const addrs = getAddresses(network);

  // Sync recipient and balance when modal opens
  useEffect(() => {
    if (account) {
      setRecipient(account);
    }
    if (initialAmount) {
      setAmount(String(initialAmount));
    }
    setTxHash(null);
    setError(null);
    setConfirmed(false);
  }, [account, initialAmount, isOpen]);

  // Load live MockUSDC balance
  const loadBalance = async () => {
    const target = recipient || account;
    if (!target || !ethers.isAddress(target) || !readProvider) return;
    try {
      const usdc = getContract("MockUSDC", readProvider, network);
      const bal = await usdc.balanceOf(target);
      setCurrentBalance(bal);
    } catch (e) {
      console.warn("Could not read MockUSDC balance:", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadBalance();
    }
  }, [recipient, account, isOpen, network]);

  if (!isOpen) return null;

  const copyAddress = async () => {
    if (!recipient) return;
    try {
      await navigator.clipboard.writeText(recipient);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleMint = async () => {
    setError(null);
    setTxHash(null);

    const targetAddr = recipient.trim();
    if (!targetAddr || !ethers.isAddress(targetAddr)) {
      return setError("Please provide a valid Ethereum wallet address.");
    }

    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return setError("Please enter a valid positive MockUSDC amount.");
    }
    if (numAmount > 100000) {
      return setError("Maximum faucet limit per request is 100,000 MockUSDC.");
    }

    setLoading(true);

    try {
      // MODE 1: Sponsored Backend Relayer (Zero Gas for investor)
      if (faucetMode === "sponsored") {
        setStepMessage("Requesting sponsored faucet distribution on Sepolia...");
        const res = await requestFaucetFunds(targetAddr, numAmount);

        if (res.ok && res.data?.txHash) {
          setTxHash(res.data.txHash);
          toast.success(`Successfully minted $${fmtNumber(numAmount)} MockUSDC!`);
          await loadBalance();
          setRefreshTrigger((n) => n + 1);
          if (onSuccess) onSuccess(res.data.txHash);
          return;
        }

        // If backend relayer failed, explain and provide direct fallback
        if (res.error) {
          console.warn("Sponsored faucet failed, suggesting direct wallet mint:", res.error);
          if (res.status === 404) {
            throw new Error("Backend faucet service returned 404 (restart backend server with 'npm start' to reload latest routes), or switch to 'Direct Web3 Mint' below to mint with MetaMask.");
          }
          throw new Error(`${res.error}. You can switch to 'Direct Web3 Mint' to execute directly.`);
        }
      }

      // MODE 2: Direct Web3 Mint via connected MetaMask signer
      if (!signer) {
        throw new Error("MetaMask is not connected. Connect your wallet or use Sponsored Faucet.");
      }

      setStepMessage(`Step 1/2: Preparing to mint $${fmtNumber(numAmount)} MockUSDC in MetaMask...`);
      const usdc = getContract("MockUSDC", signer, network);
      const rawAmount = toUnits(numAmount.toString(), USDC_DECIMALS);

      setStepMessage("Step 2/2: Confirm transaction in MetaMask...");
      const tx = await usdc.mint(targetAddr, rawAmount);
      setStepMessage("Waiting for Sepolia block confirmation...");
      const receipt = await tx.wait();

      setTxHash(receipt.hash);
      toast.success(`Successfully minted $${fmtNumber(numAmount)} MockUSDC on Sepolia!`);
      await loadBalance();
      setRefreshTrigger((n) => n + 1);
      if (onSuccess) onSuccess(receipt.hash);
    } catch (err) {
      console.error("Faucet mint error:", err);
      if (err.code === "ACTION_REJECTED" || err.code === 4001 || /user rejected/i.test(err.message || "")) {
        setError("Transaction was cancelled in your wallet.");
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setLoading(false);
      setStepMessage("");
    }
  };

  const presetAmounts = ["1000", "5000", "10000", "25000", "50000"];
  const explorerUrl = txHash ? txUrl(network, txHash) : null;
  const contractUrl = addressUrl(addrs.MockUSDC, network);

  return (
    <Modal title="Get Test MockUSDC — Sepolia Faucet" onClose={onClose}>
      {txHash ? (
        <div style={{ textAlign: "center", padding: "1.25rem 0" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(16, 185, 129, 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1rem auto",
            }}
          >
            <CheckCircle2 size={32} color="#10b981" />
          </div>

          <h4 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#fff" }}>
            Test Tokens Credited!
          </h4>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.35rem" }}>
            <b>${fmtNumber(amount)} MockUSDC</b> has been successfully minted and sent to your wallet on Sepolia.
          </p>

          <div
            style={{
              margin: "1.25rem 0",
              padding: "0.85rem",
              background: "var(--bg-input)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
              textAlign: "left",
              fontSize: "0.8rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span style={{ color: "var(--text-muted)" }}>Recipient Wallet</span>
              <span className="font-mono" style={{ color: "#60a5fa" }}>{shortAddr(recipient)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span style={{ color: "var(--text-muted)" }}>Updated MockUSDC Balance</span>
              <span className="font-mono" style={{ color: "#10b981", fontWeight: 800 }}>
                {currentBalance !== null ? `$${fmtNumber(fromUnits(currentBalance, USDC_DECIMALS))}` : "Updating..."}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Token Contract</span>
              <span className="font-mono" style={{ color: "var(--text-secondary)" }}>
                {shortAddr(addrs.MockUSDC)}
              </span>
            </div>
          </div>

          {explorerUrl && (
            <div style={{ marginBottom: "1.5rem" }}>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
                style={{ display: "inline-flex", gap: "0.4rem", color: "#10b981" }}
              >
                <span>View Transaction on Sepolia Etherscan</span>
                <ExternalLink size={13} />
              </a>
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={onClose}
            style={{ width: "100%", padding: "0.65rem" }}
          >
            Return to Offering
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.95rem" }}>
          {/* Explanation Header */}
          <div
            style={{
              padding: "0.85rem 1rem",
              background: "rgba(59, 130, 246, 0.08)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.78rem",
              lineHeight: 1.5,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontWeight: 700, color: "#60a5fa", marginBottom: "0.25rem" }}>
              <Info size={14} />
              <span>Sepolia Testnet Stablecoin Faucet</span>
            </div>
            <div style={{ color: "var(--text-secondary)" }}>
              Mint test <b>MockUSDC (mUSDC)</b> to simulate bond subscription and investments. This uses the deployed <span className="font-mono">MockUSDC</span> contract with 6 decimals. No real money or real USDC is used.
            </div>
          </div>

          {/* Recipient Wallet Section */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-primary)" }}>
                Recipient Wallet Address *
              </label>
              {currentBalance !== null && (
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  Current Balance: <b style={{ color: "#10b981" }}>${fmtNumber(fromUnits(currentBalance, USDC_DECIMALS))}</b>
                </span>
              )}
            </div>

            <div style={{ position: "relative" }}>
              <input
                type="text"
                className="search-input font-mono"
                style={{ fontSize: "0.8rem", paddingRight: "2.5rem" }}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value.trim())}
                placeholder="0x..."
              />
              <button
                type="button"
                onClick={copyAddress}
                style={{
                  position: "absolute",
                  right: "0.6rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                }}
                title="Copy Address"
              >
                {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          {/* Amount Selection */}
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
              Test Token Amount (MockUSDC) *
            </label>

            {/* Quick preset pills */}
            <div style={{ display: "flex", gap: "0.45rem", marginBottom: "0.6rem", flexWrap: "wrap" }}>
              {presetAmounts.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={`btn btn-sm ${amount === amt ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setAmount(amt)}
                  style={{ fontSize: "0.75rem", padding: "0.3rem 0.65rem" }}
                >
                  ${fmtNumber(amt)}
                </button>
              ))}
            </div>

            <div style={{ position: "relative" }}>
              <input
                type="number"
                min="1"
                max="100000"
                step="1"
                className="search-input font-mono"
                style={{ fontSize: "0.95rem", fontWeight: 700 }}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 5000"
              />
              <span
                style={{
                  position: "absolute",
                  right: "1rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  fontWeight: 700,
                }}
              >
                MockUSDC
              </span>
            </div>
          </div>

          {/* Faucet Method Selection */}
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, display: "block", marginBottom: "0.35rem" }}>
              Minting Channel
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
              <div
                onClick={() => setFaucetMode("sponsored")}
                style={{
                  padding: "0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: faucetMode === "sponsored" ? "2px solid #10b981" : "1px solid var(--border-subtle)",
                  background: faucetMode === "sponsored" ? "rgba(16, 185, 129, 0.08)" : "var(--bg-input)",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.8rem", color: "#10b981" }}>
                  <Zap size={14} />
                  <span>Sponsored Relayer</span>
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                  Zero gas required. Fast server relayer execution.
                </div>
              </div>

              <div
                onClick={() => setFaucetMode("direct")}
                style={{
                  padding: "0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: faucetMode === "direct" ? "2px solid #3b82f6" : "1px solid var(--border-subtle)",
                  background: faucetMode === "direct" ? "rgba(59, 130, 246, 0.08)" : "var(--bg-input)",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 700, fontSize: "0.8rem", color: "#60a5fa" }}>
                  <Wallet size={14} />
                  <span>Direct Web3 Mint</span>
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                  Sign directly from MetaMask using Sepolia gas.
                </div>
              </div>
            </div>
          </div>

          {/* Summary / Confirmation Box */}
          <div
            style={{
              padding: "0.85rem",
              background: "var(--bg-input)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
              fontSize: "0.78rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
              <span style={{ color: "var(--text-muted)" }}>Token:</span>
              <span>Mock USD Coin (mUSDC, 6 decimals)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
              <span style={{ color: "var(--text-muted)" }}>Contract:</span>
              <a href={contractUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>
                {shortAddr(addrs.MockUSDC)}
              </a>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Mint Amount:</span>
              <span className="font-mono" style={{ fontWeight: 800, color: "#10b981" }}>
                +${fmtNumber(amount || 0)} MockUSDC
              </span>
            </div>
          </div>

          {error && (
            <div className="alert-banner error" style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: "0.78rem", lineHeight: 1.4 }}>{error}</span>
              </div>
              {faucetMode === "sponsored" && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setFaucetMode("direct");
                    setError(null);
                  }}
                  style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem", alignSelf: "flex-end" }}
                >
                  Switch to Direct Web3 Mint
                </button>
              )}
            </div>
          )}

          {loading && (
            <div className="alert-banner info" style={{ margin: 0 }}>
              <RefreshCw size={14} className="spin" />
              <span style={{ fontSize: "0.78rem" }}>{stepMessage || "Executing mint on Sepolia testnet..."}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              className="btn btn-emerald btn-sm"
              onClick={handleMint}
              disabled={loading || !amount || Number(amount) <= 0 || !recipient}
              style={{ gap: "0.45rem", padding: "0.5rem 1.25rem" }}
            >
              <Coins size={14} />
              <span>{loading ? "Minting on Chain..." : `Confirm & Mint $${fmtNumber(amount || 0)} USDC`}</span>
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}


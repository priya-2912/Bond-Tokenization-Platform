import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContract, getAddresses } from "../contracts/platform";
import {
  Activity,
  ExternalLink,
  Shield,
  Layers,
  Database,
  TrendingUp,
  RefreshCw,
  CheckCircle,
  AlertTriangle
} from "lucide-react";

export default function Transparency({ provider, network, refreshTrigger }) {
  const [metrics, setMetrics] = useState({
    totalSupply: "0",
    requiredReserves: "0",
    reportedReserves: "0",
    reserveRatioBps: 10000,
    oracleUpdated: null,
    ethPrice: "0",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (provider) {
      loadTransparencyData();
    }
  }, [provider, network, refreshTrigger]);

  const loadTransparencyData = async () => {
    try {
      setLoading(true);
      const bondToken = getContract("BondToken", provider, network);
      const reserveGuard = getContract("ReserveGuard", provider, network);
      const priceReader = getContract("ChainlinkPriceReader", provider, network);

      const [supply, req, resData, ratio, priceData] = await Promise.all([
        bondToken.totalSupply(),
        reserveGuard.requiredReserves(),
        reserveGuard.reserves(),
        reserveGuard.reserveRatioBps(),
        priceReader.latestPrice().catch(() => [0n, 8, 0n]),
      ]);

      setMetrics({
        totalSupply: ethers.formatUnits(supply, 18),
        requiredReserves: ethers.formatUnits(req, 6),
        reportedReserves: ethers.formatUnits(resData.amount, 6),
        reserveRatioBps: Number(ratio),
        oracleUpdated: new Date(Number(resData.updatedAt) * 1000),
        ethPrice: (Number(priceData[0]) / 10 ** Number(priceData[1])).toFixed(2),
      });
    } catch (err) {
      console.error("Error loading transparency data:", err);
    } finally {
      setLoading(false);
    }
  };

  const addresses = getAddresses(network);
  const isSepolia = network === "sepolia";
  const etherscanBase = "https://sepolia.etherscan.io/address/";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Header */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="badge badge-emerald">ON-CHAIN AUDIT</span>
              <span className="badge badge-blue">REAL-TIME ORACLE SYNC</span>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Transparency & Proof of Reserves
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Verifiable proof of backing assets, independent Chainlink oracle price feeds, and smart contract registry.
            </p>
          </div>

          <button onClick={loadTransparencyData} className="btn-icon" title="Refresh audit metrics">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 4 Metrics */}
      <div className="grid-4">
        <div className="stat-box">
          <div className="stat-label">
            <span>Outstanding Supply</span>
            <Layers size={16} color="#3b82f6" />
          </div>
          <div className="stat-value font-mono">
            {Number(metrics.totalSupply).toLocaleString()} CB28
          </div>
          <div className="stat-sub">$1,000.00 / Bond Face Value</div>
        </div>

        <div className="stat-box">
          <div className="stat-label">
            <span>Required Reserves</span>
            <Database size={16} color="#94a3b8" />
          </div>
          <div className="stat-value font-mono">
            ${Number(metrics.requiredReserves).toLocaleString()}
          </div>
          <div className="stat-sub">MockUSDC 100% Target</div>
        </div>

        <div className="stat-box">
          <div className="stat-label">
            <span>Reported Collateral</span>
            <Shield size={16} color="#10b981" />
          </div>
          <div className="stat-value font-mono" style={{ color: "var(--accent-emerald)" }}>
            ${Number(metrics.reportedReserves).toLocaleString()}
          </div>
          <div className="stat-sub">
            Coverage Ratio: {((metrics.reserveRatioBps) / 100).toFixed(1)}%
          </div>
        </div>

        <div className="stat-box">
          <div className="stat-label">
            <span>Chainlink ETH / USD</span>
            <TrendingUp size={16} color="#3b82f6" />
          </div>
          <div className="stat-value font-mono" style={{ color: "#60a5fa" }}>
            ${metrics.ethPrice}
          </div>
          <div className="stat-sub">
            {isSepolia ? "Real Sepolia Feed" : "Local Mock Feed"}
          </div>
        </div>
      </div>

      {/* Real vs Mocked Architecture Matrix */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              <Database size={18} color="#3b82f6" />
              Real vs. Mocked Architecture Matrix
            </h3>
            <p className="card-subtitle">
              Transparent disclosure of prototype testnet components versus live production implementation standards.
            </p>
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Current Status ({network.toUpperCase()})</th>
                <th>Production Architecture</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>ETH / USD Price Reader</td>
                <td>
                  <span className="badge badge-emerald">
                    {isSepolia ? "Real Chainlink Feed (0x694A...5306)" : "Local Mock Price Feed"}
                  </span>
                </td>
                <td>Chainlink Decentralized Oracle Network on Ethereum Mainnet</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>Proof of Reserves (PoR)</td>
                <td>
                  <span className="badge badge-amber">Mock ReserveOracle (AggregatorV3 Shape)</span>
                </td>
                <td>Automated Chainlink PoR feed hooked into audited bank/custodian balance APIs</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>Bond Yield Benchmark</td>
                <td>
                  <span className="badge badge-amber">Mock YieldOracle (800 bps = 8.00%)</span>
                </td>
                <td>Chainlink Data Streams / Sovereign Treasury Yield Index</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>KYC & Identity Verification</td>
                <td>
                  <span className="badge badge-blue">On-Chain KYCRegistry (Compliance Role)</span>
                </td>
                <td>ERC-3643 (ONCHAINID) with identity providers (Sumsub, Fractal ID, Quadrata)</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>Settlement Stablecoin</td>
                <td>
                  <span className="badge badge-emerald">MockUSDC (6 Decimals, Faucet Enabled)</span>
                </td>
                <td>Circle USDC (`0xA0b8...6eB48`) or Institutional Euro Stablecoin</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Smart Contract Registry */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              <Activity size={18} color="#10b981" />
              Smart Contract Deployment Registry
            </h3>
            <p className="card-subtitle">
              Verified addresses for all contracts deployed to {network.toUpperCase()}.
            </p>
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Contract Name</th>
                <th>Contract Address</th>
                <th style={{ textAlign: "right" }}>Explorer Verification</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(addresses)
                .filter(([key]) => key !== "deployBlock" && key !== "timestamp")
                .map(([name, addr]) => (
                  <tr key={name}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{name}</td>
                    <td className="font-mono" style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      {addr}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {isSepolia ? (
                        <a
                          href={`${etherscanBase}${addr}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-secondary btn-sm"
                          style={{ gap: "0.35rem" }}
                        >
                          <span>Etherscan</span>
                          <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="badge" style={{ backgroundColor: "rgba(100, 116, 139, 0.2)", color: "var(--text-muted)" }}>
                          Localhost Node
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

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
  AlertTriangle,
  History,
  AlertOctagon,
  CheckCircle2,
  Filter
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
  const [events, setEvents] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState("all");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (provider) {
      loadTransparencyData();
      loadEventHistory();
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

  const loadEventHistory = async () => {
    try {
      // 1. Try fetching from backend indexer first
      let loadedEvents = [];
      try {
        const res = await fetch("http://localhost:4000/api/events?limit=40");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            loadedEvents = data.map((e) => ({
              contract: e.contract,
              type: e.type,
              blockNumber: e.block_number,
              txHash: e.tx_hash,
              args: typeof e.args === "string" ? JSON.parse(e.args) : e.args,
              timestamp: e.created_at,
            }));
          }
        }
      } catch {
        // Backend not running, proceed to direct RPC querying
      }

      // 2. Query ReserveGuard events directly on-chain if backend returned nothing or for freshness
      if (loadedEvents.length === 0 && provider) {
        try {
          const reserveGuard = getContract("ReserveGuard", provider, network);
          const currentBlock = await provider.getBlockNumber();
          const fromBlock = Math.max(0, currentBlock - 2000);

          const [alerts, restores] = await Promise.all([
            reserveGuard.queryFilter(reserveGuard.filters.ReserveAlert(), fromBlock, "latest").catch(() => []),
            reserveGuard.queryFilter(reserveGuard.filters.ReserveRestored(), fromBlock, "latest").catch(() => []),
          ]);

          const onChainLogs = [];
          alerts.forEach((log) => {
            onChainLogs.push({
              contract: "ReserveGuard",
              type: "ReserveAlert",
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              args: {
                currentRatioBps: log.args[0]?.toString(),
                requiredReserves: log.args[1]?.toString(),
                actualReserves: log.args[2]?.toString(),
              },
              timestamp: new Date().toLocaleTimeString(),
            });
          });

          restores.forEach((log) => {
            onChainLogs.push({
              contract: "ReserveGuard",
              type: "ReserveRestored",
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              args: {
                currentRatioBps: log.args[0]?.toString(),
              },
              timestamp: new Date().toLocaleTimeString(),
            });
          });

          loadedEvents = onChainLogs.reverse();
        } catch (chainErr) {
          console.warn("Direct event query warning:", chainErr);
        }
      }

      setEvents(loadedEvents);
    } catch (err) {
      console.error("Error loading events:", err);
    }
  };

  const addresses = getAddresses(network);
  const isSepolia = network === "sepolia";
  const etherscanBase = "https://sepolia.etherscan.io/address/";
  const etherscanTxBase = "https://sepolia.etherscan.io/tx/";

  const filteredEvents = events.filter((e) => {
    if (selectedFilter === "all") return true;
    if (selectedFilter === "alerts") return e.type === "ReserveAlert";
    if (selectedFilter === "restored") return e.type === "ReserveRestored";
    if (selectedFilter === "market") return ["OrderCreated", "OrderFilled", "OrderCancelled"].includes(e.type);
    return true;
  });

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

          <button onClick={() => { loadTransparencyData(); loadEventHistory(); }} className="btn-icon" title="Refresh audit metrics">
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

      {/* On-Chain Reserve Audit & Event Log History */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <h3 className="card-title">
              <History size={18} color="#f59e0b" />
              Proof of Reserve Circuit Breaker & Platform Event Log
            </h3>
            <p className="card-subtitle">
              Persistent event monitoring powered by ReserveGuard and platform indexer.
            </p>
          </div>

          {/* Event Filter Pills */}
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            <button
              onClick={() => setSelectedFilter("all")}
              className={`btn btn-sm ${selectedFilter === "all" ? "btn-primary" : "btn-secondary"}`}
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem" }}
            >
              All Events ({events.length})
            </button>
            <button
              onClick={() => setSelectedFilter("alerts")}
              className={`btn btn-sm ${selectedFilter === "alerts" ? "btn-rose" : "btn-secondary"}`}
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem" }}
            >
              Reserve Alerts
            </button>
            <button
              onClick={() => setSelectedFilter("restored")}
              className={`btn btn-sm ${selectedFilter === "restored" ? "btn-emerald" : "btn-secondary"}`}
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem" }}
            >
              Restorations
            </button>
            <button
              onClick={() => setSelectedFilter("market")}
              className={`btn btn-sm ${selectedFilter === "market" ? "btn-primary" : "btn-secondary"}`}
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem" }}
            >
              Marketplace
            </button>
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event Type</th>
                <th>Contract</th>
                <th>Audit Details & Parameters</th>
                <th>Block</th>
                <th style={{ textAlign: "right" }}>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                    No events recorded yet in the current indexer window. Trigger a reserve change or "Emit Reserve Check Event" in Admin Console.
                  </td>
                </tr>
              ) : (
                filteredEvents.map((evt, idx) => {
                  const isAlert = evt.type === "ReserveAlert";
                  const isRestored = evt.type === "ReserveRestored";
                  const badgeClass = isAlert
                    ? "badge-rose"
                    : isRestored
                    ? "badge-emerald"
                    : "badge-blue";

                  let detailText = "";
                  if (isAlert) {
                    const ratio = evt.args?.currentRatioBps ? (Number(evt.args.currentRatioBps) / 100).toFixed(1) : "N/A";
                    const req = evt.args?.requiredReserves ? `$${(Number(evt.args.requiredReserves) / 1e6).toLocaleString()}` : "";
                    const act = evt.args?.actualReserves ? `$${(Number(evt.args.actualReserves) / 1e6).toLocaleString()}` : "";
                    detailText = `CRITICAL: Reserve dropped to ${ratio}% (${act} / ${req} USD required)`;
                  } else if (isRestored) {
                    const ratio = evt.args?.currentRatioBps ? (Number(evt.args.currentRatioBps) / 100).toFixed(1) : "N/A";
                    detailText = `RESTORED: Reserves replenished to ${ratio}% coverage ratio`;
                  } else {
                    detailText = Object.entries(evt.args || {})
                      .slice(0, 3)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ");
                  }

                  return (
                    <tr key={`${evt.txHash}-${idx}`}>
                      <td>
                        <span className={`badge ${badgeClass}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          {isAlert && <AlertOctagon size={11} />}
                          {isRestored && <CheckCircle2 size={11} />}
                          {evt.type}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                        {evt.contract}
                      </td>
                      <td style={{ fontSize: "0.8rem", color: isAlert ? "var(--accent-rose)" : isRestored ? "var(--accent-emerald)" : "var(--text-secondary)" }}>
                        {detailText}
                      </td>
                      <td className="font-mono" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        #{evt.blockNumber}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {isSepolia && evt.txHash ? (
                          <a
                            href={`${etherscanTxBase}${evt.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary btn-sm"
                            style={{ gap: "0.25rem", padding: "0.2rem 0.5rem", fontSize: "0.7rem" }}
                          >
                            <span>{evt.txHash.slice(0, 6)}...</span>
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="font-mono" style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                            {evt.txHash ? `${evt.txHash.slice(0, 8)}...` : "Local"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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

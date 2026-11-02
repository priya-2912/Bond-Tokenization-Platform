import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContract, getAddresses, loadTerms, NETWORKS, addressUrl, BOND_DECIMALS, USDC_DECIMALS } from "../contracts/platform";
import { fromUnits, fmtNumber, timeAgo, shortAddr } from "../lib/utils";
import { fetchBackendEvents } from "../lib/backend";
import { Activity, ExternalLink, Shield, Layers, Database, TrendingUp, RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";

const MAX_LOG_CALLS = 40; // never scan more than 40 log ranges for the alert history

export default function Transparency({ provider, network, refreshTrigger, setRefreshTrigger }) {
  const [m, setM] = useState(null);
  const [events, setEvents] = useState([]);
  const [feed, setFeed] = useState({ rows: [], offline: false });
  const [feedFilter, setFeedFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const addresses = getAddresses(network);
  const live = network === "sepolia";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const bond = getContract("BondToken", provider, network);
        const guard = getContract("ReserveGuard", provider, network);
        const reader = getContract("ChainlinkPriceReader", provider, network);
        const [terms, supply, req, res, ratio, minRatio, stale, price] = await Promise.all([
          loadTerms(provider, network),
          bond.totalSupply(),
          guard.requiredReserves(),
          guard.reserves(),
          guard.reserveRatioBps(),
          guard.minRatioBps(),
          guard.maxStaleness(),
          reader.latestPrice().then((p) => ({ price: p[0], decimals: Number(p[1]), updatedAt: new Date(Number(p[2]) * 1000) })).catch(() => null),
        ]);
        let yieldInfo = null;
        try {
          if (addresses.YieldOracle) {
            const y = getContract("YieldOracle", provider, network);
            const [r, d] = await Promise.all([y.latestRoundData(), y.decimals()]);
            yieldInfo = { value: r[1], decimals: Number(d), updatedAt: new Date(Number(r[3]) * 1000) };
          }
        } catch (e) {
          yieldInfo = null;
        }
        if (cancelled) return;
        setM({ yieldInfo, terms, supply, req, reserves: res.amount, oracleUpdated: new Date(Number(res.updatedAt) * 1000), ratio, minRatio: Number(minRatio), stale: Number(stale), price });
      } catch (err) {
        console.error("Error loading transparency data:", err);
        if (!cancelled) setLoadError("Could not read on-chain data. Check the network selection and RPC connection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, network, refreshTrigger]);

  // Recent ReserveAlert / ReserveRestored events (scans backwards from the latest block).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const guard = getContract("ReserveGuard", provider, network);
        const latest = await provider.getBlockNumber();
        const from = Number(addresses.deployBlock || 0);
        const size = NETWORKS[network].logChunk;
        const found = [];
        let end = latest;
        for (let calls = 0; calls < MAX_LOG_CALLS && end >= from && found.length < 20; calls++) {
          const start = Math.max(from, end - size + 1);
          const logs = await guard.queryFilter("*", start, end);
          logs.forEach((l) => {
            if (l.fragment && (l.fragment.name === "ReserveAlert" || l.fragment.name === "ReserveRestored")) {
              found.push({ name: l.fragment.name, block: l.blockNumber, hash: l.transactionHash, ratio: l.args[0] });
            }
          });
          end = start - 1;
        }
        if (!cancelled) setEvents(found.sort((a, b) => b.block - a.block).slice(0, 20));
      } catch (e) {
        console.warn("Could not load reserve events:", e);
        if (!cancelled) setEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, network, refreshTrigger]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchBackendEvents(40);
      if (cancelled) return;
      if (r.ok && Array.isArray(r.data)) setFeed({ rows: r.data, offline: false });
      else setFeed({ rows: [], offline: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTrigger, network]);

  const noSupply = m ? m.ratio >= 10n ** 12n : false;
  const ratioBps = m ? (noSupply ? 10000 : Number(m.ratio)) : 0;
  const healthy = m ? noSupply || ratioBps >= m.minRatio : true;
  const oracleAgeHours = m ? (Date.now() - m.oracleUpdated.getTime()) / 3600000 : 0;
  const staleWarn = m && (m.stale > 0 ? oracleAgeHours * 3600 > m.stale : oracleAgeHours > 24);

  const addressRows = Object.entries(addresses).filter(([k, v]) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <span className="badge badge-blue">AUDIT & ORACLES</span>
              <span className="badge badge-amber">RESERVE ORACLE IS A MOCK</span>
              <span className={`badge ${live ? "badge-emerald" : "badge-amber"}`}>{live ? "ETH/USD: live Chainlink feed" : "ETH/USD: local mock feed"}</span>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>Transparency</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Everything on this page is read directly from the contracts on {NETWORKS[network].label}.
            </p>
          </div>
          <button onClick={() => setRefreshTrigger((n) => n + 1)} className="btn-icon" title="Refresh" aria-label="Refresh transparency data">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {loadError && <div className="alert-banner error"><span>{loadError}</span></div>}
      {m && staleWarn && (
        <div className="alert-banner warn"><span>The reserve oracle was last updated {timeAgo(m.oracleUpdated)}. Treat the reserve figures as stale.</span></div>
      )}

      {m && (
        <div className="grid-4">
          <div className="stat-box">
            <div className="stat-label"><span>Total supply</span><Layers size={16} color="#3b82f6" /></div>
            <div className="stat-value font-mono">{fmtNumber(fromUnits(m.supply, BOND_DECIMALS))}</div>
            <div className="stat-sub">{m.terms.symbol} tokens</div>
          </div>
          <div className="stat-box">
            <div className="stat-label"><span>Required reserves</span><Database size={16} color="#94a3b8" /></div>
            <div className="stat-value font-mono">${fmtNumber(fromUnits(m.req, USDC_DECIMALS), 0, 0)}</div>
            <div className="stat-sub">supply × face value</div>
          </div>
          <div className="stat-box">
            <div className="stat-label"><span>Reported reserves</span><Shield size={16} color="#10b981" /></div>
            <div className="stat-value font-mono">${fmtNumber(fromUnits(m.reserves, USDC_DECIMALS), 0, 0)}</div>
            <div className="stat-sub">updated {timeAgo(m.oracleUpdated)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label"><span>Coverage ratio</span><Activity size={16} color={healthy ? "#10b981" : "#f43f5e"} /></div>
            <div className="stat-value font-mono" style={{ color: healthy ? "var(--accent-emerald)" : "var(--accent-rose)" }}>
              {noSupply ? "n/a" : `${(ratioBps / 100).toFixed(1)}%`}
            </div>
            <div className="stat-sub">minimum {(m.minRatio / 100).toFixed(0)}%</div>
          </div>
        </div>
      )}

      {m && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title"><TrendingUp size={18} color="#3b82f6" /> Coverage gauge</h3>
              <p className="card-subtitle">{healthy ? "Reserves cover supply." : "Reserves are below the required minimum."}</p>
            </div>
            {healthy ? <span className="badge badge-emerald"><CheckCircle size={12} /> Healthy</span> : <span className="badge badge-rose"><AlertTriangle size={12} /> Alert</span>}
          </div>
          <div className="gauge-container">
            <div className="gauge-fill" style={{ width: `${Math.min(ratioBps / 100, 100)}%`, backgroundColor: healthy ? "var(--accent-emerald)" : "var(--accent-rose)" }} />
          </div>
          {m.price && (
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.75rem" }}>
              ETH/USD: <b className="font-mono">${fmtNumber(ethers.formatUnits(m.price.price, m.price.decimals))}</b> (feed updated {timeAgo(m.price.updatedAt)}). One bond face value ≈{" "}
              <b className="font-mono">{(Number(fromUnits(m.terms.faceValue, USDC_DECIMALS)) / Number(ethers.formatUnits(m.price.price, m.price.decimals))).toFixed(4)} ETH</b>.
            </p>
          )}
        </div>
      )}

      {m && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title"><Shield size={18} color="#10b981" /> Infrastructure status</h3>
              <p className="card-subtitle">The data sources and registries the platform depends on.</p>
            </div>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Component</th><th>Source</th><th>Status</th><th>Last updated</th></tr></thead>
              <tbody>
                <tr>
                  <td>ETH / USD price reader</td>
                  <td>{live ? "Chainlink data feed (real)" : "Local mock feed"}</td>
                  <td>{m.price ? <span className="badge badge-emerald">Active</span> : <span className="badge badge-rose">No data</span>}</td>
                  <td>{m.price ? timeAgo(m.price.updatedAt) : "-"}</td>
                </tr>
                <tr>
                  <td>Proof of reserves</td>
                  <td>ReserveOracle (mock)</td>
                  <td><span className="badge badge-emerald">Active</span></td>
                  <td>{timeAgo(m.oracleUpdated)}</td>
                </tr>
                <tr>
                  <td>Bond yield benchmark</td>
                  <td>YieldOracle (mock){m.yieldInfo ? `: ${(Number(m.yieldInfo.value) / 10 ** m.yieldInfo.decimals).toFixed(2)}%` : ""}</td>
                  <td>{m.yieldInfo ? <span className="badge badge-emerald">Active</span> : <span className="badge badge-amber">Not deployed</span>}</td>
                  <td>{m.yieldInfo ? timeAgo(m.yieldInfo.updatedAt) : "-"}</td>
                </tr>
                <tr>
                  <td>KYC and identity</td>
                  <td>KYCRegistry (whitelist, on-chain)</td>
                  <td><span className="badge badge-emerald">Active</span></td>
                  <td>-</td>
                </tr>
                <tr>
                  <td>Settlement stablecoin</td>
                  <td>MockUSDC (test token)</td>
                  <td><span className="badge badge-emerald">Active</span></td>
                  <td>-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title"><Activity size={18} color="#f59e0b" /> Recent reserve events</h3>
            <p className="card-subtitle">ReserveAlert and ReserveRestored are emitted when someone runs the reserve check.</p>
          </div>
        </div>
        <div className="table-container">
          <table className="data-table">
            <thead><tr><th>Event</th><th>Block</th><th>Ratio at the time</th><th>Transaction</th></tr></thead>
            <tbody>
              {events.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "1.25rem" }}>No reserve events found yet.</td></tr>}
              {events.map((e) => (
                <tr key={e.hash + e.name}>
                  <td>{e.name === "ReserveAlert" ? <span className="badge badge-rose">Alert</span> : <span className="badge badge-emerald">Restored</span>}</td>
                  <td className="font-mono">{e.block}</td>
                  <td className="font-mono">{e.ratio >= 10n ** 12n ? "n/a" : `${(Number(e.ratio) / 100).toFixed(1)}%`}</td>
                  <td className="font-mono">{shortAddr(e.hash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title"><Activity size={18} color="#3b82f6" /> Platform activity</h3>
            <p className="card-subtitle">Indexed by the optional backend service.</p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {[["all", "All"], ["market", "Market"], ["reserve", "Reserve"], ["coupon", "Coupons"]].map(([k, label]) => (
              <button key={k} className={`btn btn-sm ${feedFilter === k ? "btn-primary" : "btn-secondary"}`} onClick={() => setFeedFilter(k)}>{label}</button>
            ))}
          </div>
        </div>
        {feed.offline ? (
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>The activity service is not running. Start it with <span className="font-mono">cd backend && npm start</span> to see history here.</p>
        ) : (
          <div className="table-container" style={{ maxHeight: 280, overflowY: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Event</th><th>Contract</th><th>Block</th><th>Tx</th></tr></thead>
              <tbody>
                {feed.rows
                  .filter((r) => feedFilter === "all" || (feedFilter === "market" && r.contract === "Marketplace") || (feedFilter === "reserve" && (r.contract === "ReserveGuard" || r.contract === "ReserveOracle")) || (feedFilter === "coupon" && r.contract === "CouponDistributor"))
                  .map((r) => (
                    <tr key={r.id}>
                      <td>{r.type}</td>
                      <td>{r.contract}</td>
                      <td className="font-mono">{r.block_number}</td>
                      <td className="font-mono">{shortAddr(r.tx_hash)}</td>
                    </tr>
                  ))}
                {feed.rows.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "1.25rem" }}>No indexed activity yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title"><Database size={18} color="#3b82f6" /> Contract addresses</h3>
            <p className="card-subtitle">{live ? "Click an address to open it on Sepolia Etherscan." : "Local chain: no block explorer."}</p>
          </div>
        </div>
        <div className="table-container">
          <table className="data-table">
            <thead><tr><th>Contract</th><th>Address</th></tr></thead>
            <tbody>
              {addressRows.map(([name, addr]) => {
                const link = addressUrl(network, addr);
                return (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="font-mono">
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-blue)", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                          {addr} <ExternalLink size={12} />
                        </a>
                      ) : addr}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import { getContract, getAddresses, fetchHolders, fetchOrders, BOND_DECIMALS, USDC_DECIMALS } from "../contracts/platform";
import { toUnits, fromUnits, fmtNumber, isAddressLike, parseSnapshotLines, chunk, timeAgo, shortAddr } from "../lib/utils";
import { StatusBanner, ConfirmModal, RoleBadge, useTxRunner } from "./ui";
import KycQueue from "./KycQueue";
import PoolsPanel from "./PoolsPanel";
import OpenOffering from "./OpenOffering";
import { Pause, Play, TrendingUp, UserCheck, UserX, RefreshCw, Bell, Sliders, Wrench, CheckCircle2, XCircle, Search } from "lucide-react";

const SNAPSHOT_CHUNK = 100; // accounts per recordSnapshot transaction

export default function AdminConsole({ account, provider, signer, network, roles, refreshTrigger, setRefreshTrigger }) {
  const [isPaused, setIsPaused] = useState(false);
  const [ratioRaw, setRatioRaw] = useState(0n);
  const [reported, setReported] = useState(0n);
  const [required, setRequired] = useState(0n);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [alertActive, setAlertActive] = useState(false);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [kycTarget, setKycTarget] = useState("");
  const [kycResult, setKycResult] = useState(null);
  const [newReserveInput, setNewReserveInput] = useState("");
  const [period, setPeriod] = useState("1");
  const [snapText, setSnapText] = useState("");
  const [kycMap, setKycMap] = useState({});
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const onDone = useCallback(() => setRefreshTrigger((n) => n + 1), [setRefreshTrigger]);
  const { status, setStatus, busy, run } = useTxRunner(onDone);
  const addrs = getAddresses(network);

  // ---------- load chain state ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const bond = getContract("BondToken", provider, network);
        const guard = getContract("ReserveGuard", provider, network);
        const kyc = getContract("KYCRegistry", provider, network);
        const usdc = getContract("MockUSDC", provider, network);
        const [paused, ratio, req, res, alert, marketOk, oracleAddr, distIssuer, distUsdc] = await Promise.all([
          bond.paused(),
          guard.reserveRatioBps(),
          guard.requiredReserves(),
          guard.reserves(),
          guard.alertActive(),
          kyc.isVerified(addrs.Marketplace),
          bond.reserveOracle(),
          bond.hasRole(ethers.id("ISSUER_ROLE"), addrs.CouponDistributor),
          usdc.balanceOf(addrs.CouponDistributor),
        ]);
        if (cancelled) return;
        setIsPaused(paused);
        setRatioRaw(ratio);
        setRequired(req);
        setReported(res.amount);
        setUpdatedAt(new Date(Number(res.updatedAt) * 1000));
        setAlertActive(alert);
        setChecks([
          { id: "market", ok: marketOk, label: "Marketplace contract is KYC-whitelisted", why: "Selling moves bonds into the Marketplace, and BondToken only allows KYC-verified receivers.", needs: "compliance", fixLabel: "Whitelist Marketplace" },
          { id: "oracle", ok: oracleAddr.toLowerCase() === addrs.ReserveOracle.toLowerCase(), label: "BondToken points at the deployed ReserveOracle", why: oracleAddr === ethers.ZeroAddress ? "No oracle set: minting is unrestricted." : `Currently ${shortAddr(oracleAddr)}.`, needs: "admin", fixLabel: "Set ReserveOracle" },
          { id: "burn", ok: distIssuer, label: "CouponDistributor may burn bonds at redemption (ISSUER_ROLE on BondToken)", why: "Without it redeem() fails.", needs: "admin", fixLabel: "Grant role" },
          { id: "liquidity", ok: distUsdc >= req, label: `Redemption pool covers principal ($${fmtNumber(fromUnits(distUsdc, USDC_DECIMALS))} of $${fmtNumber(fromUnits(req, USDC_DECIMALS))})`, why: "Informational: fund the CouponDistributor with MockUSDC before maturity.", needs: null },
        ]);
      } catch (err) {
        console.error("Error loading admin data:", err);
        if (!cancelled) setLoadError("Could not read contract state. Check the network selection and RPC connection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, network, refreshTrigger]);

  const noSupply = ratioRaw >= 10n ** 12n;
  const ratioBps = noSupply ? 10000 : Number(ratioRaw);
  const isHealthy = noSupply || ratioBps >= 10000;
  const progressFill = Math.min(Math.max(ratioBps / 100, 0), 100);

  const need = (role, label) => {
    if (!signer) return setStatus({ type: "warn", text: "Connect your wallet on the selected network first." }), false;
    if (role && !roles[role]) return setStatus({ type: "error", text: `This wallet does not hold the ${label} role, so the transaction would be rejected.` }), false;
    return true;
  };

  // ---------- actions ----------
  const doPause = () => {
    setConfirm(null);
    run(isPaused ? "Resuming transfers..." : "Pausing all transfers...", () => {
      const bond = getContract("BondToken", signer, network);
      return isPaused ? bond.unpause() : bond.pause();
    }, isPaused ? "Transfers resumed." : "All bond transfers are paused.");
  };

  const askPause = () => {
    if (!need("pauser", "PAUSER")) return;
    setConfirm({
      title: isPaused ? "Resume transfers?" : "Pause all transfers?",
      message: isPaused
        ? "Investors will be able to trade, claim and redeem again."
        : "This blocks every bond transfer, marketplace trade, mint and redemption until you unpause.",
      confirmLabel: isPaused ? "Unpause" : "Pause",
      danger: !isPaused,
      onConfirm: doPause,
    });
  };

  const lookupKyc = async () => {
    if (!isAddressLike(kycTarget)) return setStatus({ type: "error", text: "Enter a valid 0x wallet address." });
    try {
      const kyc = getContract("KYCRegistry", provider, network);
      const ok = await kyc.isVerified(ethers.getAddress(kycTarget.trim()));
      setKycResult({ address: kycTarget.trim(), ok });
    } catch (e) {
      setStatus({ type: "error", text: "Could not read KYC status." });
    }
  };

  const kycAction = (action) => {
    if (!need("compliance", "COMPLIANCE")) return;
    if (!isAddressLike(kycTarget)) return setStatus({ type: "error", text: "Enter a valid 0x wallet address." });
    const target = ethers.getAddress(kycTarget.trim());
    run(`${action === "add" ? "Whitelisting" : "Removing"} ${shortAddr(target)}...`, () => {
      const kyc = getContract("KYCRegistry", signer, network);
      return action === "add" ? kyc.addToWhitelist(target) : kyc.removeFromWhitelist(target);
    }, `KYC status updated for ${shortAddr(target)}.`).then((ok) => {
      if (ok) {
        setKycTarget("");
        setKycResult(null);
      }
    });
  };

  const updateReserves = (e) => {
    e.preventDefault();
    if (!need("oracleAdmin", "FEED_ADMIN")) return;
    let amount;
    try {
      amount = toUnits(newReserveInput, USDC_DECIMALS);
    } catch (err) {
      return setStatus({ type: "error", text: err.message });
    }
    run("Updating the (mock) reserve oracle...", () => getContract("ReserveOracle", signer, network).updateReserve(amount),
      `Reserve oracle set to $${fmtNumber(newReserveInput)}.`).then((ok) => ok && setNewReserveInput(""));
  };

  const checkAndAlert = () => {
    if (!need(null)) return;
    run("Calling ReserveGuard.checkAndAlert()...", () => getContract("ReserveGuard", signer, network).checkAndAlert(),
      "Reserve check executed. An alert or restore event is emitted when the status changed.");
  };

  const runFix = (c) => {
    if (c.id === "market") {
      if (!need("compliance", "COMPLIANCE")) return;
      run("Whitelisting the Marketplace contract...", () => getContract("KYCRegistry", signer, network).addToWhitelist(addrs.Marketplace), "Marketplace whitelisted.");
    } else if (c.id === "oracle") {
      if (!need("admin", "DEFAULT_ADMIN")) return;
      run("Pointing BondToken at the ReserveOracle...", () => getContract("BondToken", signer, network).setReserveOracle(addrs.ReserveOracle), "ReserveOracle connected.");
    } else if (c.id === "burn") {
      if (!need("admin", "DEFAULT_ADMIN")) return;
      run("Granting ISSUER_ROLE to the CouponDistributor...", () => getContract("BondToken", signer, network).grantRole(ethers.id("ISSUER_ROLE"), addrs.CouponDistributor), "Role granted.");
    }
  };

  // ---------- snapshot builder ----------
  const parsed = useMemo(() => parseSnapshotLines(snapText, BOND_DECIMALS), [snapText]);
  const totalSnapBonds = parsed.rows.reduce((s, r) => s + r.balance, 0n);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (parsed.rows.length === 0 || parsed.rows.length > 200) return setKycMap({});
      try {
        const kyc = getContract("KYCRegistry", provider, network);
        const res = await Promise.all(parsed.rows.map((r) => kyc.isVerified(r.address)));
        if (!cancelled) setKycMap(Object.fromEntries(parsed.rows.map((r, i) => [r.address.toLowerCase(), res[i]])));
      } catch (e) {
        if (!cancelled) setKycMap({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parsed.rows, provider, network]);

  const loadHolders = async () => {
    setHoldersLoading(true);
    setStatus({ type: "info", text: "Scanning Transfer events and reading balances..." });
    try {
      const bond = getContract("BondToken", provider, network);
      const market = getContract("Marketplace", provider, network);
      const holders = await fetchHolders(bond, provider, network, Number(addrs.deployBlock || 0));
      const map = new Map(holders.map((h) => [h.address.toLowerCase(), { address: h.address, balance: h.balance }]));
      // Bonds sitting in escrow belong to the sellers of active orders, not to the Marketplace contract.
      map.delete(addrs.Marketplace.toLowerCase());
      const { orders, truncated } = await fetchOrders(market, 1000);
      orders.filter((o) => o.isActive).forEach((o) => {
        const k = o.seller.toLowerCase();
        const cur = map.get(k);
        map.set(k, { address: o.seller, balance: (cur ? cur.balance : 0n) + o.bondAmount });
      });
      const lines = [...map.values()].filter((h) => h.balance > 0n).map((h) => `${h.address} ${fromUnits(h.balance, BOND_DECIMALS)}`);
      setSnapText(lines.join("\n"));
      setStatus({
        type: truncated ? "warn" : "success",
        text: `Loaded ${lines.length} holder(s) from the chain. Escrowed bonds were credited to their sellers.${truncated ? " Warning: more than 1,000 orders exist, so some escrow may be missing." : ""} Review before recording.`,
      });
    } catch (err) {
      console.error(err);
      setStatus({ type: "error", text: `Could not load holders: ${err.shortMessage || err.message}` });
    } finally {
      setHoldersLoading(false);
    }
  };

  const prepareSnapshot = async () => {
    if (!need("distributorIssuer", "ISSUER")) return;
    if (!/^\d+$/.test(period) || BigInt(period) === 0n) return setStatus({ type: "error", text: "Coupon period must be a whole number of 1 or more." });
    if (parsed.errors.length || parsed.rows.length === 0) return setStatus({ type: "error", text: "Fix the highlighted lines before recording." });
    try {
      const dist = getContract("CouponDistributor", provider, network);
      const usdc = getContract("MockUSDC", provider, network);
      const liability = await dist.calculateCoupon(totalSnapBonds);
      const pool = await usdc.balanceOf(addrs.CouponDistributor);
      const existing = await Promise.all(parsed.rows.slice(0, 25).map((r) => dist.snapshotBalances(BigInt(period), r.address)));
      const overwrites = existing.some((b) => b > 0n);
      const notKyc = parsed.rows.filter((r) => kycMap[r.address.toLowerCase()] === false).length;
      setConfirm({
        title: `Record snapshot for period ${period}?`,
        message: `${parsed.rows.length} account(s), ${fmtNumber(fromUnits(totalSnapBonds, BOND_DECIMALS), 4)} bonds. Total coupon liability about $${fmtNumber(fromUnits(liability, USDC_DECIMALS))}; pool holds $${fmtNumber(fromUnits(pool, USDC_DECIMALS))}.` +
          (pool < liability ? " The pool is too small to pay everyone yet." : "") +
          (overwrites ? " WARNING: this period already has entries and they will be overwritten." : "") +
          (notKyc ? ` ${notKyc} listed wallet(s) are not KYC-verified and cannot claim.` : "") +
          " Everyone listed can claim a coupon, so double-check the list.",
        confirmLabel: "Record on-chain",
        danger: pool < liability || overwrites,
        onConfirm: () => {
          setConfirm(null);
          submitSnapshot();
        },
      });
    } catch (e) {
      setStatus({ type: "error", text: "Could not prepare the snapshot summary." });
    }
  };

  const submitSnapshot = () => {
    const groups = chunk(parsed.rows, SNAPSHOT_CHUNK);
    run(`Recording snapshot for period ${period}...`, async (setMsg) => {
      const dist = getContract("CouponDistributor", signer, network);
      let last;
      for (let i = 0; i < groups.length; i++) {
        setMsg({ type: "info", text: `Recording batch ${i + 1} of ${groups.length} (confirm in wallet)...` });
        last = await dist.recordSnapshot(BigInt(period), groups[i].map((r) => r.address), groups[i].map((r) => r.balance));
        if (i < groups.length - 1) await last.wait();
      }
      return last;
    }, `Snapshot for period ${period} recorded (${parsed.rows.length} accounts).`);
  };

  const gaugeColor = isHealthy ? "var(--accent-emerald)" : "var(--accent-rose)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span className="badge badge-blue">GOVERNANCE & SAFETY</span>
              {account ? (
                <>
                  <RoleBadge label="Admin" has={roles.admin} />
                  <RoleBadge label="Issuer" has={roles.issuer} />
                  <RoleBadge label="Pauser" has={roles.pauser} />
                  <RoleBadge label="Compliance" has={roles.compliance} />
                  <RoleBadge label="Oracle admin" has={roles.oracleAdmin} />
                </>
              ) : (
                <span className="badge badge-amber">Connect a wallet to see your roles</span>
              )}
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>Issuer & Compliance Console</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Every action is enforced on-chain by role. Buttons stay clickable so you can see the reason when a wallet lacks a role.
            </p>
          </div>
          <button onClick={onDone} className="btn-icon" title="Refresh" aria-label="Refresh console data">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <StatusBanner status={status} onClose={() => setStatus(null)} network={network} />
      {loadError && <div className="alert-banner error"><span>{loadError}</span></div>}

      {/* Reserve monitor */}
      <div className="card" style={{ border: `1px solid ${isHealthy ? "var(--accent-emerald-border)" : "var(--accent-rose-border)"}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>Proof of Reserves coverage</span>
              <span className="badge badge-amber">MOCK ORACLE</span>
              {alertActive && <span className="badge badge-rose">ReserveAlert active</span>}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
              <span className="font-mono" style={{ fontSize: "2.5rem", fontWeight: 800, color: gaugeColor, letterSpacing: "-0.03em" }}>
                {noSupply ? "No bonds issued" : `${(ratioBps / 100).toFixed(1)}%`}
              </span>
              {!noSupply && (
                <span className="font-mono" style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                  (${fmtNumber(fromUnits(reported, USDC_DECIMALS))} / ${fmtNumber(fromUnits(required, USDC_DECIMALS))})
                </span>
              )}
            </div>
            <p style={{ fontSize: "0.8rem", color: gaugeColor, marginTop: "0.25rem", fontWeight: 600 }}>
              {isHealthy ? "Reserves cover the outstanding supply. Minting is permitted." : "Under-collateralised: BondToken blocks new minting."}
            </p>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>Oracle last updated {timeAgo(updatedAt)}.</p>
          </div>
          <button onClick={checkAndAlert} disabled={busy} className="btn btn-secondary btn-sm">
            <Bell size={14} color="#f59e0b" /> <span>Run reserve check (emit event)</span>
          </button>
        </div>
        <div className="gauge-container" style={{ marginTop: "1.25rem" }}>
          <div className="gauge-fill" style={{ width: `${progressFill}%`, backgroundColor: gaugeColor }} />
        </div>
      </div>

      {/* Setup checks */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title"><Wrench size={18} color="#f59e0b" /> Setup checks</h3>
            <p className="card-subtitle">Deployment wiring that the app depends on. Fix buttons need the matching role.</p>
          </div>
        </div>
        {checks.map((c) => (
          <div className="check-row" key={c.id}>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
              {c.ok ? <CheckCircle2 size={18} color="#10b981" /> : <XCircle size={18} color={c.needs ? "#f43f5e" : "#f59e0b"} />}
              <div>
                <div style={{ fontWeight: 600 }}>{c.label}</div>
                {!c.ok && <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>{c.why}</div>}
              </div>
            </div>
            {!c.ok && c.needs && (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => runFix(c)}>{c.fixLabel}</button>
            )}
          </div>
        ))}
      </div>

      <div className="grid-2">
        {/* Pause */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">{isPaused ? <Play size={18} color="#10b981" /> : <Pause size={18} color="#f43f5e" />} Emergency pause</h3>
              <p className="card-subtitle">Needs the PAUSER role.</p>
            </div>
            <span className={`badge ${isPaused ? "badge-rose" : "badge-emerald"}`}>{isPaused ? "Paused" : "Live"}</span>
          </div>
          <button onClick={askPause} disabled={busy} className={`btn ${isPaused ? "btn-emerald" : "btn-rose"}`} style={{ width: "100%" }}>
            {isPaused ? "Resume transfers" : "Pause all transfers"}
          </button>
        </div>

        {/* Reserve oracle */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title"><TrendingUp size={18} color="#3b82f6" /> Simulate reserve change</h3>
              <p className="card-subtitle">Mock oracle for demos. Needs FEED_ADMIN.</p>
            </div>
          </div>
          <form onSubmit={updateReserves}>
            <div className="input-group">
              <label className="input-label" htmlFor="reserve">New reserves (USD)</label>
              <input id="reserve" className="input-field" inputMode="decimal" value={newReserveInput} onChange={(e) => setNewReserveInput(e.target.value.trim())} placeholder={`Required now: ${fmtNumber(fromUnits(required, USDC_DECIMALS), 0, 0)}`} />
            </div>
            <button type="submit" disabled={busy || !newReserveInput} className="btn btn-primary" style={{ width: "100%", marginTop: "0.75rem" }}>Update oracle</button>
          </form>
        </div>
      </div>

      <div className="grid-2">
        {/* KYC */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title"><UserCheck size={18} color="#10b981" /> KYC whitelist</h3>
              <p className="card-subtitle">Look up, add or remove a wallet. Needs COMPLIANCE.</p>
            </div>
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="kyc">Wallet address</label>
            <input id="kyc" className="input-field font-mono" value={kycTarget} onChange={(e) => { setKycTarget(e.target.value.trim()); setKycResult(null); }} placeholder="0x..." />
          </div>
          {kycResult && (
            <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", color: kycResult.ok ? "var(--accent-emerald)" : "var(--accent-amber)" }}>
              {shortAddr(kycResult.address)} is {kycResult.ok ? "KYC-verified." : "not KYC-verified."}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
            <button className="btn btn-secondary btn-sm" onClick={lookupKyc}><Search size={14} /> Check</button>
            <button className="btn btn-emerald btn-sm" disabled={busy} onClick={() => kycAction("add")}><UserCheck size={14} /> Whitelist</button>
            <button className="btn btn-rose btn-sm" disabled={busy} onClick={() => kycAction("remove")}><UserX size={14} /> Remove</button>
          </div>
        </div>

        <OpenOffering account={account} signer={signer} network={network} roles={roles} setRefreshTrigger={setRefreshTrigger} />
      </div>

      <PoolsPanel account={account} provider={provider} signer={signer} network={network} roles={roles} refreshTrigger={refreshTrigger} setRefreshTrigger={setRefreshTrigger} />

      <KycQueue provider={provider} signer={signer} network={network} roles={roles} refreshTrigger={refreshTrigger} setRefreshTrigger={setRefreshTrigger} />

      {/* Snapshot */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title"><Sliders size={18} color="#3b82f6" /> Distribute coupon (record snapshot)</h3>
            <p className="card-subtitle">
              Step 1: load the real holders. Step 2: review the list. Step 3: record it on-chain so each holder can claim. Fund the coupon pool first. Needs the ISSUER role.
            </p>
          </div>
        </div>
        <div className="grid-2">
          <div>
            <div className="input-group">
              <label className="input-label" htmlFor="period">Coupon period</label>
              <input id="period" className="input-field" inputMode="numeric" value={period} onChange={(e) => setPeriod(e.target.value.trim())} />
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: "0.75rem" }} onClick={loadHolders} disabled={holdersLoading || busy}>
              <RefreshCw size={14} className={holdersLoading ? "animate-spin" : ""} /> Load holders from chain
            </button>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
              Uses current balances. Bonds in marketplace escrow are credited to their sellers. One line per holder: <span className="font-mono">address amount</span>.
            </p>
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="snaptext">Holders (editable)</label>
            <textarea id="snaptext" className="input-field" value={snapText} onChange={(e) => setSnapText(e.target.value)} placeholder={"0xabc... 120.5\n0xdef... 40"} spellCheck={false} />
          </div>
        </div>

        {parsed.errors.length > 0 && (
          <div className="alert-banner error" style={{ marginTop: "1rem", flexDirection: "column", alignItems: "flex-start", gap: "0.25rem" }}>
            {parsed.errors.slice(0, 6).map((er) => <span key={er}>{er}</span>)}
            {parsed.errors.length > 6 && <span>...and {parsed.errors.length - 6} more.</span>}
          </div>
        )}

        {parsed.rows.length > 0 && (
          <div className="table-container" style={{ marginTop: "1rem", maxHeight: "260px", overflowY: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Wallet</th><th>Bonds</th><th>KYC</th></tr></thead>
              <tbody>
                {parsed.rows.slice(0, 200).map((r) => {
                  const k = kycMap[r.address.toLowerCase()];
                  return (
                    <tr key={r.address}>
                      <td className="font-mono">{shortAddr(r.address)}</td>
                      <td className="font-mono">{fmtNumber(fromUnits(r.balance, BOND_DECIMALS), 4)}</td>
                      <td>{k === undefined ? "-" : k ? <span className="badge badge-emerald">Verified</span> : <span className="badge badge-amber">Not verified</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            {parsed.rows.length} account(s), {fmtNumber(fromUnits(totalSnapBonds, BOND_DECIMALS), 4)} bonds
          </span>
          <button className="btn btn-primary" disabled={busy || parsed.rows.length === 0 || parsed.errors.length > 0} onClick={prepareSnapshot}>
            Review & record snapshot
          </button>
        </div>
      </div>

      {confirm && <ConfirmModal {...confirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

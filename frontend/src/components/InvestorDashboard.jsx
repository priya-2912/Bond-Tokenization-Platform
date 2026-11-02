import React, { useState, useEffect, useCallback } from "react";
import { getContract, loadTerms, hasFn, BOND_DECIMALS, USDC_DECIMALS } from "../contracts/platform";
import { toUnits, fromUnits, fmtNumber, countdown } from "../lib/utils";
import { StatusBanner, Modal, useTxRunner } from "./ui";
import KycApplication from "./KycApplication";
import PrimaryOffering from "./PrimaryOffering";
import TestUsdcFaucetModal from "./TestUsdcFaucetModal";
import { Coins, DollarSign, ArrowUpRight, RefreshCw, Gift, Layers, Calendar, Sparkles } from "lucide-react";

export default function InvestorDashboard({ account, provider, signer, network, isKycVerified, refreshTrigger, setRefreshTrigger }) {
  const [terms, setTerms] = useState(null);
  const [bondBalance, setBondBalance] = useState(0n);
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [distributorUsdc, setDistributorUsdc] = useState(0n);
  const [period, setPeriod] = useState("1");
  const [periodList, setPeriodList] = useState([]);
  const [snap, setSnap] = useState({ balance: 0n, claimed: false, payout: 0n });
  const [annualEstimate, setAnnualEstimate] = useState(0n);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState("");
  const [faucetOpen, setFaucetOpen] = useState(false);

  const onDone = useCallback(() => setRefreshTrigger((n) => n + 1), [setRefreshTrigger]);
  const { status, setStatus, busy, run } = useTxRunner(onDone);

  const isMatured = terms ? Date.now() >= terms.maturity.getTime() : false;
  const canTransact = Boolean(signer);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!account || !provider) return;
      setLoading(true);
      setLoadError(null);
      try {
        const t = await loadTerms(provider, network);
        const bond = getContract("BondToken", provider, network);
        const usdc = getContract("MockUSDC", provider, network);
        const dist = getContract("CouponDistributor", provider, network);
        const distAddr = await dist.getAddress();

        // Newer CouponDistributor versions list recorded periods and report the exact claimable amount.
        let list = [];
        if (hasFn(dist, "getActivePeriods")) {
          try {
            list = (await dist.getActivePeriods()).map((p) => Number(p));
          } catch (e) {
            list = [];
          }
        }
        if (list.length > 0 && !list.includes(Number(period))) {
          if (!cancelled) setPeriod(String(list[list.length - 1]));
        }
        const periodId = /^\d+$/.test(period) ? BigInt(period) : null;
        const [bBal, uBal, dBal] = await Promise.all([bond.balanceOf(account), usdc.balanceOf(account), usdc.balanceOf(distAddr)]);

        let snapBal = 0n, claimed = false, payout = 0n;
        if (periodId !== null) {
          [snapBal, claimed] = await Promise.all([dist.snapshotBalances(periodId, account), dist.hasClaimed(periodId, account)]);
          if (hasFn(dist, "getClaimableCoupon")) payout = await dist.getClaimableCoupon(periodId, account);
          else if (snapBal > 0n) payout = await dist.calculateCoupon(snapBal);
        }
        const est = bBal > 0n ? await dist.calculateCoupon(bBal) : 0n;

        if (cancelled) return;
        setTerms(t);
        setBondBalance(bBal);
        setUsdcBalance(uBal);
        setDistributorUsdc(dBal);
        setSnap({ balance: snapBal, claimed, payout });
        setPeriodList(list);
        setAnnualEstimate(est);
      } catch (err) {
        console.error("Error loading investor data:", err);
        if (!cancelled) setLoadError("Could not read data from the contracts. Check the network selection and that the node or RPC is reachable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, provider, network, period, refreshTrigger]);

  const needWallet = () => setStatus({ type: "warn", text: "Connect your wallet on the selected network first." });

  const handleFaucet = () => {
    if (!signer) return needWallet();
    run("Minting 1,000 test MockUSDC...", async () => {
      return getContract("MockUSDC", signer, network).mint(account, toUnits("1000", USDC_DECIMALS));
    }, "1,000 test MockUSDC credited to your wallet.");
  };

  const handleClaim = () => {
    if (!signer) return needWallet();
    if (!isKycVerified) return setStatus({ type: "error", text: "Your wallet is not KYC-verified. Ask the compliance officer to whitelist it." });
    if (!/^\d+$/.test(period) || BigInt(period) === 0n) return setStatus({ type: "error", text: "Enter a valid coupon period number (1, 2, 3...)." });
    if (snap.claimed) return setStatus({ type: "error", text: `Period ${period} was already claimed.` });
    if (snap.balance === 0n) return setStatus({ type: "error", text: `Your wallet is not in the snapshot for period ${period}.` });
    if (distributorUsdc < snap.payout) return setStatus({ type: "error", text: "The coupon contract does not hold enough MockUSDC yet. The issuer must deposit funds." });
    run(`Claiming coupon for period ${period}...`, () => getContract("CouponDistributor", signer, network).claimCoupon(BigInt(period)), `Coupon for period ${period} claimed.`);
  };

  // Redemption maths in BigInt: payout = amount * faceValue / 10^bondDecimals (same as the contract).
  let redeemRaw = 0n, redeemError = null;
  if (redeemAmount) {
    try {
      redeemRaw = toUnits(redeemAmount, BOND_DECIMALS);
      if (redeemRaw === 0n) redeemError = "Amount must be greater than 0.";
      else if (redeemRaw > bondBalance) redeemError = "You do not hold that many bonds.";
    } catch (e) {
      redeemError = e.message;
    }
  }
  const redeemPayout = terms && redeemRaw > 0n ? (redeemRaw * terms.faceValue) / 10n ** BigInt(BOND_DECIMALS) : 0n;
  const liquidityShort = redeemPayout > distributorUsdc;

  const openRedeem = () => {
    if (!signer) return needWallet();
    if (!isKycVerified) return setStatus({ type: "error", text: "Your wallet is not KYC-verified." });
    if (!isMatured) return setStatus({ type: "error", text: "The bond has not matured yet." });
    setRedeemAmount("");
    setRedeemOpen(true);
  };

  const confirmRedeem = async () => {
    if (redeemError || redeemRaw === 0n) return;
    setRedeemOpen(false);
    await run(`Redeeming ${redeemAmount} bonds...`, () => getContract("CouponDistributor", signer, network).redeem(redeemRaw),
      `Redeemed ${redeemAmount} bonds for $${fmtNumber(fromUnits(redeemPayout, USDC_DECIMALS))} MockUSDC.`);
  };

  const face = terms ? fromUnits(terms.faceValue, USDC_DECIMALS) : null;
  const holdingValue = terms ? fromUnits((bondBalance * terms.faceValue) / 10n ** BigInt(BOND_DECIMALS), USDC_DECIMALS) : "0";
  const couponPct = terms ? (terms.couponRateBps / 100).toFixed(2) : "-";

  if (!account) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 800 }}>Connect your wallet</h2>
        <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem" }}>Connect MetaMask to see your holdings, claim coupons and redeem at maturity.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      <div className="card" style={{ background: "linear-gradient(135deg, rgba(30, 58, 138, 0.4) 0%, rgba(15, 23, 42, 0.9) 100%)", borderColor: "rgba(59, 130, 246, 0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span className="badge badge-blue">{terms ? terms.symbol : "..."}</span>
              <span className="badge badge-amber">TESTNET PROTOTYPE</span>
              {isKycVerified && <span className="badge badge-emerald">Whitelisted</span>}
            </div>
            <h2 style={{ fontSize: "1.85rem", fontWeight: 800, marginTop: "0.5rem", letterSpacing: "-0.02em" }}>
              {terms ? `${terms.name} (${terms.symbol})` : "Loading bond..."}
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginTop: "0.25rem", maxWidth: "620px" }}>
              Fixed-income debt represented as KYC-gated ERC-20 tokens, with on-chain reserve checks and snapshot-based coupon servicing.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button onClick={() => setFaucetOpen(true)} className="btn btn-emerald btn-sm" title="Testnet MockUSDC Faucet">
              <Coins size={14} />
              <span>Get Test USDC</span>
            </button>
            <button onClick={onDone} className="btn-icon" title="Refresh" aria-label="Refresh portfolio">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem", marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <Term label="Face Value" value={face ? `$${fmtNumber(face)} / bond` : "..."} />
          <Term label="Coupon Rate" value={`${couponPct}% per period`} color="var(--accent-emerald)" />
          <Term label="Payment Frequency" value="Periodic (issuer snapshot)" />
          <Term label="Maturity Date" value={terms ? terms.maturity.toLocaleDateString() : "..."} />
        </div>
      </div>

      <StatusBanner status={status} onClose={() => setStatus(null)} network={network} />
      {loadError && <div className="alert-banner error"><span>{loadError}</span></div>}
      {!canTransact && <div className="alert-banner warn"><span>Read-only: switch your wallet to this network to send transactions.</span></div>}

      <KycApplication account={account} isKycVerified={isKycVerified} refreshTrigger={refreshTrigger} onDone={onDone} />

      <div className="grid-4">
        <div className="stat-box">
          <div className="stat-label"><span>Your Bond Holdings</span><Layers size={16} color="#3b82f6" /></div>
          <div className="stat-value font-mono">{fmtNumber(fromUnits(bondBalance, BOND_DECIMALS))} {terms ? terms.symbol : ""}</div>
          <div className="stat-sub">≈ ${fmtNumber(holdingValue)} total face value</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">
            <span>MockUSDC Available</span>
            <DollarSign size={16} color="#10b981" />
          </div>
          <div className="stat-value font-mono">${fmtNumber(fromUnits(usdcBalance, USDC_DECIMALS))}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.35rem" }}>
            <span className="stat-sub">Trading & investment</span>
            <button
              onClick={() => setFaucetOpen(true)}
              className="btn btn-emerald btn-sm"
              style={{ fontSize: "0.68rem", padding: "0.15rem 0.5rem", gap: "0.25rem" }}
            >
              <Sparkles size={10} />
              <span>Faucet</span>
            </button>
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-label"><span>Claimable (Period {period || "?"})</span><ArrowUpRight size={16} color="#f59e0b" /></div>
          <div className="stat-value font-mono" style={{ color: "#10b981" }}>${fmtNumber(fromUnits(snap.claimed ? 0n : snap.payout, USDC_DECIMALS))}</div>
          <div className="stat-sub">
            {snap.claimed ? "Already claimed" : snap.balance === 0n ? "Not in this period's snapshot" : `Snapshot: ${fmtNumber(fromUnits(snap.balance, BOND_DECIMALS))} bonds`}
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-label"><span>Principal Status</span><Calendar size={16} color="#94a3b8" /></div>
          <div className="stat-value" style={{ fontSize: "1.2rem", marginTop: "0.8rem" }}>
            {isMatured ? <span className="badge badge-emerald">Ready to Redeem</span> : <span className="badge badge-amber">Lock-in Active</span>}
          </div>
          <div className="stat-sub" style={{ marginTop: "0.4rem" }}>
            {terms ? `${terms.maturity.toLocaleDateString()} (${countdown(terms.maturity)})` : "..."}
          </div>
        </div>
      </div>

      <PrimaryOffering account={account} provider={provider} signer={signer} network={network} isKycVerified={isKycVerified} refreshTrigger={refreshTrigger} setRefreshTrigger={setRefreshTrigger} />

      <div className="grid-2">
        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <div>
                <h3 className="card-title"><Coins size={18} color="#3b82f6" /> Claim Coupon</h3>
                <p className="card-subtitle">Coupons are paid per period from the issuer's snapshot.</p>
              </div>
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="period">Coupon period</label>
              {periodList.length > 0 ? (
                <select id="period" className="input-field" value={period} onChange={(e) => setPeriod(e.target.value)}>
                  {periodList.map((p) => <option key={p} value={String(p)}>Period {p}</option>)}
                </select>
              ) : (
                <input id="period" className="input-field" inputMode="numeric" value={period} onChange={(e) => setPeriod(e.target.value.trim())} placeholder="1" />
              )}
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              Estimated coupon for one full period on your current holdings: <b className="font-mono">${fmtNumber(fromUnits(annualEstimate, USDC_DECIMALS))}</b>
              . Only the snapshot amount above can be claimed.
            </p>
          </div>
          <button onClick={handleClaim} disabled={busy || !canTransact} className="btn btn-primary" style={{ marginTop: "1rem" }}>
            Claim period {period || "?"}
          </button>
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <div className="card-header">
              <div>
                <h3 className="card-title"><Layers size={18} color="#10b981" /> Redeem at Maturity</h3>
                <p className="card-subtitle">Burn bonds and receive face value in MockUSDC.</p>
              </div>
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Redemption pool: <b className="font-mono">${fmtNumber(fromUnits(distributorUsdc, USDC_DECIMALS))}</b> MockUSDC held by the coupon contract.
              {!isMatured && " Redemption opens at maturity."}
            </p>
          </div>
          <button onClick={openRedeem} disabled={busy || !canTransact || !isMatured || bondBalance === 0n} className="btn btn-emerald" style={{ marginTop: "1rem" }}>
            Redeem bonds
          </button>
        </div>
      </div>

      {redeemOpen && (
        <Modal title="Redeem bonds" onClose={() => setRedeemOpen(false)}>
          <div className="input-group">
            <label className="input-label" htmlFor="redeemAmt">Bonds to redeem</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input id="redeemAmt" className="input-field" inputMode="decimal" value={redeemAmount} onChange={(e) => setRedeemAmount(e.target.value.trim())} placeholder="e.g. 5" autoFocus />
              <button className="btn btn-secondary btn-sm" onClick={() => setRedeemAmount(fromUnits(bondBalance, BOND_DECIMALS))}>Max</button>
            </div>
          </div>
          {redeemError && redeemAmount && <p style={{ color: "var(--accent-rose)", fontSize: "0.8rem", marginTop: "0.5rem" }}>{redeemError}</p>}
          {redeemRaw > 0n && !redeemError && (
            <p style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
              You will receive <b className="font-mono">${fmtNumber(fromUnits(redeemPayout, USDC_DECIMALS))}</b> MockUSDC.
            </p>
          )}
          {liquidityShort && !redeemError && (
            <p style={{ color: "var(--accent-amber)", fontSize: "0.8rem", marginTop: "0.5rem" }}>
              The contract currently holds less MockUSDC than this payout, so the transaction would fail until the issuer funds it.
            </p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.25rem" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setRedeemOpen(false)}>Cancel</button>
            <button className="btn btn-emerald btn-sm" disabled={!redeemAmount || Boolean(redeemError) || liquidityShort} onClick={confirmRedeem}>Confirm redemption</button>
          </div>
        </Modal>
      )}

      {/* Test MockUSDC Faucet Modal */}
      <TestUsdcFaucetModal
        isOpen={faucetOpen}
        onClose={() => setFaucetOpen(false)}
        initialAmount="5000"
        onSuccess={() => onDone()}
      />
    </div>
  );
}

function Term({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.1rem", fontWeight: 700, color: color || "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from "react";
import { getContract, getAddresses, hasFn, USDC_DECIMALS } from "../contracts/platform";
import { toUnits, fromUnits, fmtNumber, isAddressLike } from "../lib/utils";
import { StatusBanner, useTxRunner } from "./ui";
import { Wallet } from "lucide-react";

/**
 * Coupon and redemption funding. Works with both contract versions:
 *  - newer: separate couponPool / redemptionPool, depositCouponFunds / depositRedemptionFunds, withdrawUnusedFunds
 *  - older: one shared pool with depositFunds
 */
export default function PoolsPanel({ account, provider, signer, network, roles, refreshTrigger, setRefreshTrigger }) {
  const [pools, setPools] = useState({ split: false, coupon: 0n, redemption: 0n, total: 0n, needPrincipal: 0n, canWithdraw: false });
  const [kind, setKind] = useState("coupon");
  const [amount, setAmount] = useState("");
  const [wAmount, setWAmount] = useState("");
  const [wTo, setWTo] = useState("");
  const onDone = useCallback(() => setRefreshTrigger((n) => n + 1), [setRefreshTrigger]);
  const { status, setStatus, busy, run } = useTxRunner(onDone);
  const addrs = getAddresses(network);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dist = getContract("CouponDistributor", provider, network);
        const usdc = getContract("MockUSDC", provider, network);
        const guard = getContract("ReserveGuard", provider, network);
        const split = hasFn(dist, "couponPool") && hasFn(dist, "redemptionPool");
        const [total, need, c, r] = await Promise.all([
          usdc.balanceOf(addrs.CouponDistributor),
          guard.requiredReserves(),
          split ? dist.couponPool() : 0n,
          split ? dist.redemptionPool() : 0n,
        ]);
        if (!cancelled) setPools({ split, coupon: c, redemption: r, total, needPrincipal: need, canWithdraw: hasFn(dist, "withdrawUnusedFunds") });
      } catch (e) {
        console.warn("Could not read pools:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, network, refreshTrigger]);

  const guardWallet = () => {
    if (!signer) return setStatus({ type: "warn", text: "Connect your wallet on the selected network first." }), false;
    return true;
  };

  const deposit = (e) => {
    e.preventDefault();
    if (!guardWallet()) return;
    if (pools.split && !roles.distributorIssuer) return setStatus({ type: "error", text: "Only the ISSUER role can fund the pools." });
    let raw;
    try {
      raw = toUnits(amount, USDC_DECIMALS);
      if (raw === 0n) throw new Error("Amount must be greater than 0.");
    } catch (err) {
      return setStatus({ type: "error", text: err.message });
    }
    run("Preparing deposit...", async (setMsg) => {
      const usdc = getContract("MockUSDC", signer, network);
      const dist = getContract("CouponDistributor", signer, network);
      if ((await usdc.balanceOf(account)) < raw) throw new Error("Your wallet does not hold that much MockUSDC. Use the faucet on the Portfolio tab.");
      if ((await usdc.allowance(account, addrs.CouponDistributor)) < raw) {
        setMsg({ type: "info", text: "Step 1/2: approve the exact amount (confirm in wallet)..." });
        await (await usdc.approve(addrs.CouponDistributor, raw)).wait();
      }
      setMsg({ type: "info", text: "Step 2/2: deposit (confirm in wallet)..." });
      if (pools.split) return kind === "coupon" ? dist.depositCouponFunds(raw) : dist.depositRedemptionFunds(raw);
      return dist.depositFunds(raw);
    }, `$${fmtNumber(amount)} deposited${pools.split ? ` into the ${kind} pool` : ""}.`).then((ok) => ok && setAmount(""));
  };

  const withdraw = (e) => {
    e.preventDefault();
    if (!guardWallet()) return;
    if (!roles.admin) return setStatus({ type: "error", text: "Only the admin role can withdraw unused funds." });
    const to = (wTo.trim() || account);
    if (!isAddressLike(to)) return setStatus({ type: "error", text: "Enter a valid recipient address." });
    let raw;
    try {
      raw = toUnits(wAmount, USDC_DECIMALS);
      if (raw === 0n) throw new Error("Amount must be greater than 0.");
    } catch (err) {
      return setStatus({ type: "error", text: err.message });
    }
    run("Withdrawing unused funds...", () => getContract("CouponDistributor", signer, network).withdrawUnusedFunds(addrs.MockUSDC, raw, to),
      `$${fmtNumber(wAmount)} withdrawn.`).then((ok) => ok && (setWAmount(""), setWTo("")));
  };

  const covered = (pools.split ? pools.redemption : pools.total) >= pools.needPrincipal;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title"><Wallet size={18} color="#f59e0b" /> Coupon and redemption funding</h3>
          <p className="card-subtitle">{pools.split ? "Separate pools keep coupon payments from using up principal." : "This deployment uses one shared pool for coupons and principal."}</p>
        </div>
      </div>
      <StatusBanner status={status} onClose={() => setStatus(null)} network={network} />
      <div className="grid-4" style={{ marginBottom: "1rem" }}>
        {pools.split && <Tile label="Coupon pool" value={pools.coupon} />}
        <Tile label={pools.split ? "Redemption pool" : "Shared pool"} value={pools.split ? pools.redemption : pools.total} />
        <Tile label="Principal at face value" value={pools.needPrincipal} />
        <div className="stat-box">
          <div className="stat-label"><span>Principal coverage</span></div>
          <div className="stat-value" style={{ fontSize: "1.1rem", marginTop: "0.6rem" }}>{covered ? <span className="badge badge-emerald">Covered</span> : <span className="badge badge-amber">Short</span>}</div>
        </div>
      </div>
      <div className="grid-2">
        <form onSubmit={deposit}>
          {pools.split && (
            <div className="input-group" style={{ marginBottom: "0.5rem" }}>
              <label className="input-label" htmlFor="poolKind">Pool</label>
              <select id="poolKind" className="input-field" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="coupon">Coupon pool</option>
                <option value="redemption">Redemption pool</option>
              </select>
            </div>
          )}
          <div className="input-group">
            <label className="input-label" htmlFor="depAmt">Deposit (MockUSDC)</label>
            <input id="depAmt" className="input-field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="e.g. 80000" />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !amount} style={{ width: "100%", marginTop: "0.75rem" }}>Approve & deposit</button>
        </form>
        {pools.canWithdraw && (
          <form onSubmit={withdraw}>
            <div className="input-group">
              <label className="input-label" htmlFor="wAmt">Withdraw unused funds (admin)</label>
              <input id="wAmt" className="input-field" inputMode="decimal" value={wAmount} onChange={(e) => setWAmount(e.target.value.trim())} placeholder="Amount" />
            </div>
            <div className="input-group" style={{ marginTop: "0.5rem" }}>
              <input className="input-field font-mono" value={wTo} onChange={(e) => setWTo(e.target.value.trim())} placeholder="Recipient (blank = your wallet)" aria-label="Recipient" />
            </div>
            <button type="submit" className="btn btn-secondary" disabled={busy || !wAmount} style={{ width: "100%", marginTop: "0.75rem" }}>Withdraw</button>
          </form>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="stat-box">
      <div className="stat-label"><span>{label}</span></div>
      <div className="stat-value font-mono" style={{ fontSize: "1.2rem" }}>${fmtNumber(fromUnits(value, USDC_DECIMALS), 0, 0)}</div>
    </div>
  );
}

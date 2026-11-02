import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { getContract, fetchOrders, BOND_DECIMALS, USDC_DECIMALS } from "../contracts/platform";
import { fromUnits, fmtNumber, shortAddr } from "../lib/utils";
import { StatusBanner, useTxRunner } from "./ui";
import { Sparkles } from "lucide-react";

/**
 * "Invest in the bond": lots the ISSUER has listed on the marketplace. Today the contracts have no
 * dedicated primary-sale function, so primary issuance is done as issuer-listed lots that are bought whole.
 */
export default function PrimaryOffering({ account, provider, signer, network, isKycVerified, refreshTrigger, setRefreshTrigger }) {
  const [lots, setLots] = useState([]);
  const [faceValue, setFaceValue] = useState(0n);
  const [usdc, setUsdc] = useState(0n);
  const [loading, setLoading] = useState(false);
  const onDone = useCallback(() => setRefreshTrigger((n) => n + 1), [setRefreshTrigger]);
  const { status, setStatus, busy, run } = useTxRunner(onDone);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const market = getContract("Marketplace", provider, network);
        const bond = getContract("BondToken", provider, network);
        const token = getContract("MockUSDC", provider, network);
        const { orders } = await fetchOrders(market, 200);
        const active = orders.filter((o) => o.isActive);
        const sellers = [...new Set(active.map((o) => o.seller))];
        const flags = await Promise.all(sellers.map((s) => bond.hasRole(ethers.id("ISSUER_ROLE"), s)));
        const issuers = new Set(sellers.filter((_, i) => flags[i]).map((s) => s.toLowerCase()));
        const [fv, bal] = await Promise.all([bond.faceValue(), account ? token.balanceOf(account) : 0n]);
        const issuerLots = active
          .filter((o) => issuers.has(o.seller.toLowerCase()))
          .map((o) => ({ ...o, per: (o.price * 10n ** BigInt(BOND_DECIMALS)) / o.bondAmount }))
          .sort((a, b) => (a.per < b.per ? -1 : a.per > b.per ? 1 : 0));
        if (!cancelled) {
          setLots(issuerLots);
          setFaceValue(fv);
          setUsdc(bal);
        }
      } catch (e) {
        console.warn("Could not load the primary offering:", e);
        if (!cancelled) setLots([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, network, account, refreshTrigger]);

  const invest = (lot) => {
    if (!signer) return setStatus({ type: "warn", text: "Connect your wallet on the selected network first." });
    if (!isKycVerified) return setStatus({ type: "error", text: "Complete KYC verification before investing." });
    if (usdc < lot.price) return setStatus({ type: "error", text: `You need $${fmtNumber(fromUnits(lot.price, USDC_DECIMALS))} MockUSDC. Use the faucet first.` });
    run(`Investing in lot #${lot.id}...`, async (setMsg) => {
      const token = getContract("MockUSDC", signer, network);
      const market = getContract("Marketplace", signer, network);
      const marketAddr = await market.getAddress();
      if ((await token.allowance(account, marketAddr)) < lot.price) {
        setMsg({ type: "info", text: `Step 1/2: approve exactly $${fmtNumber(fromUnits(lot.price, USDC_DECIMALS))} MockUSDC (confirm in wallet)...` });
        await (await token.approve(marketAddr, lot.price)).wait();
      }
      setMsg({ type: "info", text: "Step 2/2: confirm the purchase in your wallet..." });
      return market.buy(lot.id);
    }, `Invested: ${fmtNumber(fromUnits(lot.bondAmount, BOND_DECIMALS), 4)} bonds are now in your wallet.`);
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title"><Sparkles size={18} color="#f59e0b" /> Invest: primary offering</h3>
          <p className="card-subtitle">
            Bonds offered directly by the issuer, sold in whole lots. Face value is ${faceValue ? fmtNumber(fromUnits(faceValue, USDC_DECIMALS)) : "..."} per bond.
          </p>
        </div>
        <span className="badge badge-blue">{lots.length} lot(s)</span>
      </div>
      <StatusBanner status={status} onClose={() => setStatus(null)} network={network} />
      {lots.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
          {loading ? "Loading offering..." : "The issuer has no open lots right now. Check the Secondary Market tab, or ask the issuer to open an offering."}
        </p>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead><tr><th>Lot</th><th>Issuer</th><th>Bonds</th><th>Price / bond</th><th>Total</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
            <tbody>
              {lots.slice(0, 8).map((l) => (
                <tr key={l.id}>
                  <td className="font-mono">#{l.id}</td>
                  <td className="font-mono">{shortAddr(l.seller)}</td>
                  <td className="font-mono">{fmtNumber(fromUnits(l.bondAmount, BOND_DECIMALS), 4)}</td>
                  <td className="font-mono">${fmtNumber(fromUnits(l.per, USDC_DECIMALS))}</td>
                  <td className="font-mono">${fmtNumber(fromUnits(l.price, USDC_DECIMALS))}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-primary btn-sm" disabled={busy || !signer || l.seller.toLowerCase() === (account || "").toLowerCase()} onClick={() => invest(l)}>Invest</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

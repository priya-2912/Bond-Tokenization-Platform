import React, { useState, useEffect, useCallback } from "react";
import { getContract, getAddresses, fetchOrders, BOND_DECIMALS, USDC_DECIMALS, addressUrl } from "../contracts/platform";
import { toUnits, fromUnits, fmtNumber, shortAddr } from "../lib/utils";
import { StatusBanner, useTxRunner } from "./ui";
import { ShoppingCart, PlusCircle, RefreshCw, Tag, X } from "lucide-react";

export default function Marketplace({ account, provider, signer, network, isKycVerified, refreshTrigger, setRefreshTrigger }) {
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({ total: 0, truncated: false });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState("buy"); // buy | sell | my
  const [sellAmount, setSellAmount] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [bondBalance, setBondBalance] = useState(0n);
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [faceValue, setFaceValue] = useState(0n);
  const [marketWhitelisted, setMarketWhitelisted] = useState(true);

  const onDone = useCallback(() => setRefreshTrigger((n) => n + 1), [setRefreshTrigger]);
  const { status, setStatus, busy, run } = useTxRunner(onDone);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const marketplace = getContract("Marketplace", provider, network);
        const kyc = getContract("KYCRegistry", provider, network);
        const bond = getContract("BondToken", provider, network);
        const usdc = getContract("MockUSDC", provider, network);
        const marketAddr = getAddresses(network).Marketplace;
        const [res, whitelisted, fv] = await Promise.all([fetchOrders(marketplace, 200), kyc.isVerified(marketAddr), bond.faceValue()]);
        let bBal = 0n, uBal = 0n;
        if (account) [bBal, uBal] = await Promise.all([bond.balanceOf(account), usdc.balanceOf(account)]);
        if (cancelled) return;
        setOrders(res.orders);
        setMeta({ total: res.total, truncated: res.truncated });
        setMarketWhitelisted(whitelisted);
        setFaceValue(fv);
        setBondBalance(bBal);
        setUsdcBalance(uBal);
      } catch (err) {
        console.error("Error loading marketplace:", err);
        if (!cancelled) setLoadError("Could not read the order book. Check the network selection and RPC connection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, network, account, refreshTrigger]);

  const needWallet = () => setStatus({ type: "warn", text: "Connect your wallet on the selected network first." });

  // ---- create order ----
  let sellAmountRaw = 0n, sellPriceRaw = 0n, sellError = null;
  if (sellAmount || sellPrice) {
    try {
      sellAmountRaw = toUnits(sellAmount, BOND_DECIMALS);
      sellPriceRaw = toUnits(sellPrice, USDC_DECIMALS);
      if (sellAmountRaw === 0n || sellPriceRaw === 0n) sellError = "Amount and price must be greater than 0.";
      else if (sellAmountRaw > bondBalance) sellError = "You do not hold that many bonds.";
    } catch (e) {
      sellError = e.message;
    }
  }
  const perBond = sellAmountRaw > 0n && sellPriceRaw > 0n ? (sellPriceRaw * 10n ** BigInt(BOND_DECIMALS)) / sellAmountRaw : 0n;
  const vsFace = perBond > 0n && faceValue > 0n ? Number(((perBond - faceValue) * 10000n) / faceValue) / 100 : null;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!signer) return needWallet();
    if (!isKycVerified) return setStatus({ type: "error", text: "Your wallet is not KYC-verified, so you cannot list orders." });
    if (!marketWhitelisted) return setStatus({ type: "error", text: "The Marketplace contract is not whitelisted in the KYC registry. Compliance must whitelist it (Issuer & Compliance tab > Setup checks)." });
    if (sellError || sellAmountRaw === 0n) return;
    const ok = await run("Preparing sell order...", async (setMsg) => {
      const bond = getContract("BondToken", signer, network);
      const market = getContract("Marketplace", signer, network);
      const marketAddr = await market.getAddress();
      const allowance = await bond.allowance(account, marketAddr);
      if (allowance < sellAmountRaw) {
        setMsg({ type: "info", text: "Step 1/2: approve the Marketplace to escrow exactly this amount of bonds (confirm in wallet)..." });
        await (await bond.approve(marketAddr, sellAmountRaw)).wait();
      }
      setMsg({ type: "info", text: "Step 2/2: creating the sell order (confirm in wallet)..." });
      return market.createSellOrder(sellAmountRaw, sellPriceRaw);
    }, "Sell order created and bonds placed in escrow.");
    if (ok) {
      setSellAmount("");
      setSellPrice("");
      setTab("my");
    }
  };

  // ---- buy ----
  const handleBuy = (order) => {
    if (!signer) return needWallet();
    if (!isKycVerified) return setStatus({ type: "error", text: "Your wallet is not KYC-verified, so you cannot trade." });
    if (order.seller.toLowerCase() === account.toLowerCase()) return setStatus({ type: "error", text: "You cannot buy your own order. Cancel it instead." });
    if (usdcBalance < order.price) return setStatus({ type: "error", text: `You need $${fmtNumber(fromUnits(order.price, USDC_DECIMALS))} MockUSDC. Use the faucet on the Portfolio tab.` });
    run(`Buying order #${order.id}...`, async (setMsg) => {
      const usdc = getContract("MockUSDC", signer, network);
      const market = getContract("Marketplace", signer, network);
      const marketAddr = await market.getAddress();
      const allowance = await usdc.allowance(account, marketAddr);
      if (allowance < order.price) {
        setMsg({ type: "info", text: `Step 1/2: approve exactly $${fmtNumber(fromUnits(order.price, USDC_DECIMALS))} MockUSDC (confirm in wallet)...` });
        await (await usdc.approve(marketAddr, order.price)).wait();
      }
      setMsg({ type: "info", text: `Step 2/2: settling order #${order.id} (confirm in wallet)...` });
      return market.buy(order.id);
    }, `Order #${order.id} purchased. Bonds are now in your wallet.`);
  };

  const handleCancel = (order) => {
    if (!signer) return needWallet();
    run(`Cancelling order #${order.id}...`, () => getContract("Marketplace", signer, network).cancelOrder(order.id), `Order #${order.id} cancelled and bonds returned.`);
  };

  const mine = (o) => account && o.seller.toLowerCase() === account.toLowerCase();
  const buyList = orders.filter((o) => o.isActive && !mine(o));
  const myList = orders.filter(mine);
  const activeCount = orders.filter((o) => o.isActive).length;

  const perBondOf = (o) => (o.bondAmount > 0n ? (o.price * 10n ** BigInt(BOND_DECIMALS)) / o.bondAmount : 0n);

  const SellerCell = ({ o }) => {
    const link = addressUrl(network, o.seller);
    return (
      <span className="font-mono">
        {link ? <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{shortAddr(o.seller)}</a> : shortAddr(o.seller)}
        {mine(o) && <span className="badge badge-blue" style={{ marginLeft: "0.4rem" }}>you</span>}
      </span>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <span className="badge badge-blue">P2P ORDER BOOK</span>
              <span className="badge badge-emerald">{activeCount} active</span>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>Secondary Market</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Escrow-backed trading between KYC-verified wallets. Orders are filled whole: the price is the total for the lot.
            </p>
          </div>
          <button onClick={onDone} className="btn-icon" title="Refresh" aria-label="Refresh order book">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <StatusBanner status={status} onClose={() => setStatus(null)} network={network} />
      {loadError && <div className="alert-banner error"><span>{loadError}</span></div>}
      {!marketWhitelisted && (
        <div className="alert-banner warn">
          <span>
            The Marketplace contract ({shortAddr(getAddresses(network).Marketplace)}) is not whitelisted in the KYC registry, so listing and buying will fail.
            Compliance can fix this in Issuer & Compliance &gt; Setup checks.
          </span>
        </div>
      )}
      {!account && <div className="alert-banner warn"><span>Connect a wallet to trade. You can browse the order book without one.</span></div>}
      {account && !isKycVerified && <div className="alert-banner warn"><span>Your wallet is not KYC-verified yet. Complete verification on the Portfolio tab to trade.</span></div>}

      <div className="card">
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }} role="tablist">
          {[["buy", "Buy"], ["sell", "Sell"], ["my", `My Orders (${myList.length})`]].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`btn btn-sm ${tab === k ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {tab === "buy" && (
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Seller</th><th>Quantity</th><th>Price / bond (USDC)</th><th>Total (USDC)</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
              <tbody>
                {buyList.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "1.5rem" }}>{loading ? "Loading orders..." : "No open sell orders from other wallets."}</td></tr>}
                {buyList.map((o) => (
                  <tr key={o.id}>
                    <td><SellerCell o={o} /></td>
                    <td className="font-mono">{fmtNumber(fromUnits(o.bondAmount, BOND_DECIMALS), 4)}</td>
                    <td className="font-mono">{fmtNumber(fromUnits(perBondOf(o), USDC_DECIMALS))}</td>
                    <td className="font-mono">{fmtNumber(fromUnits(o.price, USDC_DECIMALS))}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn btn-primary btn-sm" disabled={busy || !signer} onClick={() => handleBuy(o)}><ShoppingCart size={12} /> Buy</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {meta.truncated && <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>Showing the latest 200 of {meta.total} orders.</p>}
          </div>
        )}

        {tab === "sell" && (
          <form onSubmit={handleCreate} style={{ maxWidth: 520 }}>
            <div className="card-header" style={{ marginBottom: "0.75rem" }}>
              <div>
                <h3 className="card-title"><Tag size={18} color="#3b82f6" /> List bonds for sale</h3>
                <p className="card-subtitle">You hold {fmtNumber(fromUnits(bondBalance, BOND_DECIMALS), 4)} bonds. Listed bonds move into escrow until sold or cancelled.</p>
              </div>
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="sellAmt">Quantity (bonds)</label>
              <input id="sellAmt" className="input-field" inputMode="decimal" value={sellAmount} onChange={(e) => setSellAmount(e.target.value.trim())} placeholder="e.g. 10" />
            </div>
            <div className="input-group" style={{ marginTop: "0.75rem" }}>
              <label className="input-label" htmlFor="sellPrice">Total price in MockUSDC for the whole lot</label>
              <input id="sellPrice" className="input-field" inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value.trim())} placeholder="e.g. 10050" />
            </div>
            {sellError && <p style={{ color: "var(--accent-rose)", fontSize: "0.8rem", marginTop: "0.5rem" }}>{sellError}</p>}
            {perBond > 0n && !sellError && (
              <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.6rem" }}>
                That is <b className="font-mono">${fmtNumber(fromUnits(perBond, USDC_DECIMALS))}</b> per bond
                {vsFace !== null && ` (${vsFace >= 0 ? "+" : ""}${vsFace.toFixed(2)}% vs face value)`}.
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy || !signer || !sellAmount || !sellPrice || Boolean(sellError)} style={{ marginTop: "1rem", width: "100%" }}>
              <PlusCircle size={14} /> Create sell order
            </button>
          </form>
        )}

        {tab === "my" && (
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Order</th><th>Quantity</th><th>Total (USDC)</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th></tr></thead>
              <tbody>
                {myList.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "1.5rem" }}>{account ? "You have no orders yet." : "Connect a wallet to see your orders."}</td></tr>}
                {myList.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono">#{o.id}</td>
                    <td className="font-mono">{fmtNumber(fromUnits(o.bondAmount, BOND_DECIMALS), 4)}</td>
                    <td className="font-mono">{fmtNumber(fromUnits(o.price, USDC_DECIMALS))}</td>
                    <td>{o.isActive ? <span className="badge badge-emerald">Open</span> : <span className="badge badge-amber">Filled or cancelled</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      {o.isActive && <button className="btn btn-rose btn-sm" disabled={busy || !signer} onClick={() => handleCancel(o)}><X size={12} /> Cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

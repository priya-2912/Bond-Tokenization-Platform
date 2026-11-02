import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import {
  getContract,
  getAddresses,
  fetchOrders,
  loadTerms,
  BOND_DECIMALS,
  USDC_DECIMALS,
  txUrl,
} from "../contracts/platform";
import { toUnits, fromUnits, fmtNumber, shortAddr, friendlyError } from "../lib/utils";
import { fetchBackendEvents } from "../lib/backend";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import { Modal } from "./ui";
import TestUsdcFaucetModal from "./TestUsdcFaucetModal";
import {
  Tag,
  PlusCircle,
  RefreshCw,
  Search,
  ShoppingCart,
  XCircle,
  TrendingUp,
  TrendingDown,
  Info,
  Layers,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Coins,
  History,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

export default function SecondaryMarketplaceView({ onNavigateToAccount }) {
  const { account, readProvider, signer, network, isKycVerified, refreshTrigger, setRefreshTrigger } = useAuth();
  const toast = useToast();

  const [terms, setTerms] = useState(null);
  const [onChainOrders, setOnChainOrders] = useState([]);
  const [completedTrades, setCompletedTrades] = useState([]);
  const [bondBalance, setBondBalance] = useState(0n);
  const [usdcBalance, setUsdcBalance] = useState(0n);
  const [loading, setLoading] = useState(false);

  // Tabs: "catalogue" | "my_listings" | "history"
  const [activeSubTab, setActiveSubTab] = useState("catalogue");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "discount" | "premium" | "par"

  // Sell Modal State
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [sellQuantity, setSellQuantity] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [sellBusy, setSellBusy] = useState(false);
  const [sellStep, setSellStep] = useState("");

  // Buy Modal State
  const [buyModalOrder, setBuyModalOrder] = useState(null);
  const [buyBusy, setBuyBusy] = useState(false);
  const [buyStep, setBuyStep] = useState("");
  const [faucetOpen, setFaucetOpen] = useState(false);

  // Demo simulated secondary listings to showcase depth
  const demoSecondaryListings = useMemo(() => [
    {
      id: "demo-sec-1",
      isOnChain: false,
      bondName: "Apex Solar & Wind Renewable Energy Bond",
      symbol: "APX-GREEN-30",
      issuer: "Apex Clean Energy Holdings",
      seller: "0x39a128eFb5307A68c9247E6e1564883A09B29A78",
      faceValue: 1000,
      askingPrice: 975,
      totalPrice: 4875,
      quantity: 5,
      couponRate: 7.25,
      maturityDate: "2030-06-30",
      premiumDiscountPct: -2.5,
      status: "Active Offer",
    },
    {
      id: "demo-sec-2",
      isOnChain: false,
      bondName: "Prime Manhattan Commercial Tower Senior Debt",
      symbol: "MANH-RE-28",
      issuer: "Empire Capital Real Estate Trust",
      seller: "0x82b415aCc2308F47d8137D2e2353112E84A788C1",
      faceValue: 1000,
      askingPrice: 1025,
      totalPrice: 10250,
      quantity: 10,
      couponRate: 8.50,
      maturityDate: "2028-10-31",
      premiumDiscountPct: 2.5,
      status: "Active Offer",
    },
    {
      id: "demo-sec-3",
      isOnChain: false,
      bondName: "Metropolitan Rail & Intermodal Transit Note",
      symbol: "METRO-INFRA-29",
      issuer: "Metropolitan Infrastructure Authority",
      seller: "0x12c488bEb3407C68a9147E6e1564883A09B29D34",
      faceValue: 5000,
      askingPrice: 4950,
      totalPrice: 9900,
      quantity: 2,
      couponRate: 6.80,
      maturityDate: "2029-12-15",
      premiumDiscountPct: -1.0,
      status: "Active Offer",
    },
  ], []);

  // Load on-chain data
  const loadMarketData = useCallback(async () => {
    setLoading(true);
    try {
      const t = await loadTerms(readProvider, network);
      setTerms(t);

      const marketplace = getContract("Marketplace", readProvider, network);
      const bond = getContract("BondToken", readProvider, network);
      const usdc = getContract("MockUSDC", readProvider, network);

      const [res, bBal, uBal] = await Promise.all([
        fetchOrders(marketplace, 200),
        account ? bond.balanceOf(account) : 0n,
        account ? usdc.balanceOf(account) : 0n,
      ]);

      setOnChainOrders(res.orders || []);
      setBondBalance(bBal);
      setUsdcBalance(uBal);

      // Load completed trades from backend indexer
      try {
        const eventsRes = await fetchBackendEvents(100);
        if (eventsRes && eventsRes.ok && Array.isArray(eventsRes.data)) {
          const filled = eventsRes.data.filter((e) => e.type === "OrderFilled");
          setCompletedTrades(filled);
        }
      } catch {
        setCompletedTrades([]);
      }
    } catch (err) {
      console.warn("Could not load secondary market data:", err);
    } finally {
      setLoading(false);
    }
  }, [account, readProvider, network]);

  useEffect(() => {
    loadMarketData();
  }, [loadMarketData, refreshTrigger]);

  // Transform on-chain orders into secondary listings
  const allListings = useMemo(() => {
    const list = [];
    const faceValNum = terms ? Number(fromUnits(terms.faceValue, USDC_DECIMALS)) : 1000;
    const couponPctNum = terms ? terms.couponRateBps / 100 : 8.0;
    const maturityIso = terms ? terms.maturity.toISOString().split("T")[0] : "2028-05-15";

    // Active on-chain orders
    onChainOrders
      .filter((o) => o.isActive)
      .forEach((order) => {
        const bondQty = Number(fromUnits(order.bondAmount, BOND_DECIMALS));
        const totalPrice = Number(fromUnits(order.price, USDC_DECIMALS));
        const perBond = bondQty > 0 ? totalPrice / bondQty : totalPrice;
        const diff = perBond - faceValNum;
        const premiumDiscountPct = Number(((diff / faceValNum) * 100).toFixed(2));

        list.push({
          id: `onchain-sec-${order.id}`,
          orderId: order.id,
          isOnChain: true,
          rawOrder: order,
          bondName: terms?.name || "Aura US Treasury Short-Duration Bond",
          symbol: terms?.symbol || "CB28",
          issuer: "Aura Capital Primary Issuance",
          seller: order.seller,
          faceValue: faceValNum,
          askingPrice: perBond,
          totalPrice: totalPrice,
          quantity: bondQty,
          couponRate: couponPctNum,
          maturityDate: maturityIso,
          premiumDiscountPct,
          status: "Active On-Chain",
        });
      });

    // Append demo simulated listings
    demoSecondaryListings.forEach((d) => list.push(d));

    return list;
  }, [onChainOrders, terms, demoSecondaryListings]);

  // Filter listings
  const filteredListings = useMemo(() => {
    return allListings.filter((item) => {
      // Tab filter
      if (activeSubTab === "my_listings") {
        if (!account) return false;
        if (!item.isOnChain || item.seller.toLowerCase() !== account.toLowerCase()) return false;
      }

      // Search
      if (search) {
        const s = search.toLowerCase();
        const matchName = item.bondName.toLowerCase().includes(s);
        const matchSeller = item.seller.toLowerCase().includes(s);
        const matchSymbol = item.symbol.toLowerCase().includes(s);
        if (!matchName && !matchSeller && !matchSymbol) return false;
      }

      // Status / pricing filter
      if (statusFilter === "discount" && item.premiumDiscountPct >= 0) return false;
      if (statusFilter === "premium" && item.premiumDiscountPct <= 0) return false;
      if (statusFilter === "par" && item.premiumDiscountPct !== 0) return false;

      return true;
    });
  }, [allListings, activeSubTab, account, search, statusFilter]);

  // EXECUTE: Create Sell Order
  const handleCreateSellOrder = async (e) => {
    e.preventDefault();
    if (!signer || !account) {
      return toast.warn("Please connect your MetaMask wallet on Sepolia.");
    }
    if (!isKycVerified) {
      return toast.error("You must be KYC-verified to list bonds on the secondary market.");
    }

    const qtyNum = Number(sellQuantity);
    const priceNum = Number(sellPrice);

    if (!qtyNum || qtyNum <= 0) return toast.warn("Enter a valid bond quantity.");
    if (!priceNum || priceNum <= 0) return toast.warn("Enter a valid total asking price.");

    const rawBondQty = toUnits(String(qtyNum), BOND_DECIMALS);
    if (rawBondQty > bondBalance) {
      return toast.error(`Insufficient bond balance. You hold ${fmtNumber(fromUnits(bondBalance, BOND_DECIMALS))} bonds.`);
    }

    setSellBusy(true);
    try {
      const bond = getContract("BondToken", signer, network);
      const marketplace = getContract("Marketplace", signer, network);
      const marketAddr = await marketplace.getAddress();
      const rawPrice = toUnits(String(priceNum), USDC_DECIMALS);

      // Check allowance of BondToken
      setSellStep("Checking bond token transfer approval...");
      const allowance = await bond.allowance(account, marketAddr);

      if (allowance < rawBondQty) {
        setSellStep("Confirming bond allowance in MetaMask...");
        const appTx = await bond.approve(marketAddr, rawBondQty);
        await appTx.wait();
      }

      // Create Order
      setSellStep("Creating secondary market sell order in MetaMask...");
      const orderTx = await marketplace.createSellOrder(rawBondQty, rawPrice);
      setSellStep("Finalizing order on Sepolia...");
      await orderTx.wait();

      toast.success(`Successfully created listing for ${qtyNum} bonds at $${fmtNumber(priceNum)} USDC!`);
      setSellModalOpen(false);
      setSellQuantity("");
      setSellPrice("");
      setRefreshTrigger((n) => n + 1);
      loadMarketData();
    } catch (err) {
      console.error("Create sell order failed:", err);
      toast.error(friendlyError(err));
    } finally {
      setSellBusy(false);
      setSellStep("");
    }
  };

  // EXECUTE: Buy Order
  const handleExecuteBuy = async () => {
    if (!signer || !account) {
      return toast.warn("Please connect your MetaMask wallet on Sepolia.");
    }
    if (!isKycVerified) {
      return toast.error("Your wallet is not KYC-verified. Please complete verification first.");
    }
    if (!buyModalOrder) return;

    if (!buyModalOrder.isOnChain) {
      alert("This is a demonstration listing. Live purchases execute on active on-chain Sepolia listings.");
      return setBuyModalOrder(null);
    }

    const order = buyModalOrder.rawOrder;
    if (order.price > usdcBalance) {
      return toast.error(`Insufficient MockUSDC balance. You need $${fmtNumber(fromUnits(order.price, USDC_DECIMALS))} USDC.`);
    }

    setBuyBusy(true);
    try {
      const usdc = getContract("MockUSDC", signer, network);
      const marketplace = getContract("Marketplace", signer, network);
      const marketAddr = await marketplace.getAddress();

      // Check allowance
      setBuyStep("Checking USDC approval in MetaMask...");
      const allowance = await usdc.allowance(account, marketAddr);

      if (allowance < order.price) {
        setBuyStep("Approving USDC payment in MetaMask...");
        const appTx = await usdc.approve(marketAddr, order.price);
        await appTx.wait();
      }

      // Execute buy
      setBuyStep("Purchasing secondary listing in MetaMask...");
      const buyTx = await marketplace.buy(order.id);
      setBuyStep("Finalizing trade on Sepolia...");
      await buyTx.wait();

      toast.success(`Trade complete! Acquired ${fmtNumber(fromUnits(order.bondAmount, BOND_DECIMALS))} bonds.`);
      setBuyModalOrder(null);
      setRefreshTrigger((n) => n + 1);
      loadMarketData();
    } catch (err) {
      console.error("Secondary buy error:", err);
      toast.error(friendlyError(err));
    } finally {
      setBuyBusy(false);
      setBuyStep("");
    }
  };

  // EXECUTE: Cancel Listing
  const handleCancelOrder = async (orderId) => {
    if (!signer) return toast.warn("Connect wallet first.");
    try {
      const marketplace = getContract("Marketplace", signer, network);
      toast.info(`Canceling order #${orderId}...`);
      const tx = await marketplace.cancelOrder(orderId);
      await tx.wait();
      toast.success(`Listing #${orderId} successfully cancelled.`);
      setRefreshTrigger((n) => n + 1);
      loadMarketData();
    } catch (err) {
      console.error("Cancel order error:", err);
      toast.error(friendlyError(err));
    }
  };

  const userHoldingsCount = Number(fromUnits(bondBalance, BOND_DECIMALS));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header Banner */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="badge badge-blue">SECONDARY LIQUIDITY</span>
              <span className="badge badge-emerald">Peer-to-Peer Trading</span>
            </div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Secondary Bond Marketplace
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem", maxWidth: 650 }}>
              Trade existing bond holdings directly with other verified investors. Buy at a discount or sell positions
              before maturity with instant on-chain escrow settlement.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (userHoldingsCount <= 0) {
                  toast.warn("You do not hold any bonds to list for sale.");
                } else {
                  setSellModalOpen(true);
                }
              }}
              style={{ gap: "0.4rem" }}
            >
              <PlusCircle size={14} />
              <span>List Bonds for Sale</span>
            </button>

            <button
              className="btn btn-emerald btn-sm"
              onClick={() => setFaucetOpen(true)}
              title="Claim test MockUSDC"
            >
              <Coins size={14} />
              <span>Get Test USDC</span>
            </button>

            <button
              className="btn-icon"
              onClick={() => { setRefreshTrigger((n) => n + 1); loadMarketData(); }}
              aria-label="Refresh secondary market"
              title="Refresh listings"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Education Callout: Primary vs Secondary */}
        <div
          style={{
            marginTop: "1.25rem",
            padding: "0.75rem 1rem",
            background: "rgba(59, 130, 246, 0.06)",
            border: "1px solid rgba(59, 130, 246, 0.2)",
            borderRadius: "var(--radius-sm)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1rem",
            fontSize: "0.78rem",
          }}
        >
          <div>
            <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>Primary Market: </span>
            <span style={{ color: "var(--text-secondary)" }}>Acquire newly tokenized debt tranches directly from verified corporate or municipal issuers at face value.</span>
          </div>
          <div>
            <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>Secondary Market: </span>
            <span style={{ color: "var(--text-secondary)" }}>Trade pre-owned bond units with other investors at custom market prices reflecting interest rate changes.</span>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs & Filters */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          {/* Subtabs */}
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              className={`btn btn-sm ${activeSubTab === "catalogue" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveSubTab("catalogue")}
            >
              Active Listings ({allListings.length})
            </button>
            <button
              className={`btn btn-sm ${activeSubTab === "my_listings" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveSubTab("my_listings")}
            >
              My Listings
            </button>
            <button
              className={`btn btn-sm ${activeSubTab === "history" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveSubTab("history")}
            >
              Completed Trades ({completedTrades.length})
            </button>
          </div>

          {/* Search & Pricing Filter */}
          {activeSubTab !== "history" && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <div className="search-input-wrapper" style={{ width: 220 }}>
                <Search size={14} className="search-icon" />
                <input
                  type="text"
                  className="search-input"
                  style={{ fontSize: "0.78rem", padding: "0.4rem 0.6rem 0.4rem 2rem" }}
                  placeholder="Search listings..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <select
                className="input-field"
                style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem", width: "auto" }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Pricing</option>
                <option value="discount">Trading at Discount</option>
                <option value="premium">Trading at Premium</option>
                <option value="par">Trading at Par ($1,000)</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Render */}
      {activeSubTab === "history" ? (
        /* Completed Trades Table */
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <History size={17} color="#f59e0b" /> Completed Secondary Market Trades
              </h3>
              <p className="card-subtitle">Indexed peer-to-peer bond transactions executed on Sepolia.</p>
            </div>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Buyer</th>
                  <th>Seller</th>
                  <th>Quantity</th>
                  <th>Execution Price</th>
                  <th>Block</th>
                  <th style={{ textAlign: "right" }}>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {completedTrades.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2.5rem" }}>
                      No completed secondary trades recorded yet on this deployment.
                    </td>
                  </tr>
                ) : (
                  completedTrades.map((trade, idx) => {
                    const args = trade.args || {};
                    const url = txUrl(network, trade.tx_hash);
                    return (
                      <tr key={trade.tx_hash || idx}>
                        <td className="font-mono">#{args.orderId || args.id || idx + 1}</td>
                        <td className="font-mono">{args.buyer ? shortAddr(args.buyer) : "..."}</td>
                        <td className="font-mono">{args.seller ? shortAddr(args.seller) : "..."}</td>
                        <td className="font-mono">
                          {args.bondAmount ? fmtNumber(fromUnits(args.bondAmount, BOND_DECIMALS)) : "..."}
                        </td>
                        <td className="font-mono" style={{ color: "var(--accent-emerald)", fontWeight: 700 }}>
                          ${args.priceInUSDC ? fmtNumber(fromUnits(args.priceInUSDC, USDC_DECIMALS)) : "..."} USDC
                        </td>
                        <td className="font-mono">{trade.blockNumber || "-"}</td>
                        <td style={{ textAlign: "right" }}>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" style={{ color: "var(--accent-blue)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                              <span>{shortAddr(trade.tx_hash)}</span>
                              <ExternalLink size={11} />
                            </a>
                          ) : (
                            <span className="font-mono">{shortAddr(trade.tx_hash)}</span>
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
      ) : (
        /* Secondary Listings Grid */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "1.25rem" }}>
          {filteredListings.length === 0 ? (
            <div className="card" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "3rem 1.5rem" }}>
              <Tag size={36} color="#64748b" style={{ margin: "0 auto 0.75rem auto", opacity: 0.6 }} />
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                {activeSubTab === "my_listings" ? "No Active Sell Listings Found" : "No Matching Secondary Offers"}
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                {activeSubTab === "my_listings"
                  ? "You do not have any active bond orders listed for sale. Click 'List Bonds for Sale' above."
                  : "No secondary listings match your active search and pricing filters."}
              </p>
            </div>
          ) : (
            filteredListings.map((item) => {
              const isSeller = account && item.seller.toLowerCase() === account.toLowerCase();
              const hasDiscount = item.premiumDiscountPct < 0;
              const hasPremium = item.premiumDiscountPct > 0;

              return (
                <div
                  key={item.id}
                  className="card"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    border: item.isOnChain ? "1px solid rgba(59, 130, 246, 0.4)" : "1px solid var(--border-subtle)",
                  }}
                >
                  <div>
                    {/* Header Badges */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        {item.isOnChain ? (
                          <span className="badge badge-blue">ORDER #{item.orderId}</span>
                        ) : (
                          <span className="badge badge-amber">DEMO OFFER</span>
                        )}
                        <span className="badge badge-emerald">{item.couponRate}% APY</span>
                      </div>

                      {/* Premium / Discount Badge */}
                      {hasDiscount ? (
                        <span className="badge badge-emerald" style={{ display: "inline-flex", gap: 3 }}>
                          <TrendingDown size={12} />
                          <span>{Math.abs(item.premiumDiscountPct)}% Discount</span>
                        </span>
                      ) : hasPremium ? (
                        <span className="badge badge-amber" style={{ display: "inline-flex", gap: 3 }}>
                          <TrendingUp size={12} />
                          <span>+{item.premiumDiscountPct}% Premium</span>
                        </span>
                      ) : (
                        <span className="badge badge-blue">Par ($1,000)</span>
                      )}
                    </div>

                    <h3 style={{ fontSize: "1.15rem", fontWeight: 800 }}>
                      {item.bondName}
                    </h3>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      <span>Seller: <b className="font-mono" style={{ color: "var(--text-primary)" }}>{shortAddr(item.seller)}</b></span>
                      <span>Matures: {item.maturityDate}</span>
                    </div>

                    {/* Listing Financials Grid */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "0.65rem",
                        margin: "1rem 0",
                        padding: "0.85rem",
                        background: "var(--bg-input)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-subtle)",
                        fontSize: "0.78rem",
                      }}
                    >
                      <div>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>Offered Units</div>
                        <div className="font-mono" style={{ fontWeight: 700, fontSize: "1.05rem" }}>{fmtNumber(item.quantity)} Bonds</div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>Price Per Bond</div>
                        <div className="font-mono" style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--accent-blue)" }}>
                          ${fmtNumber(item.askingPrice)} USDC
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>Face Value</div>
                        <div className="font-mono">${fmtNumber(item.faceValue)}</div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>Total Consideration</div>
                        <div className="font-mono" style={{ fontWeight: 800, color: "var(--accent-emerald)" }}>
                          ${fmtNumber(item.totalPrice)} USDC
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "0.85rem" }}>
                    {isSeller ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleCancelOrder(item.orderId)}
                        style={{ flex: 1, justifyContent: "center", color: "var(--accent-rose)", gap: 4 }}
                      >
                        <XCircle size={13} />
                        <span>Cancel Listing</span>
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setBuyModalOrder(item)}
                        style={{ flex: 1, justifyContent: "center", gap: 4 }}
                      >
                        <ShoppingCart size={13} />
                        <span>Buy Listing (${fmtNumber(item.totalPrice)} USDC)</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* MODAL 1: List Bonds for Sale Wizard */}
      {sellModalOpen && (
        <Modal title="List Bonds for Sale on Secondary Market" onClose={() => setSellModalOpen(false)}>
          <form onSubmit={handleCreateSellOrder} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
            <div style={{ fontSize: "0.825rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Create a peer-to-peer sell order. Bonds will be held in atomic escrow by the `Marketplace` smart contract
              until purchased or cancelled.
            </div>

            <div style={{ padding: "0.75rem 1rem", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", fontSize: "0.8rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Available in Wallet:</span>
                <span className="font-mono" style={{ fontWeight: 700 }}>
                  {fmtNumber(fromUnits(bondBalance, BOND_DECIMALS))} {terms?.symbol || "Bonds"}
                </span>
              </div>
            </div>

            {/* Quantity */}
            <div className="input-group">
              <label className="input-label" htmlFor="sellQtyInput">Bond Quantity to Sell *</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  id="sellQtyInput"
                  className="input-field font-mono"
                  type="number"
                  step="any"
                  min="0.0001"
                  required
                  placeholder="e.g. 5"
                  value={sellQuantity}
                  onChange={(e) => setSellQuantity(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSellQuantity(fromUnits(bondBalance, BOND_DECIMALS))}
                >
                  Max
                </button>
              </div>
            </div>

            {/* Asking Price */}
            <div className="input-group">
              <label className="input-label" htmlFor="sellPriceInput">Total Asking Price (MockUSDC) *</label>
              <input
                id="sellPriceInput"
                className="input-field font-mono"
                type="number"
                step="any"
                min="1"
                required
                placeholder="e.g. 5000"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
              />
              {sellQuantity && sellPrice && Number(sellQuantity) > 0 && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
                  Effective Price: <b className="font-mono">${(Number(sellPrice) / Number(sellQuantity)).toFixed(2)} USDC / bond</b>
                </div>
              )}
            </div>

            {sellStep && (
              <div className="alert-banner info" style={{ margin: 0 }}>
                <RefreshCw size={13} className="spin" />
                <span style={{ fontSize: "0.78rem" }}>{sellStep}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" }}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={sellBusy} onClick={() => setSellModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={sellBusy || !sellQuantity || !sellPrice}>
                {sellBusy ? "Executing..." : "Confirm & Create Listing"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 2: Buy Secondary Listing Confirmation */}
      {buyModalOrder && (
        <Modal title="Confirm Secondary Market Purchase" onClose={() => setBuyModalOrder(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
            <div style={{ fontSize: "0.825rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              You are purchasing pre-owned bonds from a peer investor. Settlement occurs atomically on Sepolia.
            </div>

            <div style={{ padding: "0.85rem", background: "var(--bg-secondary)", borderRadius: "var(--radius-sm)", fontSize: "0.825rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Bond Asset:</span>
                <span style={{ fontWeight: 700 }}>{buyModalOrder.bondName}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Quantity:</span>
                <span className="font-mono" style={{ fontWeight: 700 }}>{fmtNumber(buyModalOrder.quantity)} Bonds</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Price Per Bond:</span>
                <span className="font-mono">${fmtNumber(buyModalOrder.askingPrice)} USDC</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border-subtle)", paddingTop: "0.4rem" }}>
                <span style={{ fontWeight: 700 }}>Total Purchase Cost:</span>
                <span className="font-mono" style={{ fontWeight: 800, color: "var(--accent-blue)" }}>
                  ${fmtNumber(buyModalOrder.totalPrice)} USDC
                </span>
              </div>
            </div>

            {/* Live Balance Check */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem" }}>
              <span style={{ color: "var(--text-muted)" }}>Your Available MockUSDC:</span>
              <span className="font-mono" style={{ fontWeight: 700, color: usdcBalance >= toUnits(String(buyModalOrder.totalPrice), USDC_DECIMALS) ? "#10b981" : "#f59e0b" }}>
                ${fmtNumber(fromUnits(usdcBalance, USDC_DECIMALS))} USDC
              </span>
            </div>

            {buyStep && (
              <div className="alert-banner info" style={{ margin: 0 }}>
                <RefreshCw size={13} className="spin" />
                <span style={{ fontSize: "0.78rem" }}>{buyStep}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button className="btn btn-secondary btn-sm" disabled={buyBusy} onClick={() => setBuyModalOrder(null)}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" disabled={buyBusy} onClick={handleExecuteBuy}>
                {buyBusy ? "Settling..." : "Confirm & Settle Trade"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Faucet Modal */}
      <TestUsdcFaucetModal
        isOpen={faucetOpen}
        onClose={() => setFaucetOpen(false)}
        initialAmount="5000"
        onSuccess={() => {
          setRefreshTrigger((n) => n + 1);
          loadMarketData();
        }}
      />
    </div>
  );
}


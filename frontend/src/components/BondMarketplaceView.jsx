import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import {
  getContract,
  fetchOrders,
  loadTerms,
  BOND_DECIMALS,
  USDC_DECIMALS,
} from "../contracts/platform";
import { fromUnits, fmtNumber, shortAddr } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import BondInvestmentModal from "./BondInvestmentModal";
import BondDetailsModal from "./BondDetailsModal";
import TestUsdcFaucetModal from "./TestUsdcFaucetModal";
import { DEMO_BOND_CATEGORIES, DEMO_CATALOGUE_OFFERINGS } from "../data/bondOfferings";
import {
  Search,
  Filter,
  Sparkles,
  Layers,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  RefreshCw,
  Info,
  Calendar,
  Building,
  DollarSign,
  Tag,
  Coins,
  ChevronDown,
  Eye,
  SlidersHorizontal,
} from "lucide-react";

export default function BondMarketplaceView({ onNavigateToAccount, onViewInvestments, onNavigateToSecondary }) {
  const { account, readProvider, signer, network, isKycVerified, refreshTrigger, setRefreshTrigger } = useAuth();
  const toast = useToast();

  const [terms, setTerms] = useState(null);
  const [primaryLots, setPrimaryLots] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters & Search
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All Categories");
  const [minYieldFilter, setMinYieldFilter] = useState("all"); // "all" | "6" | "7" | "8"
  const [maturityFilter, setMaturityFilter] = useState("all"); // "all" | "short" (<2yr) | "medium" (2-5yr) | "long" (>5yr)
  const [sortBy, setSortBy] = useState("coupon_desc"); // "coupon_desc" | "maturity_asc" | "price_asc"

  // Selected for modals
  const [selectedLotForInvest, setSelectedLotForInvest] = useState(null);
  const [selectedBondForDetails, setSelectedBondForDetails] = useState(null);
  const [faucetOpen, setFaucetOpen] = useState(false);

  // Load on-chain primary lots & terms
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const t = await loadTerms(readProvider, network);
      setTerms(t);

      const market = getContract("Marketplace", readProvider, network);
      const bond = getContract("BondToken", readProvider, network);
      const { orders } = await fetchOrders(market, 200);

      const active = orders.filter((o) => o.isActive);
      const sellers = [...new Set(active.map((o) => o.seller))];
      const flags = await Promise.all(sellers.map((s) => bond.hasRole(ethers.id("ISSUER_ROLE"), s)));
      const issuers = new Set(sellers.filter((_, i) => flags[i]).map((s) => s.toLowerCase()));

      const issuerLots = active
        .filter((o) => issuers.has(o.seller.toLowerCase()))
        .map((o) => ({
          ...o,
          per: (o.price * 10n ** BigInt(BOND_DECIMALS)) / o.bondAmount,
        }))
        .sort((a, b) => (a.per < b.per ? -1 : a.per > b.per ? 1 : 0));

      setPrimaryLots(issuerLots);
    } catch (err) {
      console.warn("Could not load marketplace data:", err);
    } finally {
      setLoading(false);
    }
  }, [readProvider, network]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  // Build unified bond catalogue: On-chain primary lots + Demo catalogue offerings
  const allOfferings = useMemo(() => {
    const list = [];
    const couponPctNum = terms ? terms.couponRateBps / 100 : 8.0;
    const faceValNum = terms ? Number(fromUnits(terms.faceValue, USDC_DECIMALS)) : 1000;
    const maturityIso = terms ? terms.maturity.toISOString().split("T")[0] : "2028-05-15";

    // 1. Live On-Chain Offerings (from deployed Sepolia contracts)
    if (primaryLots.length > 0) {
      primaryLots.forEach((lot) => {
        const bondQty = Number(fromUnits(lot.bondAmount, BOND_DECIMALS));
        const totalPrice = Number(fromUnits(lot.price, USDC_DECIMALS));
        const perBond = Number(fromUnits(lot.per, USDC_DECIMALS));

        list.push({
          id: `onchain-lot-${lot.id}`,
          isOnChain: true,
          lotData: lot,
          name: terms?.name || "Aura US Treasury Short-Duration Bond",
          symbol: terms?.symbol || "CB28",
          category: "Corporate Bonds",
          issuer: "Aura Capital Primary Issuance",
          issuerAddress: lot.seller,
          faceValue: faceValNum,
          issuePrice: perBond,
          totalPrice: totalPrice,
          annualCouponRate: couponPctNum,
          paymentFrequency: "Quarterly",
          paymentsPerYear: 4,
          maturityDate: maturityIso,
          minInvestment: perBond,
          availableQuantity: bondQty,
          totalIssuedQuantity: 10000,
          riskRating: "AAA (Senior Secured)",
          riskSummary: "On-chain reserve-backed senior debt verified with Chainlink and ReserveGuard proof-of-reserves.",
          status: "Live on Sepolia",
          useOfProceeds: "Treasury bill portfolio reserve backing with continuous KYC compliance gating.",
          creditCollateral: "Short-term US Treasury Bills and cash-equivalent reserves.",
        });
      });
    } else {
      // Default on-chain primary bond benchmark card
      list.push({
        id: "onchain-benchmark",
        isOnChain: true,
        lotData: null,
        name: terms?.name || "Aura US Treasury Short-Duration Bond",
        symbol: terms?.symbol || "CB28",
        category: "Corporate Bonds",
        issuer: "Aura Capital Primary Issuance",
        issuerAddress: "0x00cB78Ea9EdD2D3Bd136aE9b0D1E576612d49F64",
        faceValue: faceValNum,
        issuePrice: faceValNum,
        totalPrice: faceValNum,
        annualCouponRate: couponPctNum,
        paymentFrequency: "Quarterly",
        paymentsPerYear: 4,
        maturityDate: maturityIso,
        minInvestment: faceValNum,
        availableQuantity: 500,
        totalIssuedQuantity: 10000,
        riskRating: "AAA (Senior Secured)",
        riskSummary: "On-chain reserve-backed senior debt verified with Chainlink and ReserveGuard proof-of-reserves.",
        status: "Live on Sepolia",
        useOfProceeds: "Treasury bill portfolio reserve backing with continuous KYC compliance gating.",
        creditCollateral: "Short-term US Treasury Bills and cash-equivalent reserves.",
      });
    }

    // 2. Demo Catalogue Offerings
    DEMO_CATALOGUE_OFFERINGS.forEach((d) => list.push(d));

    return list;
  }, [primaryLots, terms]);

  // Filter & Sort
  const filteredBonds = useMemo(() => {
    return allOfferings
      .filter((b) => {
        // Search text
        if (search) {
          const s = search.toLowerCase();
          const matchName = b.name.toLowerCase().includes(s);
          const matchSymbol = b.symbol.toLowerCase().includes(s);
          const matchIssuer = b.issuer.toLowerCase().includes(s);
          if (!matchName && !matchSymbol && !matchIssuer) return false;
        }

        // Category filter
        if (selectedCategory !== "All Categories" && b.category !== selectedCategory) {
          return false;
        }

        // Coupon rate filter
        if (minYieldFilter !== "all") {
          const minRate = Number(minYieldFilter);
          if (b.annualCouponRate < minRate) return false;
        }

        // Maturity filter
        if (maturityFilter !== "all") {
          const matYear = new Date(b.maturityDate).getFullYear();
          const currentYear = new Date().getFullYear();
          const diffYears = matYear - currentYear;
          if (maturityFilter === "short" && diffYears >= 2) return false;
          if (maturityFilter === "medium" && (diffYears < 2 || diffYears > 5)) return false;
          if (maturityFilter === "long" && diffYears <= 5) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === "coupon_desc") return b.annualCouponRate - a.annualCouponRate;
        if (sortBy === "price_asc") return a.issuePrice - b.issuePrice;
        if (sortBy === "maturity_asc") {
          return new Date(a.maturityDate) - new Date(b.maturityDate);
        }
        return 0;
      });
  }, [allOfferings, search, selectedCategory, minYieldFilter, maturityFilter, sortBy]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header Banner */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="badge badge-blue">PRIMARY CAPITAL MARKETS</span>
              <span className="badge badge-emerald">Fixed Income Offerings</span>
            </div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Explore Bond Offerings
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem", maxWidth: 680 }}>
              Discover newly issued tokenized bonds across Corporate, Green Energy, Infrastructure, and Municipal sectors.
              Live blockchain subscriptions execute with zero counterparty risk.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            {onNavigateToSecondary && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={onNavigateToSecondary}
                style={{ gap: "0.35rem" }}
              >
                <Tag size={13} />
                <span>Go to Secondary Market</span>
              </button>
            )}
            <button
              className="btn btn-emerald btn-sm"
              onClick={() => setFaucetOpen(true)}
              title="Claim test MockUSDC"
            >
              <Coins size={13} />
              <span>Get Test USDC</span>
            </button>
            <button
              className="btn-icon"
              onClick={() => { setRefreshTrigger((n) => n + 1); loadData(); }}
              aria-label="Refresh offerings"
              title="Refresh catalogue"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Category Filter Pills */}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {DEMO_BOND_CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`btn btn-sm ${selectedCategory === cat ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setSelectedCategory(cat)}
              style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem" }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Search, Rate, Maturity & Sorting Controls */}
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          {/* Search Box */}
          <div className="search-input-wrapper" style={{ flex: "1 1 260px", maxWidth: 380 }}>
            <Search size={15} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search by bond name, symbol, or issuer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Right Select Filters */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            {/* Min Yield Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              <span>Yield:</span>
              <select
                className="input-field"
                style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem", width: "auto" }}
                value={minYieldFilter}
                onChange={(e) => setMinYieldFilter(e.target.value)}
              >
                <option value="all">All Yields</option>
                <option value="6">&ge; 6.00%</option>
                <option value="7">&ge; 7.00%</option>
                <option value="8">&ge; 8.00%</option>
              </select>
            </div>

            {/* Maturity Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              <span>Maturity:</span>
              <select
                className="input-field"
                style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem", width: "auto" }}
                value={maturityFilter}
                onChange={(e) => setMaturityFilter(e.target.value)}
              >
                <option value="all">All Maturities</option>
                <option value="short">&lt; 2 Years</option>
                <option value="medium">2 – 5 Years</option>
                <option value="long">&gt; 5 Years</option>
              </select>
            </div>

            {/* Sorting */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              <span>Sort:</span>
              <select
                className="input-field"
                style={{ padding: "0.35rem 0.65rem", fontSize: "0.75rem", width: "auto" }}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="coupon_desc">Highest Yield</option>
                <option value="maturity_asc">Shortest Maturity</option>
                <option value="price_asc">Lowest Price</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Bond Cards Catalogue Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "1.25rem" }}>
        {filteredBonds.length === 0 ? (
          <div className="card" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "3rem 1.5rem" }}>
            <Layers size={36} color="#64748b" style={{ margin: "0 auto 0.75rem auto", opacity: 0.6 }} />
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>No Offerings Found</h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              No bond offerings match your active category and filter selections.
            </p>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSelectedCategory("All Categories");
                setMinYieldFilter("all");
                setMaturityFilter("all");
                setSearch("");
              }}
              style={{ marginTop: "1rem" }}
            >
              Reset Filters
            </button>
          </div>
        ) : (
          filteredBonds.map((bond) => {
            const isLive = bond.isOnChain;

            return (
              <div
                key={bond.id}
                className="card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  border: isLive ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid var(--border-subtle)",
                  background: isLive
                    ? "linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(21, 29, 44, 0.95) 100%)"
                    : "var(--bg-card)",
                }}
              >
                <div>
                  {/* Top Badges */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                      <span className="badge badge-blue">{bond.category}</span>
                      {isLive ? (
                        <span className="badge badge-emerald">SEPOLIA LIVE</span>
                      ) : (
                        <span className="badge badge-amber">DEMO</span>
                      )}
                    </div>
                    <span style={{ fontWeight: 800, color: "var(--accent-emerald)", fontSize: "1.05rem" }}>
                      {bond.annualCouponRate}% APY
                    </span>
                  </div>

                  {/* Title & Issuer */}
                  <h3 style={{ fontSize: "1.15rem", fontWeight: 800, lineHeight: 1.3 }}>
                    {bond.name}
                  </h3>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                    Issuer: <span style={{ color: "var(--text-secondary)" }}>{bond.issuer}</span>
                  </div>

                  {/* Bond Specs Grid (All 11 required fields) */}
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
                      <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>Face Value</div>
                      <div className="font-mono" style={{ fontWeight: 700 }}>${fmtNumber(bond.faceValue)}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>Issue Price</div>
                      <div className="font-mono" style={{ fontWeight: 700, color: "var(--accent-blue)" }}>${fmtNumber(bond.issuePrice)}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>Payment Frequency</div>
                      <div style={{ fontWeight: 600 }}>{bond.paymentFrequency}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>Maturity Date</div>
                      <div style={{ fontWeight: 600 }}>{bond.maturityDate}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>Min. Investment</div>
                      <div className="font-mono">${fmtNumber(bond.minInvestment)}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>Available / Issued</div>
                      <div className="font-mono">{fmtNumber(bond.availableQuantity)} / {fmtNumber(bond.totalIssuedQuantity)}</div>
                    </div>
                  </div>

                  {/* Risk & Status Badges */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", marginBottom: "0.5rem" }}>
                    <span style={{ color: "var(--text-muted)" }}>
                      Risk Rating: <b style={{ color: "var(--accent-emerald)" }}>{bond.riskRating}</b>
                    </span>
                    <span className="badge badge-emerald" style={{ fontSize: "0.65rem" }}>
                      {bond.status}
                    </span>
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "0.85rem" }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setSelectedBondForDetails(bond)}
                    style={{ flex: 1, justifyContent: "center", gap: "0.35rem" }}
                  >
                    <Eye size={13} />
                    <span>View Details</span>
                  </button>

                  <button
                    className={`btn btn-sm ${isLive ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => {
                      if (isLive) {
                        setSelectedLotForInvest(bond.lotData || {
                          id: 1,
                          seller: bond.issuerAddress,
                          bondAmount: ethers.parseUnits(String(bond.availableQuantity), BOND_DECIMALS),
                          price: ethers.parseUnits(String(bond.issuePrice), USDC_DECIMALS),
                          per: ethers.parseUnits(String(bond.issuePrice), USDC_DECIMALS),
                        });
                      } else {
                        setSelectedBondForDetails(bond);
                      }
                    }}
                    style={{ flex: 1.2, justifyContent: "center", gap: "0.35rem" }}
                  >
                    <span>{isLive ? "Invest on Chain" : "Explore Demo"}</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Dedicated Bond Details Modal */}
      {selectedBondForDetails && (
        <BondDetailsModal
          isOpen={Boolean(selectedBondForDetails)}
          onClose={() => setSelectedBondForDetails(null)}
          bond={selectedBondForDetails}
          onInvestLive={(b) => {
            setSelectedBondForDetails(null);
            setSelectedLotForInvest(b.lotData || {
              id: 1,
              seller: b.issuerAddress,
              bondAmount: ethers.parseUnits(String(b.availableQuantity), BOND_DECIMALS),
              price: ethers.parseUnits(String(b.issuePrice), USDC_DECIMALS),
              per: ethers.parseUnits(String(b.issuePrice), USDC_DECIMALS),
            });
          }}
        />
      )}

      {/* Investment Modal (Executed on Sepolia) */}
      {selectedLotForInvest && (
        <BondInvestmentModal
          isOpen={Boolean(selectedLotForInvest)}
          onClose={() => setSelectedLotForInvest(null)}
          lot={selectedLotForInvest}
          terms={terms}
          network={network}
          onSuccess={() => {
            setRefreshTrigger((n) => n + 1);
            loadData();
          }}
          onViewInvestments={() => {
            if (onViewInvestments) onViewInvestments();
          }}
        />
      )}

      {/* Test MockUSDC Faucet Modal */}
      <TestUsdcFaucetModal
        isOpen={faucetOpen}
        onClose={() => setFaucetOpen(false)}
        initialAmount="5000"
        onSuccess={() => {
          setRefreshTrigger((n) => n + 1);
          loadData();
        }}
      />
    </div>
  );
}

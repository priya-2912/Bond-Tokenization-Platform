import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContract } from "../contracts/platform";
import {
  ShoppingCart,
  PlusCircle,
  RefreshCw,
  Tag,
  CheckCircle,
  X,
  Filter,
  DollarSign
} from "lucide-react";

export default function Marketplace({
  account,
  provider,
  signer,
  network,
  isKycVerified,
  refreshTrigger,
  setRefreshTrigger
}) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterMode, setFilterMode] = useState("all"); // 'all' or 'my'
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sellAmount, setSellAmount] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    if (provider) {
      loadOrders();
    }
  }, [provider, network, refreshTrigger]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const runner = signer || provider;
      const marketplace = getContract("Marketplace", runner, network);
      const nextId = await marketplace.nextOrderId();

      const orderList = [];
      for (let i = 1; i < Number(nextId); i++) {
        try {
          const ord = await marketplace.getOrder(i);
          orderList.push({
            id: Number(ord.id),
            seller: ord.seller,
            bondAmount: ethers.formatUnits(ord.bondAmount, 18),
            priceInUSDC: ethers.formatUnits(ord.priceInUSDC, 6),
            isActive: ord.isActive
          });
        } catch (e) {
          console.warn("Skipping order id", i, e);
        }
      }
      setOrders(orderList.reverse());
    } catch (err) {
      console.error("Error loading marketplace orders:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    if (!signer) return alert("Please connect wallet.");
    if (!isKycVerified) return alert("Your wallet is not KYC verified! Only verified investors can list orders.");

    try {
      setStatusMsg({ type: "info", text: "Step 1/2: Approving BondTokens for marketplace escrow..." });
      const bondToken = getContract("BondToken", signer, network);
      const marketplace = getContract("Marketplace", signer, network);
      const marketplaceAddress = await marketplace.getAddress();

      const parsedBond = ethers.parseUnits(sellAmount, 18);
      const parsedPrice = ethers.parseUnits(sellPrice, 6);

      const approveTx = await bondToken.approve(marketplaceAddress, parsedBond);
      await approveTx.wait();

      setStatusMsg({ type: "info", text: "Step 2/2: Confirming sell order creation..." });
      const orderTx = await marketplace.createSellOrder(parsedBond, parsedPrice);
      await orderTx.wait();

      setStatusMsg({ type: "success", text: "Sell order created and bonds placed in escrow successfully!" });
      setShowCreateModal(false);
      setSellAmount("");
      setSellPrice("");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Order creation failed: ${err.reason || err.message}` });
    }
  };

  const handleBuy = async (order) => {
    if (!signer) return alert("Please connect wallet.");
    if (!isKycVerified) return alert("Your wallet is not KYC verified! Only verified investors can trade on this platform.");

    try {
      setStatusMsg({ type: "info", text: `Step 1/2: Approving $${order.priceInUSDC} MockUSDC payment...` });
      const mockUSDC = getContract("MockUSDC", signer, network);
      const marketplace = getContract("Marketplace", signer, network);
      const marketplaceAddress = await marketplace.getAddress();

      const parsedPrice = ethers.parseUnits(order.priceInUSDC, 6);

      const approveTx = await mockUSDC.approve(marketplaceAddress, parsedPrice);
      await approveTx.wait();

      setStatusMsg({ type: "info", text: `Step 2/2: Settling purchase of Order #${order.id}...` });
      const buyTx = await marketplace.buy(order.id);
      await buyTx.wait();

      setStatusMsg({ type: "success", text: `Order #${order.id} purchased successfully! Bonds transferred to your wallet.` });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Purchase failed: ${err.reason || err.message}` });
    }
  };

  const handleCancel = async (orderId) => {
    if (!signer) return alert("Please connect wallet.");
    try {
      setStatusMsg({ type: "info", text: `Cancelling Order #${orderId} and unlocking escrowed bonds...` });
      const marketplace = getContract("Marketplace", signer, network);
      const cancelTx = await marketplace.cancelOrder(orderId);
      await cancelTx.wait();

      setStatusMsg({ type: "success", text: `Order #${orderId} cancelled and bonds returned!` });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Cancel failed: ${err.reason || err.message}` });
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (filterMode === "my") {
      return account && o.seller.toLowerCase() === account.toLowerCase();
    }
    return true;
  });

  const activeOrdersCount = orders.filter((o) => o.isActive).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Header Card */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="badge badge-blue">P2P ORDER BOOK</span>
              <span className="badge badge-emerald">{activeOrdersCount} Active Listings</span>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.35rem" }}>
              Secondary Market Order Book
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Decentralized peer-to-peer liquidity for CB28 bonds. Sellers lock bonds into smart contract escrow; buyers settle instantly in MockUSDC.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary btn-sm"
            >
              <PlusCircle size={15} />
              <span>Create Sell Order</span>
            </button>
            <button onClick={loadOrders} className="btn-icon" title="Refresh order book">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Filter controls */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem" }}>
          <button
            onClick={() => setFilterMode("all")}
            className={`btn btn-sm ${filterMode === "all" ? "btn-primary" : "btn-secondary"}`}
          >
            All Listings ({orders.length})
          </button>
          <button
            onClick={() => setFilterMode("my")}
            className={`btn btn-sm ${filterMode === "my" ? "btn-primary" : "btn-secondary"}`}
          >
            My Orders
          </button>
        </div>
      </div>

      {/* Notifications */}
      {statusMsg && (
        <div className={`alert-banner ${statusMsg.type}`}>
          <span>{statusMsg.text}</span>
          <button onClick={() => setStatusMsg(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "1rem" }}>✕</button>
        </div>
      )}

      {/* Orders Table Container */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Seller</th>
              <th>Quantity</th>
              <th>Total Price</th>
              <th>Price per Bond</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-muted)" }}>
                  {loading ? "Refreshing order book from chain..." : "No active orders found in the marketplace."}
                </td>
              </tr>
            ) : (
              filteredOrders.map((o) => {
                const isSeller = account && o.seller.toLowerCase() === account.toLowerCase();
                const unitPrice = (Number(o.priceInUSDC) / Number(o.bondAmount)).toFixed(2);
                return (
                  <tr key={o.id}>
                    <td className="font-mono" style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                      #{o.id}
                    </td>
                    <td className="font-mono" style={{ fontSize: "0.75rem" }}>
                      {o.seller.slice(0, 6)}...{o.seller.slice(-4)}
                      {isSeller && <span className="badge badge-blue" style={{ marginLeft: "0.5rem" }}>You</span>}
                    </td>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      {o.bondAmount} CB28
                    </td>
                    <td className="font-mono" style={{ fontWeight: 700, color: "var(--accent-emerald)" }}>
                      ${Number(o.priceInUSDC).toLocaleString()} MockUSDC
                    </td>
                    <td className="font-mono" style={{ color: "var(--text-secondary)" }}>
                      ${unitPrice}
                    </td>
                    <td>
                      {o.isActive ? (
                        <span className="badge badge-emerald">Open</span>
                      ) : (
                        <span className="badge" style={{ backgroundColor: "rgba(100, 116, 139, 0.2)", color: "var(--text-muted)" }}>Closed</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {o.isActive && (
                        isSeller ? (
                          <button
                            onClick={() => handleCancel(o.id)}
                            className="btn btn-rose btn-sm"
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            onClick={() => handleBuy(o)}
                            className="btn btn-emerald btn-sm"
                          >
                            Buy Order
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create Order Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Tag size={18} color="#3b82f6" />
                List Bonds for Sale
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateOrder}>
              <div className="input-group">
                <label className="input-label">Quantity to Sell (CB28)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 5"
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  className="input-field"
                />
              </div>

              <div className="input-group">
                <label className="input-label">Total Asking Price (MockUSDC)</label>
                <input
                  type="number"
                  step="1"
                  required
                  placeholder="e.g. 5000"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  className="input-field"
                />
              </div>

              {sellAmount && sellPrice && (
                <div
                  style={{
                    backgroundColor: "var(--bg-input)",
                    padding: "0.75rem",
                    borderRadius: "var(--radius-md)",
                    fontSize: "0.75rem",
                    marginBottom: "1rem",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)" }}>
                    <span>Implied Unit Price:</span>
                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      ${(Number(sellPrice) / Number(sellAmount)).toFixed(2)} USDC / Bond
                    </span>
                  </div>
                </div>
              )}

              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "1.25rem", lineHeight: 1.4 }}>
                * Bounded tokens will be securely locked into the Marketplace smart contract escrow until filled or cancelled.
              </p>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Approve & Create Listing
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

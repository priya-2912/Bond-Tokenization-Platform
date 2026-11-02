import React, { useState, useCallback } from "react";
import { getContract, getAddresses, BOND_DECIMALS, USDC_DECIMALS } from "../contracts/platform";
import { toUnits, fromUnits, fmtNumber } from "../lib/utils";
import { StatusBanner, useTxRunner } from "./ui";
import { Sparkles } from "lucide-react";

const MAX_LOTS = 10;

/** Issuer tool: list bonds you hold as fixed-size lots on the marketplace (the primary offering investors see on their Portfolio tab). */
export default function OpenOffering({ account, signer, network, roles, setRefreshTrigger }) {
  const [lotSize, setLotSize] = useState("");
  const [lots, setLots] = useState("1");
  const [perBond, setPerBond] = useState("");
  const onDone = useCallback(() => setRefreshTrigger((n) => n + 1), [setRefreshTrigger]);
  const { status, setStatus, busy, run } = useTxRunner(onDone);
  const addrs = getAddresses(network);

  const submit = (e) => {
    e.preventDefault();
    if (!signer) return setStatus({ type: "warn", text: "Connect your wallet on the selected network first." });
    if (!roles.issuer) return setStatus({ type: "error", text: "Only a wallet with the ISSUER role should open the primary offering." });
    let size, price, n;
    try {
      size = toUnits(lotSize, BOND_DECIMALS);
      price = toUnits(perBond, USDC_DECIMALS);
      n = Number(lots);
      if (size === 0n || price === 0n) throw new Error("Lot size and price must be greater than 0.");
      if (!Number.isInteger(n) || n < 1 || n > MAX_LOTS) throw new Error(`Number of lots must be a whole number from 1 to ${MAX_LOTS}.`);
    } catch (err) {
      return setStatus({ type: "error", text: err.message });
    }
    const total = size * BigInt(n);
    const lotPrice = (price * size) / 10n ** BigInt(BOND_DECIMALS);
    run("Preparing offering...", async (setMsg) => {
      const bond = getContract("BondToken", signer, network);
      const market = getContract("Marketplace", signer, network);
      const kyc = getContract("KYCRegistry", signer, network);
      if (!(await kyc.isVerified(addrs.Marketplace))) throw new Error("The Marketplace contract is not KYC-whitelisted. Use Setup checks above first.");
      if ((await bond.balanceOf(account)) < total) throw new Error("You do not hold enough bonds. Mint or receive bonds first.");
      if ((await bond.allowance(account, addrs.Marketplace)) < total) {
        setMsg({ type: "info", text: "Approving the Marketplace to escrow the offering (confirm in wallet)..." });
        await (await bond.approve(addrs.Marketplace, total)).wait();
      }
      let last;
      for (let i = 0; i < n; i++) {
        setMsg({ type: "info", text: `Listing lot ${i + 1} of ${n} (confirm in wallet)...` });
        last = await market.createSellOrder(size, lotPrice);
        if (i < n - 1) await last.wait();
      }
      return last;
    }, `${n} lot(s) of ${lotSize} bonds listed at $${fmtNumber(perBond)} each.`).then((ok) => ok && (setLotSize(""), setPerBond("")));
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title"><Sparkles size={18} color="#f59e0b" /> Open primary offering</h3>
          <p className="card-subtitle">List bonds you hold as lots. Investors buy them under "Invest" on their Portfolio tab.</p>
        </div>
      </div>
      <StatusBanner status={status} onClose={() => setStatus(null)} network={network} />
      <form onSubmit={submit}>
        <div className="grid-2">
          <div className="input-group">
            <label className="input-label" htmlFor="lotSize">Bonds per lot</label>
            <input id="lotSize" className="input-field" inputMode="decimal" value={lotSize} onChange={(e) => setLotSize(e.target.value.trim())} placeholder="e.g. 10" />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="lotCount">Number of lots (max {MAX_LOTS})</label>
            <input id="lotCount" className="input-field" inputMode="numeric" value={lots} onChange={(e) => setLots(e.target.value.trim())} />
          </div>
        </div>
        <div className="input-group" style={{ marginTop: "0.75rem" }}>
          <label className="input-label" htmlFor="lotPrice">Price per bond (MockUSDC)</label>
          <input id="lotPrice" className="input-field" inputMode="decimal" value={perBond} onChange={(e) => setPerBond(e.target.value.trim())} placeholder="e.g. 1000 (face value)" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || !lotSize || !perBond} style={{ width: "100%", marginTop: "0.75rem" }}>List offering</button>
      </form>
    </div>
  );
}

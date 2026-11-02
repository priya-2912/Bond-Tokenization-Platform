// Polls the chain for platform events and stores them in SQLite for history views.
const db = require("./db");
const { provider, deployment, contract } = require("./chain");

// Which events to index from which contract. Events missing from an ABI are skipped.
const WATCH = [
  { contract: "BondToken", events: ["Transfer", "ForceTransferExecuted"] },
  { contract: "KYCRegistry", events: ["AddressWhitelisted", "AddressRemovedFromWhitelist"] },
  { contract: "Marketplace", events: ["OrderCreated", "OrderFilled", "OrderCancelled"] },
  { contract: "CouponDistributor", events: ["CouponFundsDeposited", "SnapshotRecorded", "CouponClaimed", "BondRedeemed"] },
  { contract: "ReserveGuard", events: ["ReserveAlert", "ReserveRestored"] },
  { contract: "ReserveOracle", events: ["AnswerUpdated"] },
];

const RANGE = Number(process.env.INDEXER_BLOCK_RANGE || 500);
const POLL_MS = Number(process.env.INDEXER_POLL_MS || 8000);

function plainArgs(log) {
  const out = {};
  log.fragment.inputs.forEach((input, i) => {
    const v = log.args[i];
    out[input.name || `arg${i}`] = typeof v === "bigint" ? v.toString() : v;
  });
  return out;
}

async function poll() {
  const latest = await provider.getBlockNumber();
  const last = db.getState("lastBlock");
  let from = last !== null ? Number(last) + 1 : Number(deployment().deployBlock);

  while (from <= latest) {
    const to = Math.min(from + RANGE - 1, latest);
    for (const w of WATCH) {
      let c;
      try {
        c = contract(w.contract);
      } catch {
        continue; // not deployed / no ABI yet
      }
      for (const eventName of w.events) {
        if (!c.interface.getEvent(eventName)) continue;
        const logs = await c.queryFilter(eventName, from, to);
        for (const log of logs) {
          db.insertEvent({
            contract: w.contract,
            type: eventName,
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            logIndex: log.index,
            args: plainArgs(log),
          });
        }
      }
    }
    db.setState("lastBlock", to);
    from = to + 1;
  }
}

function start() {
  const state = { running: false };
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await poll();
    } catch (e) {
      console.error("[indexer] Full error:");
      console.dir(e, { depth: 6 });
    } finally {
      state.running = false;
    }
  };
  tick();
  return setInterval(tick, POLL_MS);
}

module.exports = { start };

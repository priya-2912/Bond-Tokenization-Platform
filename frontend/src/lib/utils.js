// Pure helpers (no ethers / React imports) so they can be unit-tested with plain Node.

export function shortAddr(a) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "";
}

export function isAddressLike(a) {
  return /^0x[0-9a-fA-F]{40}$/.test((a || "").trim());
}

/** Strict decimal string -> BigInt units. Rejects "", "-1", "1e3", "1.2.3" and too many decimals. */
export function toUnits(value, decimals) {
  const s = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error("Enter a plain positive number (digits and one decimal point).");
  }
  const [i, f = ""] = s.split(".");
  if (f.length > decimals) throw new Error(`At most ${decimals} decimal places are allowed.`);
  return BigInt(i + f.padEnd(decimals, "0"));
}

/** BigInt units -> exact decimal string. Safely handles BigInt, string, or number. */
export function fromUnits(raw, decimals) {
  if (raw === null || raw === undefined || raw === "") return "0";
  let b;
  try {
    b = typeof raw === "bigint" ? raw : BigInt(String(raw).split(".")[0] || 0);
  } catch {
    return "0";
  }
  const neg = b < 0n;
  const v = neg ? -b : b;
  const base = 10n ** BigInt(decimals);
  const whole = (v / base).toString();
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
}

export function fmtNumber(value, maxFrac = 2, minFrac = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US", { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
}

export function timeAgo(date) {
  if (!date) return "never";
  const s = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function countdown(targetDate) {
  if (!targetDate) return "";
  const ms = targetDate.getTime() - Date.now();
  if (ms <= 0) return "matured";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Parses lines of "address amount" (comma, space or semicolon separated). '#' starts a comment line. */
export function parseSnapshotLines(text, decimals = 18) {
  const rows = [];
  const errors = [];
  const seen = new Set();
  String(text || "").split(/\r?\n/).forEach((line, idx) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const parts = t.split(/[\s,;]+/).filter(Boolean);
    if (parts.length !== 2) {
      errors.push(`Line ${idx + 1}: expected "address amount".`);
      return;
    }
    const [addr, amt] = parts;
    if (!isAddressLike(addr)) {
      errors.push(`Line ${idx + 1}: "${addr.slice(0, 12)}..." is not a valid address.`);
      return;
    }
    let raw;
    try {
      raw = toUnits(amt, decimals);
    } catch (e) {
      errors.push(`Line ${idx + 1}: ${e.message}`);
      return;
    }
    if (raw === 0n) {
      errors.push(`Line ${idx + 1}: amount must be greater than 0.`);
      return;
    }
    const key = addr.toLowerCase();
    if (seen.has(key)) {
      errors.push(`Line ${idx + 1}: duplicate address.`);
      return;
    }
    seen.add(key);
    rows.push({ address: addr, balance: raw });
  });
  return { rows, errors };
}

const KNOWN_ERRORS = [
  [/receiver not KYC verified/i, "The receiving wallet or contract is not KYC-whitelisted."],
  [/sender not KYC verified/i, "The sending wallet is not KYC-whitelisted."],
  [/seller no longer KYC/i, "The seller is no longer KYC-verified, so this order cannot be filled."],
  [/(buyer|seller|caller) not KYC verified/i, "A wallet in this action is not KYC-whitelisted."],
  [/reserve ratio below 100%/i, "Minting blocked: reserves are below 100% of the bond supply."],
  [/EnforcedPause|Pausable: paused/i, "Transfers are currently paused by the issuer."],
  [/AccessControlUnauthorizedAccount/i, "This wallet does not hold the role required for that action."],
  [/insufficient (payout|redemption) funds/i, "The coupon contract does not hold enough MockUSDC. The issuer must deposit funds first."],
  [/has not matured/i, "The bond has not matured yet."],
  [/already claimed/i, "This coupon period was already claimed by this wallet."],
  [/no coupon balance in snapshot/i, "This wallet is not in the snapshot for that period."],
  [/ERC20InsufficientAllowance/i, "Token allowance is too low. Approve the amount first."],
  [/ERC20InsufficientBalance/i, "Insufficient token balance."],
  [/order not active/i, "That order is no longer active."],
  [/caller not seller/i, "Only the seller can cancel this order."],
];

export function friendlyError(err) {
  if (!err) return "Unknown error.";
  if (err.code === "ACTION_REJECTED" || err.code === 4001 || /user rejected/i.test(err.message || "")) {
    return "Transaction was rejected in your wallet.";
  }
  const hay = [
    err.reason,
    err.revert && err.revert.name,
    err.revert && err.revert.args && err.revert.args[0],
    err.shortMessage,
    err.info && err.info.error && err.info.error.message,
    err.error && err.error.message,
    err.message,
  ]
    .filter((x) => typeof x === "string" && x)
    .join(" | ");
  for (const [re, msg] of KNOWN_ERRORS) if (re.test(hay)) return msg;
  const first = (err.reason || err.shortMessage || err.message || String(err)).toString();
  return first.length > 220 ? first.slice(0, 217) + "..." : first;
}

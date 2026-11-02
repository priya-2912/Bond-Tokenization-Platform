import { ethers } from "ethers";
import { chunk } from "../lib/utils";

import addressesData from "../../../shared/addresses.json";
import configData from "../../../shared/config.json";

import BondTokenAbi from "../../../shared/abis/BondToken.json";
import KYCRegistryAbi from "../../../shared/abis/KYCRegistry.json";
import MockUSDCAbi from "../../../shared/abis/MockUSDC.json";
import MarketplaceAbi from "../../../shared/abis/Marketplace.json";
import CouponDistributorAbi from "../../../shared/abis/CouponDistributor.json";
import ReserveGuardAbi from "../../../shared/abis/ReserveGuard.json";
import ReserveOracleAbi from "../../../shared/abis/ReserveOracle.json";
import YieldOracleAbi from "../../../shared/abis/YieldOracle.json";
import ChainlinkPriceReaderAbi from "../../../shared/abis/ChainlinkPriceReader.json";

export const ABIS = {
  BondToken: BondTokenAbi,
  KYCRegistry: KYCRegistryAbi,
  MockUSDC: MockUSDCAbi,
  Marketplace: MarketplaceAbi,
  CouponDistributor: CouponDistributorAbi,
  ReserveGuard: ReserveGuardAbi,
  ReserveOracle: ReserveOracleAbi,
  YieldOracle: YieldOracleAbi,
  ChainlinkPriceReader: ChainlinkPriceReaderAbi,
};

export const CONFIG = configData;
export const ADDRESSES = addressesData;

// BondToken uses the default 18 decimals; MockUSDC uses 6 (matches Part 1).
export const BOND_DECIMALS = 18;
export const USDC_DECIMALS = 6;

const env = (import.meta && import.meta.env) || {};

export const NETWORKS = {
  localhost: {
    key: "localhost",
    label: "Localhost (8545)",
    chainId: 31337,
    chainIdHex: "0x7a69",
    rpcUrl: env.VITE_LOCAL_RPC_URL || "http://127.0.0.1:8545",
    explorer: null,
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    logChunk: 50000,
  },
  sepolia: {
    key: "sepolia",
    label: "Sepolia Testnet",
    chainId: 11155111,
    chainIdHex: "0xaa36a7",
    rpcUrl: env.VITE_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
    currency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    logChunk: 5000,
  },
};

/** Strict lookup: never falls back to another network's addresses. */
export function getAddresses(network = "localhost") {
  return ADDRESSES[network] || {};
}

export function isDeployed(network) {
  const a = getAddresses(network);
  return Boolean(a.BondToken && a.KYCRegistry && a.MockUSDC && a.Marketplace && a.CouponDistributor && a.ReserveGuard && a.ReserveOracle);
}

const providerCache = {};
/** Read-only provider that always talks to the selected network, whatever chain the wallet is on. */
export function getReadProvider(network) {
  if (!providerCache[network]) {
    const n = NETWORKS[network];
    providerCache[network] = new ethers.JsonRpcProvider(n.rpcUrl, n.chainId, {
      staticNetwork: ethers.Network.from(n.chainId),
    });
  }
  return providerCache[network];
}

export function getContract(name, runner, network = "localhost") {
  const address = getAddresses(network)[name];
  const abi = ABIS[name];
  if (!address || !abi) throw new Error(`Contract ${name} is not configured for ${network}.`);
  return new ethers.Contract(address, abi, runner);
}

export async function switchWalletNetwork(key) {
  const n = NETWORKS[key];
  if (!window.ethereum) throw new Error("No wallet detected.");
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: n.chainIdHex }] });
  } catch (err) {
    const code = err && (err.code || (err.data && err.data.originalError && err.data.originalError.code));
    if (code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: n.chainIdHex,
            chainName: n.label,
            nativeCurrency: n.currency,
            rpcUrls: [n.rpcUrl],
            ...(n.explorer ? { blockExplorerUrls: [n.explorer] } : {}),
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

/** True when the deployed ABI has this function (the contracts have several versions in the wild). */
export function hasFn(contract, name) {
  try {
    return contract.interface.hasFunction(name);
  } catch {
    return false;
  }
}

export function txUrl(network, hash) {
  const n = NETWORKS[network];
  return n && n.explorer && hash ? `${n.explorer}/tx/${hash}` : null;
}

export function addressUrl(network, address) {
  const n = NETWORKS[network];
  return n && n.explorer && address ? `${n.explorer}/address/${address}` : null;
}

/** Reads the bond terms from the contract (no hardcoded face value or coupon). */
export async function loadTerms(provider, network) {
  const bond = getContract("BondToken", provider, network);
  const [name, symbol, faceValue, couponRateBps, maturity] = await Promise.all([
    bond.name(),
    bond.symbol(),
    bond.faceValue(),
    bond.couponRateBps(),
    bond.maturityDate(),
  ]);
  return { name, symbol, faceValue, couponRateBps: Number(couponRateBps), maturity: new Date(Number(maturity) * 1000) };
}

/**
 * Loads the most recent orders. Uses the contract's bulk getOrders(1, total) when it exists
 * (newer deployments), otherwise reads orders one by one in parallel batches.
 */
export async function fetchOrders(marketplace, max = 200) {
  const next = Number(await marketplace.nextOrderId());
  const last = next - 1;
  const first = Math.max(1, last - max + 1);
  const norm = (o) => ({ id: Number(o.id), seller: o.seller, bondAmount: o.bondAmount, price: o.priceInUSDC, isActive: o.isActive });
  if (last >= 1 && first === 1 && hasFn(marketplace, "getOrders")) {
    try {
      const bulk = await marketplace.getOrders(1, last);
      return { orders: bulk.map(norm).reverse(), total: last, truncated: false };
    } catch (e) {
      console.warn("getOrders failed, falling back to per-order reads:", e.message);
    }
  }
  const ids = [];
  for (let i = first; i <= last; i++) ids.push(i);
  const out = [];
  for (const group of chunk(ids, 20)) {
    const res = await Promise.all(group.map((id) => marketplace.getOrder(id).then(norm).catch(() => null)));
    out.push(...res.filter(Boolean));
  }
  return { orders: out.reverse(), total: last, truncated: first > 1 };
}

/** Finds every address that holds bonds, using Transfer logs for discovery and balanceOf for the real balance. */
export async function fetchHolders(bond, provider, network, fromBlock) {
  const depBlock = Number(ADDRESSES[network]?.deployBlock) || 0;
  const latest = await provider.getBlockNumber();
  const startBlock = fromBlock !== undefined && fromBlock > 0 ? fromBlock : depBlock > 0 ? depBlock : Math.max(0, latest - 50000);
  const size = NETWORKS[network].logChunk || 5000;
  const addrs = new Set();

  // Always check known active platform accounts
  const knownAccounts = [
    "0xc992ddeb354F51EDc472c7FB9D84Db200FaAf5DA",
    "0xE3a9419109499d6A67507F67D04ce97075f6E78C",
  ];
  knownAccounts.forEach((a) => addrs.add(ethers.getAddress(a)));

  let calls = 0;
  for (let start = startBlock; start <= latest; start += size) {
    if (++calls > 100) break; // protect against runaway loops
    const end = Math.min(start + size - 1, latest);
    try {
      const logs = await bond.queryFilter(bond.filters.Transfer(), start, end);
      logs.forEach((l) => {
        if (l.args[0] && l.args[0] !== ethers.ZeroAddress) addrs.add(ethers.getAddress(l.args[0]));
        if (l.args[1] && l.args[1] !== ethers.ZeroAddress) addrs.add(ethers.getAddress(l.args[1]));
      });
    } catch (e) {
      console.warn(`Transfer filter chunk failed (${start}-${end}):`, e.message);
      break;
    }
  }

  addrs.delete(ethers.ZeroAddress);
  const list = [...addrs];
  const out = [];
  for (const group of chunk(list, 25)) {
    const bals = await Promise.all(group.map((a) => bond.balanceOf(a).catch(() => 0n)));
    group.forEach((a, i) => {
      if (bals[i] > 0n) out.push({ address: a, balance: bals[i] });
    });
  }
  return out;
}

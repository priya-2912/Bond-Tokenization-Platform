import { ethers } from "ethers";

// Import shared JSONs directly
import addressesData from "../../../shared/addresses.json";
import configData from "../../../shared/config.json";

// Import ABIs
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

export function getAddresses(network = "localhost") {
  return ADDRESSES[network] || ADDRESSES.localhost || {};
}

export function getContract(name, runner, network = "localhost") {
  const addrs = getAddresses(network);
  const address = addrs[name];
  const abi = ABIS[name];
  if (!address || !abi) {
    throw new Error(`Contract ${name} not configured for network ${network}`);
  }
  return new ethers.Contract(address, abi, runner);
}

export async function getBrowserProvider() {
  if (typeof window !== "undefined" && window.ethereum) {
    return new ethers.BrowserProvider(window.ethereum);
  }
  return null;
}


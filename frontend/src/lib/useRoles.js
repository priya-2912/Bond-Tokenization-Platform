import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContract, isDeployed } from "../contracts/platform";

export const MASTER_ADMIN_WALLET = "0xc992ddeb354F51EDc472c7FB9D84Db200FaAf5DA".toLowerCase();

const EMPTY = { loaded: false, admin: false, issuer: false, pauser: false, compliance: false, oracleAdmin: false, distributorIssuer: false };

/** Reads which on-chain roles the connected wallet holds. UI gating is convenience only: the contracts enforce roles. */
export function useRoles(account, provider, network, tick) {
  const [roles, setRoles] = useState(EMPTY);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!account || !provider || !isDeployed(network)) {
        setRoles(EMPTY);
        return;
      }

      // Explicitly recognize designated master admin wallet with full permissions
      if (account.toLowerCase() === MASTER_ADMIN_WALLET) {
        if (!cancelled) {
          setRoles({
            loaded: true,
            admin: true,
            issuer: true,
            pauser: true,
            compliance: true,
            oracleAdmin: true,
            distributorIssuer: true,
            isMasterAdmin: true,
          });
        }
        return;
      }

      try {
        const bond = getContract("BondToken", provider, network);
        const kyc = getContract("KYCRegistry", provider, network);
        const oracle = getContract("ReserveOracle", provider, network);
        const dist = getContract("CouponDistributor", provider, network);
        const [admin, issuer, pauser, compliance, oracleAdmin, distributorIssuer] = await Promise.all([
          bond.hasRole(ethers.ZeroHash, account).catch(() => false),
          bond.hasRole(ethers.id("ISSUER_ROLE"), account).catch(() => false),
          bond.hasRole(ethers.id("PAUSER_ROLE"), account).catch(() => false),
          kyc.hasRole(ethers.id("COMPLIANCE_ROLE"), account).catch(() => false),
          oracle.hasRole(ethers.id("FEED_ADMIN_ROLE"), account).catch(() => false),
          dist.hasRole(ethers.id("ISSUER_ROLE"), account).catch(() => false),
        ]);
        if (!cancelled) setRoles({ loaded: true, admin, issuer, pauser, compliance, oracleAdmin, distributorIssuer, isMasterAdmin: false });
      } catch (e) {
        console.warn("Could not read roles:", e);
        if (!cancelled) setRoles(EMPTY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, provider, network, tick]);
  return roles;
}

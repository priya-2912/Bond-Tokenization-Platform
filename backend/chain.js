// Loads addresses and ABIs from /shared so the backend never hardcodes them.
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const SHARED = path.join(__dirname, "..", "shared");
const NETWORK = process.env.NETWORK || "sepolia";
const MASTER_ADMIN_WALLET = "0xc992ddeb354F51EDc472c7FB9D84Db200FaAf5DA".toLowerCase();

const rpcUrl = process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const provider = new ethers.JsonRpcProvider(rpcUrl, NETWORK === "sepolia" ? 11155111 : undefined, {
  staticNetwork: NETWORK === "sepolia" ? ethers.Network.from(11155111) : undefined,
});

function deployment() {
  const all = JSON.parse(fs.readFileSync(path.join(SHARED, "addresses.json"), "utf8"));
  const d = all[NETWORK];
  if (!d) throw new Error(`No deployment for network "${NETWORK}" in shared/addresses.json`);
  return d;
}

function abi(name) {
  return JSON.parse(fs.readFileSync(path.join(SHARED, "abis", `${name}.json`), "utf8"));
}

function contract(name, runner = provider) {
  const address = deployment()[name];
  if (!address) throw new Error(`No address for ${name} on ${NETWORK}`);
  return new ethers.Contract(address, abi(name), runner);
}

function complianceSigner() {
  let key = process.env.COMPLIANCE_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!key) throw new Error("COMPLIANCE_PRIVATE_KEY or PRIVATE_KEY is not set in backend .env");
  if (key.startsWith("0x") && key.length === 42) {
    key = process.env.PRIVATE_KEY;
  }
  if (!key) throw new Error("Valid 32-byte private key required for compliance signer");
  return new ethers.Wallet(key, provider);
}

async function checkOnChainRoles(walletAddress) {
  if (!walletAddress) return { isKyc: false, isCompliance: false, isAdmin: false, isIssuer: false, isPauser: false, hasInstitutionalRole: false };

  // Explicitly recognize designated master admin wallet with all privileges
  if (walletAddress.toLowerCase() === MASTER_ADMIN_WALLET) {
    return {
      isKyc: true,
      isCompliance: true,
      isAdmin: true,
      isIssuer: true,
      isPauser: true,
      hasInstitutionalRole: true,
      isSuperAdmin: true,
    };
  }

  try {
    const kyc = contract("KYCRegistry");
    const bond = contract("BondToken");
    const [isKyc, isCompliance, isAdmin, isIssuer, isPauser] = await Promise.all([
      kyc.isVerified(walletAddress).catch(() => false),
      kyc.hasRole(ethers.id("COMPLIANCE_ROLE"), walletAddress).catch(() => false),
      bond.hasRole(ethers.ZeroHash, walletAddress).catch(() => false),
      bond.hasRole(ethers.id("ISSUER_ROLE"), walletAddress).catch(() => false),
      bond.hasRole(ethers.id("PAUSER_ROLE"), walletAddress).catch(() => false),
    ]);
    return {
      isKyc: Boolean(isKyc),
      isCompliance: Boolean(isCompliance),
      isAdmin: Boolean(isAdmin),
      isIssuer: Boolean(isIssuer),
      isPauser: Boolean(isPauser),
      hasInstitutionalRole: Boolean(isCompliance || isAdmin || isIssuer || isPauser),
      isSuperAdmin: Boolean(isAdmin),
    };
  } catch (e) {
    console.warn("Could not check on-chain roles:", e.message);
    return {
      isKyc: false,
      isCompliance: false,
      isAdmin: false,
      isIssuer: false,
      isPauser: false,
      hasInstitutionalRole: false,
      isSuperAdmin: false,
    };
  }
}

module.exports = { provider, deployment, abi, contract, complianceSigner, checkOnChainRoles, MASTER_ADMIN_WALLET, NETWORK };

// Loads addresses and ABIs from /shared so the backend never hardcodes them.
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const SHARED = path.join(__dirname, "..", "shared");
const NETWORK = process.env.NETWORK || "sepolia";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

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
  if (!process.env.COMPLIANCE_PRIVATE_KEY) throw new Error("COMPLIANCE_PRIVATE_KEY is not set");
  return new ethers.Wallet(process.env.COMPLIANCE_PRIVATE_KEY, provider);
}

module.exports = { provider, deployment, abi, contract, complianceSigner, NETWORK };

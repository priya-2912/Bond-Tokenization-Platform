const fs = require("fs");
const path = require("path");

const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts", "contracts");
const SHARED_ABIS_DIR = path.join(__dirname, "..", "shared", "abis");

if (!fs.existsSync(SHARED_ABIS_DIR)) {
  fs.mkdirSync(SHARED_ABIS_DIR, { recursive: true });
}

const contractMap = {
  "BondToken": "BondToken.sol/BondToken.json",
  "KYCRegistry": "KYCRegistry.sol/KYCRegistry.json",
  "MockUSDC": "MockUSDC.sol/MockUSDC.json",
  "Marketplace": "Marketplace.sol/Marketplace.json",
  "CouponDistributor": "CouponDistributor.sol/CouponDistributor.json",
  "ReserveGuard": "ReserveGuard.sol/ReserveGuard.json",
  "ChainlinkPriceReader": "ChainlinkPriceReader.sol/ChainlinkPriceReader.json",
  "ReserveOracle": "oracles/ReserveOracle.sol/ReserveOracle.json",
  "YieldOracle": "oracles/YieldOracle.sol/YieldOracle.json",
  "MockPriceFeed": "oracles/MockPriceFeed.sol/MockPriceFeed.json"
};

for (const [name, relPath] of Object.entries(contractMap)) {
  const fullPath = path.join(ARTIFACTS_DIR, relPath);
  if (fs.existsSync(fullPath)) {
    const artifact = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const abiDest = path.join(SHARED_ABIS_DIR, `${name}.json`);
    fs.writeFileSync(abiDest, JSON.stringify(artifact.abi, null, 2), "utf8");
    console.log(`Synced ABI for ${name} -> ${abiDest}`);
  } else {
    console.warn(`Artifact not found: ${fullPath}`);
  }
}


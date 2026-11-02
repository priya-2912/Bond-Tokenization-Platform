const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const networkName = hre.network.name;
  if (networkName !== "sepolia") {
    console.log(`Verification is meant for Sepolia testnet. Current network: ${networkName}`);
    return;
  }

  const addressesPath = path.join(__dirname, "..", "shared", "addresses.json");
  const configPath = path.join(__dirname, "..", "shared", "config.json");

  if (!fs.existsSync(addressesPath) || !fs.existsSync(configPath)) {
    throw new Error("Missing shared/addresses.json or shared/config.json");
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8")).sepolia;
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const [deployer] = await hre.ethers.getSigners();

  if (!addresses || !addresses.BondToken) {
    throw new Error("No Sepolia deployment found in shared/addresses.json");
  }

  console.log("Starting Etherscan contract verification on Sepolia...");

  const verifyContract = async (name, address, constructorArguments) => {
    console.log(`\nVerifying ${name} at ${address}...`);
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments,
      });
      console.log(`Verified ${name}!`);
    } catch (err) {
      if (err.message.includes("Already Verified")) {
        console.log(`${name} is already verified.`);
      } else {
        console.error(`Failed to verify ${name}:`, err.message);
      }
    }
  };

  // KYCRegistry: (admin, compliance)
  await verifyContract("KYCRegistry", addresses.KYCRegistry, [deployer.address, deployer.address]);

  // MockUSDC: ()
  await verifyContract("MockUSDC", addresses.MockUSDC, []);

  // BondToken: (name, symbol, faceValue, couponRateBps, maturityDate, admin, issuer, compliance, kycRegistry)
  // Note: maturityDate was computed at deploy time from timestamp
  const bondToken = await hre.ethers.getContractAt("BondToken", addresses.BondToken);
  const maturityDate = await bondToken.maturityDate();
  await verifyContract("BondToken", addresses.BondToken, [
    config.bond.name,
    config.bond.symbol,
    BigInt(config.bond.faceValue),
    BigInt(config.bond.couponRateBps),
    maturityDate,
    deployer.address,
    deployer.address,
    deployer.address,
    addresses.KYCRegistry
  ]);

  // ReserveOracle: (feedDecimals, initialReserve, admin)
  await verifyContract("ReserveOracle", addresses.ReserveOracle, [
    config.oracles.reserveDecimals,
    BigInt(config.oracles.initialReserves),
    deployer.address
  ]);

  // YieldOracle: (feedDecimals, initialYield, admin)
  await verifyContract("YieldOracle", addresses.YieldOracle, [
    config.oracles.yieldDecimals,
    BigInt(config.oracles.initialYield),
    deployer.address
  ]);

  // ReserveGuard: (bond, feed, admin, minRatioBps, maxStaleness)
  await verifyContract("ReserveGuard", addresses.ReserveGuard, [
    addresses.BondToken,
    addresses.ReserveOracle,
    deployer.address,
    config.guard.minRatioBps,
    config.guard.maxStaleness
  ]);

  // Marketplace: (bondToken, usdcToken, kycRegistry)
  await verifyContract("Marketplace", addresses.Marketplace, [
    addresses.BondToken,
    addresses.MockUSDC,
    addresses.KYCRegistry
  ]);

  // CouponDistributor: (bondToken, usdcToken, kycRegistry, admin, issuer)
  await verifyContract("CouponDistributor", addresses.CouponDistributor, [
    addresses.BondToken,
    addresses.MockUSDC,
    addresses.KYCRegistry,
    deployer.address,
    deployer.address
  ]);

  // ChainlinkPriceReader: (feed)
  await verifyContract("ChainlinkPriceReader", addresses.ChainlinkPriceReader, [
    addresses.PriceFeed
  ]);

  console.log("\nAll contracts processed for verification.");
}

main().catch((error) => {
  console.error("Verification script failed:", error);
  process.exitCode = 1;
});


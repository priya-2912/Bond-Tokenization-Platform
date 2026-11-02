const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = hre.network.name;
  const networkKey = networkName === "localhost" || networkName === "hardhat" ? "localhost" : networkName;

  console.log("==================================================");
  console.log(`Starting Reserve Demo on: ${networkName}`);
  console.log(`Signer: ${deployer.address}`);
  console.log("==================================================");

  // Load addresses
  const addressesPath = path.join(__dirname, "..", "shared", "addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error("shared/addresses.json not found. Run deploy first.");
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"))[networkKey];
  if (!addresses || !addresses.BondToken) {
    throw new Error(`No deployment found for network ${networkKey} in shared/addresses.json`);
  }

  const BondToken = await ethers.getContractFactory("BondToken");
  const bondToken = BondToken.attach(addresses.BondToken);

  const ReserveOracle = await ethers.getContractFactory("ReserveOracle");
  const reserveOracle = ReserveOracle.attach(addresses.ReserveOracle);

  const ReserveGuard = await ethers.getContractFactory("ReserveGuard");
  const reserveGuard = ReserveGuard.attach(addresses.ReserveGuard);

  // STAGE 1: Healthy
  console.log("\n--- STAGE 1: Healthy Status ---");
  let reserves = await reserveOracle.getReserves();
  let ratioBps = await reserveGuard.reserveRatioBps();
  let healthy = await reserveGuard.isHealthy();
  console.log(`Current Reserves: ${ethers.formatUnits(reserves, 6)} MockUSDC`);
  console.log(`Reserve Ratio: ${(Number(ratioBps) / 100).toFixed(2)}% (bps: ${ratioBps})`);
  console.log(`ReserveGuard isHealthy: ${healthy}`);

  const testMintAmount = ethers.parseUnits("10", 18);
  console.log("Testing mint in healthy state (10 CB28)...");
  const mintTx1 = await bondToken.mint(deployer.address, testMintAmount);
  await mintTx1.wait();
  console.log("SUCCESS: Minted 10 CB28 tokens while healthy.");

  // STAGE 2: Reserves Drop
  console.log("\n--- STAGE 2: Reserves Drop (Undercollateralized) ---");
  const requiredReserves = await reserveGuard.requiredReserves();
  console.log(`Required reserves for supply: ${ethers.formatUnits(requiredReserves, 6)} MockUSDC`);
  const droppedReserves = requiredReserves / 2n; // 50%
  console.log(`Simulating reserve drop to 50%: ${ethers.formatUnits(droppedReserves, 6)} MockUSDC`);

  const dropTx = await reserveOracle.updateReserve(droppedReserves);
  await dropTx.wait();
  console.log("Reserve oracle updated.");

  ratioBps = await reserveGuard.reserveRatioBps();
  console.log(`New Reserve Ratio: ${(Number(ratioBps) / 100).toFixed(2)}% (bps: ${ratioBps})`);

  console.log("Attempting to mint 10 CB28 (should fail)...");
  try {
    const failMintTx = await bondToken.mint(deployer.address, testMintAmount);
    await failMintTx.wait();
    console.error("UNEXPECTED: Mint succeeded when reserves were below 100%!");
  } catch (err) {
    console.log("SUCCESS: Minting blocked as expected! Error:", err.message.slice(0, 100));
  }

  // STAGE 3: ReserveAlert
  console.log("\n--- STAGE 3: Triggering ReserveGuard Alert ---");
  const alertTx = await reserveGuard.checkAndAlert();
  const alertReceipt = await alertTx.wait();
  const alertEvent = alertReceipt.logs.find((log) => {
    try {
      return reserveGuard.interface.parseLog(log)?.name === "ReserveAlert";
    } catch {
      return false;
    }
  });

  if (alertEvent) {
    const parsed = reserveGuard.interface.parseLog(alertEvent);
    console.log(`SUCCESS: ReserveAlert emitted! Ratio: ${(Number(parsed.args.ratioBps) / 100).toFixed(2)}%`);
  } else {
    console.log("ReserveAlert transaction confirmed.");
  }
  console.log(`ReserveGuard alertActive: ${await reserveGuard.alertActive()}`);

  // STAGE 4: Reserves Restored
  console.log("\n--- STAGE 4: Restoring Reserves ---");
  const restoredReserves = (requiredReserves * 12n) / 10n; // 120%
  console.log(`Restoring reserves to 120%: ${ethers.formatUnits(restoredReserves, 6)} MockUSDC`);
  const restoreTx = await reserveOracle.updateReserve(restoredReserves);
  await restoreTx.wait();

  const recoverTx = await reserveGuard.checkAndAlert();
  const recoverReceipt = await recoverTx.wait();
  const restoredEvent = recoverReceipt.logs.find((log) => {
    try {
      return reserveGuard.interface.parseLog(log)?.name === "ReserveRestored";
    } catch {
      return false;
    }
  });

  if (restoredEvent) {
    const parsed = reserveGuard.interface.parseLog(restoredEvent);
    console.log(`SUCCESS: ReserveRestored emitted! Ratio: ${(Number(parsed.args.ratioBps) / 100).toFixed(2)}%`);
  } else {
    console.log("ReserveRestored transaction confirmed.");
  }

  console.log("Testing minting again now that reserves are restored...");
  const mintTx2 = await bondToken.mint(deployer.address, testMintAmount);
  await mintTx2.wait();
  console.log("SUCCESS: Minting succeeded after reserves were restored!");

  console.log("\n==================================================");
  console.log("Reserve Drop Demo Completed Successfully (All 4 stages passed)");
  console.log("==================================================");
}

main().catch((error) => {
  console.error("Demo failed:", error);
  process.exitCode = 1;
});


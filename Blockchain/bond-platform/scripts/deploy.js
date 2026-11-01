const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = hre.network.name;

  console.log("==================================================");
  console.log(`Starting Deployment on network: ${networkName}`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);
  console.log("==================================================");

  if (balance === 0n && networkName === "sepolia") {
    throw new Error("Deployer has no Sepolia ETH. Fund wallet from a faucet before deploying.");
  }

  // Load config
  const configPath = path.join(__dirname, "..", "shared", "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  const latestBlock = await ethers.provider.getBlock("latest");
  const currentTimestamp = latestBlock ? latestBlock.timestamp : Math.floor(Date.now() / 1000);
  const maturityDate = currentTimestamp + (config.bond.maturityMonths || 12) * 30 * 86400;

  // 1. Deploy KYCRegistry
  console.log("Deploying KYCRegistry...");
  const KYCRegistry = await ethers.getContractFactory("KYCRegistry");
  const kycRegistry = await KYCRegistry.deploy(deployer.address, deployer.address);
  await kycRegistry.waitForDeployment();
  const kycRegistryAddress = await kycRegistry.getAddress();
  console.log(`KYCRegistry deployed to: ${kycRegistryAddress}`);

  // 2. Deploy MockUSDC
  console.log("Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  const mockUSDCAddress = await mockUSDC.getAddress();
  console.log(`MockUSDC deployed to: ${mockUSDCAddress}`);

  // 3. Deploy BondToken
  console.log("Deploying BondToken...");
  const BondToken = await ethers.getContractFactory("BondToken");
  const bondToken = await BondToken.deploy(
    config.bond.name,
    config.bond.symbol,
    BigInt(config.bond.faceValue),
    BigInt(config.bond.couponRateBps),
    maturityDate,
    deployer.address, // admin
    deployer.address, // issuer
    deployer.address, // compliance
    kycRegistryAddress
  );
  await bondToken.waitForDeployment();
  const bondTokenAddress = await bondToken.getAddress();
  console.log(`BondToken deployed to: ${bondTokenAddress}`);

  // 4. Deploy ReserveOracle
  console.log("Deploying ReserveOracle...");
  const ReserveOracle = await ethers.getContractFactory("ReserveOracle");
  const reserveOracle = await ReserveOracle.deploy(
    config.oracles.reserveDecimals,
    BigInt(config.oracles.initialReserves),
    deployer.address
  );
  await reserveOracle.waitForDeployment();
  const reserveOracleAddress = await reserveOracle.getAddress();
  console.log(`ReserveOracle deployed to: ${reserveOracleAddress}`);

  // 5. Deploy YieldOracle
  console.log("Deploying YieldOracle...");
  const YieldOracle = await ethers.getContractFactory("YieldOracle");
  const yieldOracle = await YieldOracle.deploy(
    config.oracles.yieldDecimals,
    BigInt(config.oracles.initialYield),
    deployer.address
  );
  await yieldOracle.waitForDeployment();
  const yieldOracleAddress = await yieldOracle.getAddress();
  console.log(`YieldOracle deployed to: ${yieldOracleAddress}`);

  // 6. Connect ReserveOracle to BondToken
  console.log("Setting ReserveOracle on BondToken...");
  const setReserveTx = await bondToken.setReserveOracle(reserveOracleAddress);
  await setReserveTx.wait();
  console.log("ReserveOracle configured on BondToken.");

  // 7. Deploy ReserveGuard
  console.log("Deploying ReserveGuard...");
  const ReserveGuard = await ethers.getContractFactory("ReserveGuard");
  const reserveGuard = await ReserveGuard.deploy(
    bondTokenAddress,
    reserveOracleAddress,
    deployer.address,
    config.guard.minRatioBps,
    config.guard.maxStaleness
  );
  await reserveGuard.waitForDeployment();
  const reserveGuardAddress = await reserveGuard.getAddress();
  console.log(`ReserveGuard deployed to: ${reserveGuardAddress}`);

  // 8. Deploy Marketplace
  console.log("Deploying Marketplace...");
  const Marketplace = await ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy(
    bondTokenAddress,
    mockUSDCAddress,
    kycRegistryAddress
  );
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log(`Marketplace deployed to: ${marketplaceAddress}`);

  // 9. Deploy CouponDistributor
  console.log("Deploying CouponDistributor...");
  const CouponDistributor = await ethers.getContractFactory("CouponDistributor");
  const couponDistributor = await CouponDistributor.deploy(
    bondTokenAddress,
    mockUSDCAddress,
    kycRegistryAddress,
    deployer.address,
    deployer.address
  );
  await couponDistributor.waitForDeployment();
  const couponDistributorAddress = await couponDistributor.getAddress();
  console.log(`CouponDistributor deployed to: ${couponDistributorAddress}`);

  // 10. Grant ISSUER_ROLE to CouponDistributor
  console.log("Granting ISSUER_ROLE to CouponDistributor...");
  const ISSUER_ROLE = await bondToken.ISSUER_ROLE();
  const grantTx = await bondToken.grantRole(ISSUER_ROLE, couponDistributorAddress);
  await grantTx.wait();
  console.log("ISSUER_ROLE granted.");

  // 11. Price Feed & ChainlinkPriceReader
  let priceFeedAddress;
  if (networkName === "sepolia" && config.chainlink?.sepolia?.ethUsdFeed) {
    priceFeedAddress = config.chainlink.sepolia.ethUsdFeed;
    console.log(`Using live Chainlink Sepolia feed: ${priceFeedAddress}`);
  } else {
    console.log("Deploying MockPriceFeed for local testing...");
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const mockPriceFeed = await MockPriceFeed.deploy(
      config.chainlink.localhost.decimals,
      config.chainlink.localhost.description,
      BigInt(config.chainlink.localhost.initialEthPrice),
      deployer.address
    );
    await mockPriceFeed.waitForDeployment();
    priceFeedAddress = await mockPriceFeed.getAddress();
    console.log(`MockPriceFeed deployed to: ${priceFeedAddress}`);
  }

  console.log("Deploying ChainlinkPriceReader...");
  const ChainlinkPriceReader = await ethers.getContractFactory("ChainlinkPriceReader");
  const priceReader = await ChainlinkPriceReader.deploy(priceFeedAddress);
  await priceReader.waitForDeployment();
  const priceReaderAddress = await priceReader.getAddress();
  console.log(`ChainlinkPriceReader deployed to: ${priceReaderAddress}`);

  // 12. Seed Mint
  console.log("Whitelisting deployer in KYCRegistry...");
  const kycTx = await kycRegistry.addToWhitelist(deployer.address);
  await kycTx.wait();

  console.log("Seeding initial bond tokens...");
  const seedAmount = ethers.parseUnits(config.bond.seedMintAmount || "1000", 18);
  const mintTx = await bondToken.mint(deployer.address, seedAmount);
  await mintTx.wait();
  console.log("Minted 1000 CB28 to deployer");

  // Record deployment block
  const deployBlock = await ethers.provider.getBlockNumber();

  // 13. Save to shared/addresses.json
  const addressesPath = path.join(__dirname, "..", "shared", "addresses.json");
  let allAddresses = {};
  if (fs.existsSync(addressesPath)) {
    try {
      allAddresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    } catch {
      allAddresses = {};
    }
  }

  const networkKey = networkName === "localhost" || networkName === "hardhat" ? "localhost" : networkName;
  allAddresses[networkKey] = {
    BondToken: bondTokenAddress,
    KYCRegistry: kycRegistryAddress,
    MockUSDC: mockUSDCAddress,
    Marketplace: marketplaceAddress,
    CouponDistributor: couponDistributorAddress,
    ReserveOracle: reserveOracleAddress,
    YieldOracle: yieldOracleAddress,
    ReserveGuard: reserveGuardAddress,
    PriceFeed: priceFeedAddress,
    ChainlinkPriceReader: priceReaderAddress,
    deployBlock: deployBlock.toString(),
    timestamp: currentTimestamp
  };

  fs.writeFileSync(addressesPath, JSON.stringify(allAddresses, null, 2), "utf8");
  console.log(`Saved shared/addresses.json (${networkKey})`);
  console.log("==================================================");
  console.log("Deployment Complete!");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});


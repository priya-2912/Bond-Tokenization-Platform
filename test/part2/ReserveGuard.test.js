const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Part 2: ReserveGuard", function () {
  let reserveGuard, bondToken, reserveOracle, kycRegistry;
  let admin, issuer, compliance, user;

  beforeEach(async function () {
    [admin, issuer, compliance, user] = await ethers.getSigners();

    const latestBlock = await ethers.provider.getBlock("latest");
    const maturityDate = latestBlock.timestamp + 365 * 86400;

    const KYCRegistry = await ethers.getContractFactory("KYCRegistry");
    kycRegistry = await KYCRegistry.deploy(admin.address, compliance.address);
    await kycRegistry.waitForDeployment();

    const BondToken = await ethers.getContractFactory("BondToken");
    bondToken = await BondToken.deploy(
      "Corporate Bond 2028",
      "CB28",
      1000000000n, // $1,000 face value (6 decimals)
      800n,
      maturityDate,
      admin.address,
      issuer.address,
      compliance.address,
      await kycRegistry.getAddress()
    );
    await bondToken.waitForDeployment();

    // Whitelist issuer
    await kycRegistry.connect(compliance).addToWhitelist(issuer.address);

    // Initial reserve: $1,000,000 (1,000,000 * 10^6)
    const ReserveOracle = await ethers.getContractFactory("ReserveOracle");
    reserveOracle = await ReserveOracle.deploy(6, 1000000000000n, admin.address);
    await reserveOracle.waitForDeployment();

    // Link oracle to BondToken
    await bondToken.connect(admin).setReserveOracle(await reserveOracle.getAddress());

    // Deploy ReserveGuard: minRatio 10,000 bps (100%), staleness 86400
    const ReserveGuard = await ethers.getContractFactory("ReserveGuard");
    reserveGuard = await ReserveGuard.deploy(
      await bondToken.getAddress(),
      await reserveOracle.getAddress(),
      admin.address,
      10000n,
      86400n
    );
    await reserveGuard.waitForDeployment();
  });

  it("should report healthy when supply is zero", async function () {
    expect(await reserveGuard.requiredReserves()).to.equal(0n);
    expect(await reserveGuard.reserveRatioBps()).to.equal(ethers.MaxUint256);
    expect(await reserveGuard.isHealthy()).to.be.true;
  });

  it("should calculate required reserves and ratio accurately after minting", async function () {
    // Mint 500 bonds = 500 * $1,000 = $500,000 required (500,000 * 10^6)
    await bondToken.connect(issuer).mint(issuer.address, ethers.parseUnits("500", 18));

    expect(await reserveGuard.requiredReserves()).to.equal(500000000000n);
    // Reserves are 1,000,000 * 10^6, required is 500,000 * 10^6 -> ratio is 20,000 bps (200%)
    expect(await reserveGuard.reserveRatioBps()).to.equal(20000n);
    expect(await reserveGuard.isHealthy()).to.be.true;
  });

  it("should check canMint correctly", async function () {
    // Current supply is 0, reserves are $1,000,000
    // Minting 1,000 bonds requires $1,000,000 -> canMint should be true
    expect(await reserveGuard.canMint(ethers.parseUnits("1000", 18))).to.be.true;

    // Minting 2,000 bonds requires $2,000,000 -> canMint should be false
    expect(await reserveGuard.canMint(ethers.parseUnits("2000", 18))).to.be.false;
  });

  it("should emit ReserveAlert when reserves drop below required", async function () {
    // Mint 1000 bonds = 1,000,000 required
    await bondToken.connect(issuer).mint(issuer.address, ethers.parseUnits("1000", 18));

    // Drop reserves to 800,000 (80% collateralized)
    await reserveOracle.connect(admin).updateReserve(800000000000n);

    expect(await reserveGuard.isHealthy()).to.be.false;
    expect(await reserveGuard.reserveRatioBps()).to.equal(8000n);

    await expect(reserveGuard.checkAndAlert())
      .to.emit(reserveGuard, "ReserveAlert");

    expect(await reserveGuard.alertActive()).to.be.true;
  });

  it("should emit ReserveRestored when reserves recover", async function () {
    await bondToken.connect(issuer).mint(issuer.address, ethers.parseUnits("1000", 18));
    await reserveOracle.connect(admin).updateReserve(800000000000n);
    await reserveGuard.checkAndAlert(); // activate alert

    // Restore reserves to 1,200,000
    await reserveOracle.connect(admin).updateReserve(1200000000000n);
    expect(await reserveGuard.isHealthy()).to.be.true;

    await expect(reserveGuard.checkAndAlert())
      .to.emit(reserveGuard, "ReserveRestored");

    expect(await reserveGuard.alertActive()).to.be.false;
  });

  it("should allow admin to update minRatioBps", async function () {
    await expect(reserveGuard.connect(admin).setMinRatioBps(12000n))
      .to.emit(reserveGuard, "MinRatioUpdated")
      .withArgs(12000n);
    expect(await reserveGuard.minRatioBps()).to.equal(12000n);
  });

  it("should allow admin to update maxStaleness", async function () {
    await expect(reserveGuard.connect(admin).setMaxStaleness(3600n))
      .to.emit(reserveGuard, "MaxStalenessUpdated")
      .withArgs(3600n);
    expect(await reserveGuard.maxStaleness()).to.equal(3600n);
  });

  it("should revert if non-admin attempts parameter updates", async function () {
    await expect(
      reserveGuard.connect(user).setMinRatioBps(11000n)
    ).to.be.reverted;
  });
});

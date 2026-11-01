const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BondToken", function () {
  let bondToken, kycRegistry, reserveOracle;
  let admin, issuer, compliance, investor1, investor2, stranger;
  const faceValue = 1000000000n; // 1000 * 10^6 (in USDC units)
  const couponRateBps = 800n; // 8%
  let maturityDate;

  beforeEach(async function () {
    [admin, issuer, compliance, investor1, investor2, stranger] = await ethers.getSigners();

    const latestBlock = await ethers.provider.getBlock("latest");
    maturityDate = latestBlock.timestamp + 365 * 86400;

    const KYCRegistry = await ethers.getContractFactory("KYCRegistry");
    kycRegistry = await KYCRegistry.deploy(admin.address, compliance.address);
    await kycRegistry.waitForDeployment();

    const ReserveOracle = await ethers.getContractFactory("ReserveOracle");
    reserveOracle = await ReserveOracle.deploy(6, 1000000000000n, admin.address);
    await reserveOracle.waitForDeployment();

    const BondToken = await ethers.getContractFactory("BondToken");
    bondToken = await BondToken.deploy(
      "Corporate Bond 2028",
      "CB28",
      faceValue,
      couponRateBps,
      maturityDate,
      admin.address,
      issuer.address,
      compliance.address,
      await kycRegistry.getAddress()
    );
    await bondToken.waitForDeployment();

    // Whitelist investors
    await kycRegistry.connect(compliance).batchAddToWhitelist([investor1.address, investor2.address]);
  });

  it("should deploy with correct metadata and terms", async function () {
    expect(await bondToken.name()).to.equal("Corporate Bond 2028");
    expect(await bondToken.symbol()).to.equal("CB28");
    expect(await bondToken.faceValue()).to.equal(faceValue);
    expect(await bondToken.couponRateBps()).to.equal(couponRateBps);
    expect(await bondToken.maturityDate()).to.equal(maturityDate);
  });

  it("should enforce roles properly", async function () {
    const ISSUER_ROLE = await bondToken.ISSUER_ROLE();
    const PAUSER_ROLE = await bondToken.PAUSER_ROLE();
    const COMPLIANCE_ROLE = await bondToken.COMPLIANCE_ROLE();

    expect(await bondToken.hasRole(ISSUER_ROLE, issuer.address)).to.be.true;
    expect(await bondToken.hasRole(PAUSER_ROLE, admin.address)).to.be.true;
    expect(await bondToken.hasRole(COMPLIANCE_ROLE, compliance.address)).to.be.true;
    expect(await bondToken.hasRole(ISSUER_ROLE, stranger.address)).to.be.false;
  });

  it("should mint to a KYC-verified recipient", async function () {
    const amount = ethers.parseUnits("100", 18);
    await bondToken.connect(issuer).mint(investor1.address, amount);
    expect(await bondToken.balanceOf(investor1.address)).to.equal(amount);
  });

  it("should revert minting to a non-KYC recipient", async function () {
    const amount = ethers.parseUnits("100", 18);
    await expect(
      bondToken.connect(issuer).mint(stranger.address, amount)
    ).to.be.revertedWith("BondToken: receiver not KYC verified");
  });

  it("should revert minting zero amount or to zero address", async function () {
    await expect(
      bondToken.connect(issuer).mint(investor1.address, 0n)
    ).to.be.revertedWith("BondToken: amount must be > 0");

    await expect(
      bondToken.connect(issuer).mint(ethers.ZeroAddress, ethers.parseUnits("10", 18))
    ).to.be.revertedWith("BondToken: cannot mint to zero address");
  });

  it("should revert minting if caller is not issuer", async function () {
    const amount = ethers.parseUnits("10", 18);
    await expect(
      bondToken.connect(stranger).mint(investor1.address, amount)
    ).to.be.reverted;
  });

  it("should allow transfers between KYC-verified addresses", async function () {
    const amount = ethers.parseUnits("50", 18);
    await bondToken.connect(issuer).mint(investor1.address, amount);

    await bondToken.connect(investor1).transfer(investor2.address, amount);
    expect(await bondToken.balanceOf(investor2.address)).to.equal(amount);
  });

  it("should block transfer to a non-KYC address", async function () {
    const amount = ethers.parseUnits("50", 18);
    await bondToken.connect(issuer).mint(investor1.address, amount);

    await expect(
      bondToken.connect(investor1).transfer(stranger.address, amount)
    ).to.be.revertedWith("BondToken: receiver not KYC verified");
  });

  it("should block transfer from a non-KYC address", async function () {
    const amount = ethers.parseUnits("50", 18);
    await bondToken.connect(issuer).mint(investor1.address, amount);
    // remove investor1 from whitelist
    await kycRegistry.connect(compliance).removeFromWhitelist(investor1.address);

    await expect(
      bondToken.connect(investor1).transfer(investor2.address, amount)
    ).to.be.revertedWith("BondToken: sender not KYC verified");
  });

  it("should pause and block transfers", async function () {
    const amount = ethers.parseUnits("50", 18);
    await bondToken.connect(issuer).mint(investor1.address, amount);

    await bondToken.connect(admin).pause();
    await expect(
      bondToken.connect(investor1).transfer(investor2.address, amount)
    ).to.be.revertedWithCustomError(bondToken, "EnforcedPause");

    await bondToken.connect(admin).unpause();
    await bondToken.connect(investor1).transfer(investor2.address, amount);
    expect(await bondToken.balanceOf(investor2.address)).to.equal(amount);
  });

  it("should allow compliance force transfer", async function () {
    const amount = ethers.parseUnits("50", 18);
    await bondToken.connect(issuer).mint(investor1.address, amount);

    await expect(
      bondToken.connect(compliance).forceTransfer(investor1.address, investor2.address, amount)
    )
      .to.emit(bondToken, "ForceTransferExecuted")
      .withArgs(investor1.address, investor2.address, amount, compliance.address);

    expect(await bondToken.balanceOf(investor1.address)).to.equal(0n);
    expect(await bondToken.balanceOf(investor2.address)).to.equal(amount);
  });

  it("should revert force transfer if caller is not compliance", async function () {
    const amount = ethers.parseUnits("10", 18);
    await bondToken.connect(issuer).mint(investor1.address, amount);
    await expect(
      bondToken.connect(stranger).forceTransfer(investor1.address, investor2.address, amount)
    ).to.be.reverted;
  });

  it("should allow admin to update KYCRegistry", async function () {
    const newRegistry = investor2.address;
    await expect(bondToken.connect(admin).setKYCRegistry(newRegistry))
      .to.emit(bondToken, "KYCRegistryUpdated")
      .withArgs(newRegistry);
    expect(await bondToken.kycRegistry()).to.equal(newRegistry);
  });

  it("should allow admin to set ReserveOracle and calculate reserveRatio", async function () {
    await expect(bondToken.connect(admin).setReserveOracle(await reserveOracle.getAddress()))
      .to.emit(bondToken, "ReserveOracleUpdated")
      .withArgs(await reserveOracle.getAddress());

    expect(await bondToken.reserveRatio()).to.equal(10000n); // 100% when supply = 0
  });

  it("should burn tokens when caller is KYC verified", async function () {
    const amount = ethers.parseUnits("20", 18);
    await bondToken.connect(issuer).mint(investor1.address, amount);
    await bondToken.connect(investor1).burn(ethers.parseUnits("10", 18));
    expect(await bondToken.balanceOf(investor1.address)).to.equal(ethers.parseUnits("10", 18));
  });
});

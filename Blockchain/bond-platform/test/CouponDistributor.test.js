const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CouponDistributor", function () {
  let distributor, bondToken, mockUSDC, kycRegistry;
  let admin, issuer, compliance, investor, nonKyc;
  let maturityDate;

  beforeEach(async function () {
    [admin, issuer, compliance, investor, nonKyc] = await ethers.getSigners();

    const latestBlock = await ethers.provider.getBlock("latest");
    maturityDate = latestBlock.timestamp + 1000;

    const KYCRegistry = await ethers.getContractFactory("KYCRegistry");
    kycRegistry = await KYCRegistry.deploy(admin.address, compliance.address);
    await kycRegistry.waitForDeployment();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();

    const BondToken = await ethers.getContractFactory("BondToken");
    bondToken = await BondToken.deploy(
      "Corporate Bond 2028",
      "CB28",
      1000000000n, // $1,000 in USDC units
      800n,        // 8.00%
      maturityDate,
      admin.address,
      issuer.address,
      compliance.address,
      await kycRegistry.getAddress()
    );
    await bondToken.waitForDeployment();

    const CouponDistributor = await ethers.getContractFactory("CouponDistributor");
    distributor = await CouponDistributor.deploy(
      await bondToken.getAddress(),
      await mockUSDC.getAddress(),
      await kycRegistry.getAddress(),
      admin.address,
      issuer.address
    );
    await distributor.waitForDeployment();

    // Grant ISSUER_ROLE to distributor for burns on redemption
    const ISSUER_ROLE = await bondToken.ISSUER_ROLE();
    await bondToken.connect(admin).grantRole(ISSUER_ROLE, await distributor.getAddress());

    // Whitelist investor & distributor
    await kycRegistry.connect(compliance).batchAddToWhitelist([
      investor.address,
      await distributor.getAddress()
    ]);

    // Mint bonds to investor
    await bondToken.connect(issuer).mint(investor.address, ethers.parseUnits("10", 18));
  });

  it("should record snapshots and calculate coupon accurately", async function () {
    const bondAmount = ethers.parseUnits("10", 18);
    // 10 bonds * $1,000 * 8% = $800 USDC (800 * 10^6 = 800,000,000)
    const expectedCoupon = await distributor.calculateCoupon(bondAmount);
    expect(expectedCoupon).to.equal(800000000n);

    await distributor.connect(issuer).recordSnapshot(1, [investor.address], [bondAmount]);
    expect(await distributor.snapshotBalances(1, investor.address)).to.equal(bondAmount);
  });

  it("should revert recordSnapshot on array length mismatch", async function () {
    await expect(
      distributor.connect(issuer).recordSnapshot(1, [investor.address], [])
    ).to.be.revertedWith("CouponDistributor: array length mismatch");
  });

  it("should revert recordSnapshot if caller lacks ISSUER_ROLE", async function () {
    await expect(
      distributor.connect(nonKyc).recordSnapshot(1, [investor.address], [ethers.parseUnits("10", 18)])
    ).to.be.reverted;
  });

  it("should revert depositing 0 funds", async function () {
    await expect(
      distributor.connect(issuer).depositFunds(0n)
    ).to.be.revertedWith("CouponDistributor: amount must be > 0");
  });

  it("should allow verified investor to claim coupon", async function () {
    const bondAmount = ethers.parseUnits("10", 18);
    await distributor.connect(issuer).recordSnapshot(1, [investor.address], [bondAmount]);

    // Fund distributor with USDC
    await mockUSDC.mint(issuer.address, 1000000000n);
    await mockUSDC.connect(issuer).approve(await distributor.getAddress(), 1000000000n);
    await distributor.connect(issuer).depositFunds(1000000000n);

    const balanceBefore = await mockUSDC.balanceOf(investor.address);
    await expect(distributor.connect(investor).claimCoupon(1))
      .to.emit(distributor, "CouponClaimed")
      .withArgs(1, investor.address, 800000000n);

    expect(await mockUSDC.balanceOf(investor.address)).to.equal(balanceBefore + 800000000n);
    expect(await distributor.hasClaimed(1, investor.address)).to.be.true;

    // Double claim reverts
    await expect(
      distributor.connect(investor).claimCoupon(1)
    ).to.be.revertedWith("CouponDistributor: coupon already claimed");
  });

  it("should revert claiming coupon if caller is not KYC verified", async function () {
    await expect(
      distributor.connect(nonKyc).claimCoupon(1)
    ).to.be.revertedWith("CouponDistributor: caller not KYC verified");
  });

  it("should revert claiming coupon if caller has 0 balance in snapshot", async function () {
    await distributor.connect(issuer).recordSnapshot(1, [issuer.address], [ethers.parseUnits("10", 18)]);
    await expect(
      distributor.connect(investor).claimCoupon(1)
    ).to.be.revertedWith("CouponDistributor: no coupon balance in snapshot");
  });

  it("should block redemption before maturity", async function () {
    await expect(
      distributor.connect(investor).redeem(ethers.parseUnits("1", 18))
    ).to.be.revertedWith("CouponDistributor: bond has not matured yet");
  });

  it("should allow redemption after maturity", async function () {
    // Fast-forward past maturity
    await ethers.provider.send("evm_increaseTime", [2000]);
    await ethers.provider.send("evm_mine");

    const redeemBonds = ethers.parseUnits("5", 18);
    const requiredPayout = 5000000000n; // 5 * 1000 USDC

    // Fund distributor for redemption
    await mockUSDC.mint(issuer.address, requiredPayout);
    await mockUSDC.connect(issuer).approve(await distributor.getAddress(), requiredPayout);
    await distributor.connect(issuer).depositFunds(requiredPayout);

    const usdcBefore = await mockUSDC.balanceOf(investor.address);
    const bondsBefore = await bondToken.balanceOf(investor.address);

    await expect(distributor.connect(investor).redeem(redeemBonds))
      .to.emit(distributor, "BondRedeemed")
      .withArgs(investor.address, redeemBonds, requiredPayout);

    expect(await mockUSDC.balanceOf(investor.address)).to.equal(usdcBefore + requiredPayout);
    expect(await bondToken.balanceOf(investor.address)).to.equal(bondsBefore - redeemBonds);
  });

  it("should support period scaling for quarterly distributions", async function () {
    const bondAmount = ethers.parseUnits("10", 18);
    // 4 periods per year -> 8% / 4 = 2% per period -> $200 USDC
    await distributor.connect(issuer).setPeriodsPerYear(4);
    const quarterlyCoupon = await distributor.calculateCoupon(bondAmount);
    expect(quarterlyCoupon).to.equal(200000000n);
  });

  it("should return accurate claimable coupon and track active periods", async function () {
    const bondAmount = ethers.parseUnits("10", 18);
    await distributor.connect(issuer).recordSnapshot(1, [investor.address], [bondAmount]);

    expect(await distributor.getClaimableCoupon(1, investor.address)).to.equal(800000000n);
    expect(await distributor.getClaimableCoupon(1, nonKyc.address)).to.equal(0n);

    const periods = await distributor.getActivePeriods();
    expect(periods.length).to.equal(1);
    expect(periods[0]).to.equal(1n);
  });

  it("should support separate deposits and unused funds withdrawal", async function () {
    await mockUSDC.mint(issuer.address, 5000000000n);
    await mockUSDC.connect(issuer).approve(await distributor.getAddress(), 5000000000n);

    await distributor.connect(issuer).depositCouponFunds(2000000000n);
    await distributor.connect(issuer).depositRedemptionFunds(3000000000n);

    expect(await distributor.couponPool()).to.equal(2000000000n);
    expect(await distributor.redemptionPool()).to.equal(3000000000n);

    const balanceBefore = await mockUSDC.balanceOf(admin.address);
    await distributor.connect(admin).withdrawUnusedFunds(await mockUSDC.getAddress(), 1000000000n, admin.address);
    expect(await mockUSDC.balanceOf(admin.address)).to.equal(balanceBefore + 1000000000n);
  });

  it("should revert redemption with zero amount", async function () {
    await ethers.provider.send("evm_increaseTime", [2000]);
    await ethers.provider.send("evm_mine");

    await expect(
      distributor.connect(investor).redeem(0n)
    ).to.be.revertedWith("CouponDistributor: bondAmount must be > 0");
  });
});

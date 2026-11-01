const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Part 2: Full System Integration", function () {
  let bondToken, kycRegistry, mockUSDC, marketplace, distributor, reserveOracle, reserveGuard;
  let admin, issuer, compliance, investor1, investor2;

  beforeEach(async function () {
    [admin, issuer, compliance, investor1, investor2] = await ethers.getSigners();

    const latestBlock = await ethers.provider.getBlock("latest");
    const maturityDate = latestBlock.timestamp + 365 * 86400;

    // 1. KYC Registry
    const KYCRegistry = await ethers.getContractFactory("KYCRegistry");
    kycRegistry = await KYCRegistry.deploy(admin.address, compliance.address);
    await kycRegistry.waitForDeployment();

    // 2. MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();

    // 3. BondToken
    const BondToken = await ethers.getContractFactory("BondToken");
    bondToken = await BondToken.deploy(
      "Corporate Bond 2028",
      "CB28",
      1000000000n, // $1,000 face value (6 decimals)
      800n,        // 8%
      maturityDate,
      admin.address,
      issuer.address,
      compliance.address,
      await kycRegistry.getAddress()
    );
    await bondToken.waitForDeployment();

    // 4. ReserveOracle (initially $1,000,000 reserves)
    const ReserveOracle = await ethers.getContractFactory("ReserveOracle");
    reserveOracle = await ReserveOracle.deploy(6, 1000000000000n, admin.address);
    await reserveOracle.waitForDeployment();
    await bondToken.connect(admin).setReserveOracle(await reserveOracle.getAddress());

    // 5. ReserveGuard
    const ReserveGuard = await ethers.getContractFactory("ReserveGuard");
    reserveGuard = await ReserveGuard.deploy(
      await bondToken.getAddress(),
      await reserveOracle.getAddress(),
      admin.address,
      10000n,
      86400n
    );
    await reserveGuard.waitForDeployment();

    // 6. Marketplace
    const Marketplace = await ethers.getContractFactory("Marketplace");
    marketplace = await Marketplace.deploy(
      await bondToken.getAddress(),
      await mockUSDC.getAddress(),
      await kycRegistry.getAddress()
    );
    await marketplace.waitForDeployment();

    // 7. CouponDistributor
    const CouponDistributor = await ethers.getContractFactory("CouponDistributor");
    distributor = await CouponDistributor.deploy(
      await bondToken.getAddress(),
      await mockUSDC.getAddress(),
      await kycRegistry.getAddress(),
      admin.address,
      issuer.address
    );
    await distributor.waitForDeployment();

    // Grant ISSUER_ROLE to distributor
    const ISSUER_ROLE = await bondToken.ISSUER_ROLE();
    await bondToken.connect(admin).grantRole(ISSUER_ROLE, await distributor.getAddress());

    // Whitelist accounts
    await kycRegistry.connect(compliance).batchAddToWhitelist([
      admin.address,
      issuer.address,
      investor1.address,
      investor2.address,
      await marketplace.getAddress(),
      await distributor.getAddress()
    ]);
  });

  it("should complete full lifecycle: mint -> trade -> coupon -> redeem with reserve checks", async function () {
    // 1. Initial Mint 500 bonds to investor1
    const mintAmount = ethers.parseUnits("500", 18);
    await bondToken.connect(issuer).mint(investor1.address, mintAmount);
    expect(await bondToken.balanceOf(investor1.address)).to.equal(mintAmount);

    // 2. Secondary Market: investor1 sells 100 bonds to investor2
    const sellAmount = ethers.parseUnits("100", 18);
    const sellPrice = 100000000000n; // 100,000 USDC
    await mockUSDC.mint(investor2.address, sellPrice);
    await bondToken.connect(investor1).approve(await marketplace.getAddress(), sellAmount);
    await marketplace.connect(investor1).createSellOrder(sellAmount, sellPrice);

    await mockUSDC.connect(investor2).approve(await marketplace.getAddress(), sellPrice);
    await marketplace.connect(investor2).buy(1);

    expect(await bondToken.balanceOf(investor2.address)).to.equal(sellAmount);
    expect(await bondToken.balanceOf(investor1.address)).to.equal(mintAmount - sellAmount);

    // 3. Reserve Drop blocks further minting
    await reserveOracle.connect(admin).updateReserve(200000000000n); // drop to $200k (below required $500k)
    await expect(
      bondToken.connect(issuer).mint(investor1.address, ethers.parseUnits("10", 18))
    ).to.be.revertedWith("BondToken: reserve ratio below 100%");

    // 4. Reserve Guard alerts
    await expect(reserveGuard.checkAndAlert()).to.emit(reserveGuard, "ReserveAlert");

    // 5. Restore reserves
    await reserveOracle.connect(admin).updateReserve(1500000000000n); // $1.5M
    await expect(reserveGuard.checkAndAlert()).to.emit(reserveGuard, "ReserveRestored");

    // Minting works again
    await bondToken.connect(issuer).mint(investor1.address, ethers.parseUnits("10", 18));

    // 6. Coupon Distribution
    // Total supply = 510 bonds. investor2 has 100 bonds.
    // Coupon owed to investor2 = 100 * $1,000 * 8% = $8,000 = 8000 * 10^6
    await distributor.connect(issuer).recordSnapshot(
      1,
      [investor1.address, investor2.address],
      [ethers.parseUnits("410", 18), ethers.parseUnits("100", 18)]
    );

    const couponTotal = 50000000000n;
    await mockUSDC.mint(issuer.address, couponTotal);
    await mockUSDC.connect(issuer).approve(await distributor.getAddress(), couponTotal);
    await distributor.connect(issuer).depositFunds(couponTotal);

    const usdcBefore = await mockUSDC.balanceOf(investor2.address);
    await distributor.connect(investor2).claimCoupon(1);
    expect(await mockUSDC.balanceOf(investor2.address)).to.equal(usdcBefore + 8000000000n);
  });
});


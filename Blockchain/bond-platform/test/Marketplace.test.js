const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Marketplace", function () {
  let marketplace, bondToken, mockUSDC, kycRegistry;
  let admin, issuer, compliance, seller, buyer, nonKyc;

  beforeEach(async function () {
    [admin, issuer, compliance, seller, buyer, nonKyc] = await ethers.getSigners();

    const latestBlock = await ethers.provider.getBlock("latest");
    const maturityDate = latestBlock.timestamp + 365 * 86400;

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
      1000000000n, // 1000 USDC
      800n,
      maturityDate,
      admin.address,
      issuer.address,
      compliance.address,
      await kycRegistry.getAddress()
    );
    await bondToken.waitForDeployment();

    const Marketplace = await ethers.getContractFactory("Marketplace");
    marketplace = await Marketplace.deploy(
      await bondToken.getAddress(),
      await mockUSDC.getAddress(),
      await kycRegistry.getAddress()
    );
    await marketplace.waitForDeployment();

    // Whitelist seller and buyer and marketplace
    await kycRegistry.connect(compliance).batchAddToWhitelist([
      seller.address,
      buyer.address,
      await marketplace.getAddress()
    ]);

    // Mint bonds to seller
    await bondToken.connect(issuer).mint(seller.address, ethers.parseUnits("10", 18));
    // Mint USDC to buyer
    await mockUSDC.mint(buyer.address, 10000000000n); // 10,000 USDC
  });

  it("should create a sell order and escrow bonds", async function () {
    const bondAmount = ethers.parseUnits("5", 18);
    const priceUSDC = 5000000000n; // 5,000 USDC

    await bondToken.connect(seller).approve(await marketplace.getAddress(), bondAmount);
    await expect(marketplace.connect(seller).createSellOrder(bondAmount, priceUSDC))
      .to.emit(marketplace, "OrderCreated")
      .withArgs(1, seller.address, bondAmount, priceUSDC);

    const order = await marketplace.getOrder(1);
    expect(order.seller).to.equal(seller.address);
    expect(order.bondAmount).to.equal(bondAmount);
    expect(order.priceInUSDC).to.equal(priceUSDC);
    expect(order.isActive).to.be.true;

    expect(await bondToken.balanceOf(await marketplace.getAddress())).to.equal(bondAmount);
  });

  it("should reject order creation with zero amount or price", async function () {
    await expect(
      marketplace.connect(seller).createSellOrder(0n, 1000000000n)
    ).to.be.revertedWith("Marketplace: bondAmount must be > 0");

    await expect(
      marketplace.connect(seller).createSellOrder(ethers.parseUnits("1", 18), 0n)
    ).to.be.revertedWith("Marketplace: price must be > 0");
  });

  it("should reject order creation from non-KYC seller", async function () {
    const bondAmount = ethers.parseUnits("1", 18);
    await expect(
      marketplace.connect(nonKyc).createSellOrder(bondAmount, 1000000000n)
    ).to.be.revertedWith("Marketplace: seller not KYC verified");
  });

  it("should allow buyer to fill an order", async function () {
    const bondAmount = ethers.parseUnits("2", 18);
    const priceUSDC = 2000000000n; // 2,000 USDC

    await bondToken.connect(seller).approve(await marketplace.getAddress(), bondAmount);
    await marketplace.connect(seller).createSellOrder(bondAmount, priceUSDC);

    await mockUSDC.connect(buyer).approve(await marketplace.getAddress(), priceUSDC);
    await expect(marketplace.connect(buyer).buy(1))
      .to.emit(marketplace, "OrderFilled")
      .withArgs(1, buyer.address, seller.address, bondAmount, priceUSDC);

    expect(await bondToken.balanceOf(buyer.address)).to.equal(bondAmount);
    expect(await mockUSDC.balanceOf(seller.address)).to.equal(priceUSDC);

    const order = await marketplace.getOrder(1);
    expect(order.isActive).to.be.false;
  });

  it("should revert if buyer is not KYC verified", async function () {
    const bondAmount = ethers.parseUnits("1", 18);
    const priceUSDC = 1000000000n;
    await bondToken.connect(seller).approve(await marketplace.getAddress(), bondAmount);
    await marketplace.connect(seller).createSellOrder(bondAmount, priceUSDC);

    await expect(
      marketplace.connect(nonKyc).buy(1)
    ).to.be.revertedWith("Marketplace: buyer not KYC verified");
  });

  it("should revert if buying an inactive or non-existent order", async function () {
    await expect(
      marketplace.connect(buyer).buy(999)
    ).to.be.revertedWith("Marketplace: order not active");
  });

  it("should allow seller to cancel order and reclaim bonds", async function () {
    const bondAmount = ethers.parseUnits("3", 18);
    const priceUSDC = 3000000000n;

    await bondToken.connect(seller).approve(await marketplace.getAddress(), bondAmount);
    await marketplace.connect(seller).createSellOrder(bondAmount, priceUSDC);

    const balanceBefore = await bondToken.balanceOf(seller.address);
    await expect(marketplace.connect(seller).cancelOrder(1))
      .to.emit(marketplace, "OrderCancelled")
      .withArgs(1, seller.address);

    expect(await bondToken.balanceOf(seller.address)).to.equal(balanceBefore + bondAmount);
    const order = await marketplace.getOrder(1);
    expect(order.isActive).to.be.false;
  });

  it("should revert cancelling order if caller is not seller", async function () {
    const bondAmount = ethers.parseUnits("1", 18);
    await bondToken.connect(seller).approve(await marketplace.getAddress(), bondAmount);
    await marketplace.connect(seller).createSellOrder(bondAmount, 1000000000n);

    await expect(
      marketplace.connect(buyer).cancelOrder(1)
    ).to.be.revertedWith("Marketplace: caller not seller");
  });
});

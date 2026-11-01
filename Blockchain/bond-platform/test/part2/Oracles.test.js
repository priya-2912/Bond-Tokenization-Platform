const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Part 2: Oracles & Price Reader", function () {
  let reserveOracle, yieldOracle, mockFeed, priceReader, admin, stranger;

  beforeEach(async function () {
    [admin, stranger] = await ethers.getSigners();

    // Deploy ReserveOracle
    const ReserveOracle = await ethers.getContractFactory("ReserveOracle");
    reserveOracle = await ReserveOracle.deploy(6, 1000000000000n, admin.address);
    await reserveOracle.waitForDeployment();

    // Deploy YieldOracle
    const YieldOracle = await ethers.getContractFactory("YieldOracle");
    yieldOracle = await YieldOracle.deploy(2, 800, admin.address);
    await yieldOracle.waitForDeployment();

    // Deploy MockPriceFeed (ETH/USD, 8 decimals, $3,000)
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    mockFeed = await MockPriceFeed.deploy(8, "ETH / USD Mock", 300000000000n, admin.address);
    await mockFeed.waitForDeployment();

    // Deploy ChainlinkPriceReader
    const ChainlinkPriceReader = await ethers.getContractFactory("ChainlinkPriceReader");
    priceReader = await ChainlinkPriceReader.deploy(await mockFeed.getAddress());
    await priceReader.waitForDeployment();
  });

  describe("ReserveOracle", function () {
    it("should return initial reserves", async function () {
      expect(await reserveOracle.getReserves()).to.equal(1000000000000n);
    });

    it("should update reserves when called by admin", async function () {
      await reserveOracle.connect(admin).updateReserve(500000000000n);
      expect(await reserveOracle.getReserves()).to.equal(500000000000n);
    });

    it("should revert if updated by stranger", async function () {
      await expect(
        reserveOracle.connect(stranger).updateReserve(500000000000n)
      ).to.be.reverted;
    });
  });

  describe("YieldOracle", function () {
    it("should return initial yield", async function () {
      expect(await yieldOracle.latestAnswer()).to.equal(800);
    });

    it("should update yield", async function () {
      await yieldOracle.connect(admin).updateYield(850);
      expect(await yieldOracle.latestAnswer()).to.equal(850);
    });
  });

  describe("ChainlinkPriceReader", function () {
    it("should read latest price and decimals", async function () {
      const [price, decimals] = await priceReader.latestPrice();
      expect(price).to.equal(300000000000n);
      expect(decimals).to.equal(8);
    });

    it("should convert 1 ETH (18 decimals) to quote USD", async function () {
      const oneEth = ethers.parseEther("1");
      const usdValue = await priceReader.toQuote(oneEth, 18);
      // 1 ETH * 3000 * 10^8 / 10^18 = 3000 * 10^8
      expect(usdValue).to.equal(300000000000n);
    });
  });
});


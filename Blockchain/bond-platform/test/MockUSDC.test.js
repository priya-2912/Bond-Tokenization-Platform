const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MockUSDC", function () {
  let mockUSDC, owner, user, receiver;

  beforeEach(async function () {
    [owner, user, receiver] = await ethers.getSigners();
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
  });

  it("should have 6 decimals and correct name/symbol", async function () {
    expect(await mockUSDC.decimals()).to.equal(6);
    expect(await mockUSDC.name()).to.equal("Mock USD Coin");
    expect(await mockUSDC.symbol()).to.equal("mUSDC");
  });

  it("should allow open faucet minting", async function () {
    const amount = 1000000000n; // 1,000 USDC
    await mockUSDC.mint(user.address, amount);
    expect(await mockUSDC.balanceOf(user.address)).to.equal(amount);
  });

  it("should support ERC20 transfer of minted tokens", async function () {
    const amount = 500000000n;
    await mockUSDC.mint(user.address, amount);
    await mockUSDC.connect(user).transfer(receiver.address, amount);
    expect(await mockUSDC.balanceOf(receiver.address)).to.equal(amount);
  });
});

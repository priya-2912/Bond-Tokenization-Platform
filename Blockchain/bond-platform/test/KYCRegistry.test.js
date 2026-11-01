const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KYCRegistry", function () {
  let kycRegistry;
  let admin, compliance, user1, user2;

  beforeEach(async function () {
    [admin, compliance, user1, user2] = await ethers.getSigners();
    const KYCRegistry = await ethers.getContractFactory("KYCRegistry");
    kycRegistry = await KYCRegistry.deploy(admin.address, compliance.address);
    await kycRegistry.waitForDeployment();
  });

  it("should initialize roles correctly", async function () {
    const COMPLIANCE_ROLE = await kycRegistry.COMPLIANCE_ROLE();
    const DEFAULT_ADMIN_ROLE = await kycRegistry.DEFAULT_ADMIN_ROLE();
    expect(await kycRegistry.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    expect(await kycRegistry.hasRole(COMPLIANCE_ROLE, compliance.address)).to.be.true;
    expect(await kycRegistry.hasRole(COMPLIANCE_ROLE, user1.address)).to.be.false;
  });

  it("should allow compliance officer to whitelist an address", async function () {
    expect(await kycRegistry.isVerified(user1.address)).to.be.false;
    await expect(kycRegistry.connect(compliance).addToWhitelist(user1.address))
      .to.emit(kycRegistry, "AddressWhitelisted")
      .withArgs(user1.address, compliance.address);
    expect(await kycRegistry.isVerified(user1.address)).to.be.true;
  });

  it("should revert if non-compliance officer tries to whitelist", async function () {
    await expect(
      kycRegistry.connect(user1).addToWhitelist(user2.address)
    ).to.be.reverted;
  });

  it("should revert whitelisting already whitelisted address", async function () {
    await kycRegistry.connect(compliance).addToWhitelist(user1.address);
    await expect(
      kycRegistry.connect(compliance).addToWhitelist(user1.address)
    ).to.be.revertedWith("KYCRegistry: address already whitelisted");
  });

  it("should allow compliance officer to remove an address", async function () {
    await kycRegistry.connect(compliance).addToWhitelist(user1.address);
    await expect(kycRegistry.connect(compliance).removeFromWhitelist(user1.address))
      .to.emit(kycRegistry, "AddressRemovedFromWhitelist")
      .withArgs(user1.address, compliance.address);
    expect(await kycRegistry.isVerified(user1.address)).to.be.false;
  });

  it("should revert removing an address that is not whitelisted", async function () {
    await expect(
      kycRegistry.connect(compliance).removeFromWhitelist(user1.address)
    ).to.be.revertedWith("KYCRegistry: address not whitelisted");
  });

  it("should batch whitelist addresses and skip already whitelisted without error", async function () {
    await kycRegistry.connect(compliance).addToWhitelist(user1.address);
    await kycRegistry.connect(compliance).batchAddToWhitelist([user1.address, user2.address]);
    expect(await kycRegistry.isVerified(user1.address)).to.be.true;
    expect(await kycRegistry.isVerified(user2.address)).to.be.true;
  });

  it("should revert if zero address is passed", async function () {
    await expect(
      kycRegistry.connect(compliance).addToWhitelist(ethers.ZeroAddress)
    ).to.be.revertedWith("KYCRegistry: invalid address");
  });
});

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @dev Test stablecoin simulating USDC (6 decimals) with open faucet minting for testing.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "mUSDC") {}

    /**
     * @notice Returns 6 decimals matching real USDC.
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Public faucet mint for testing and investor onboarding.
     * @param to Recipient address.
     * @param amount Amount of tokens to mint (in 6 decimal units).
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

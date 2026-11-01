// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockFeed} from "./MockFeed.sol";

/// @notice Local stand-in for a Chainlink price feed (e.g. ETH/USD) on networks that
/// have no real feed. On Sepolia we read the real Chainlink feed instead.
contract MockPriceFeed is MockFeed {
    constructor(uint8 feedDecimals_, string memory desc, int256 initialPrice, address admin)
        MockFeed(feedDecimals_, desc, initialPrice, admin)
    {}

    function updatePrice(int256 newPrice) external onlyRole(FEED_ADMIN_ROLE) {
        _push(newPrice);
    }
}

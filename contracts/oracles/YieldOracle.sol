// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockFeed} from "./MockFeed.sol";

/// @notice MOCK bond yield feed (Chainlink has no real bond yield feed on testnet).
/// Value is a yield in percent with 2 decimals by default (e.g. 800 = 8.00%).
contract YieldOracle is MockFeed {
    constructor(uint8 feedDecimals_, int256 initialYield, address admin)
        MockFeed(feedDecimals_, "Bond Yield (mock)", initialYield, admin)
    {}

    function updateYield(int256 newYield) external onlyRole(FEED_ADMIN_ROLE) {
        _push(newYield);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockFeed} from "./MockFeed.sol";

/// @notice MOCK Proof of Reserve feed. Reports the value of assets backing the bond in the
/// bond's face-value currency (MockUSDC, 6 decimals). It is compatible with Part 1's
/// IReserveOracle (getReserves + latestRoundData), so BondToken.setReserveOracle() accepts it.
/// In production this would be replaced by a Chainlink Proof of Reserve feed.
contract ReserveOracle is MockFeed {
    constructor(uint8 feedDecimals_, uint256 initialReserve, address admin)
        MockFeed(feedDecimals_, "Bond Reserve (mock PoR)", _toInt(initialReserve), admin)
    {}

    function updateReserve(uint256 newReserve) external onlyRole(FEED_ADMIN_ROLE) {
        _push(_toInt(newReserve));
    }

    /// @notice Part 1 compatibility (IReserveOracle.getReserves)
    function getReserves() external view returns (uint256) {
        int256 answer = latestAnswer();
        return answer < 0 ? 0 : uint256(answer);
    }

    function _toInt(uint256 v) private pure returns (int256) {
        require(v <= uint256(type(int256).max), "value too large");
        return int256(v);
    }
}

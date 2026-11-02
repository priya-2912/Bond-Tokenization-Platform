// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IReserveOracle.sol";

/**
 * @title MockReserveOracle
 * @dev Mock Proof of Reserve feed for testing and local integration.
 */
contract MockReserveOracle is IReserveOracle {
    uint256 private _reserves;
    uint80 private _roundId;

    event ReservesUpdated(uint256 newReserves, uint256 timestamp);

    constructor(uint256 initialReserves) {
        _reserves = initialReserves;
        _roundId = 1;
    }

    function setReserves(uint256 newReserves) external {
        _reserves = newReserves;
        _roundId++;
        emit ReservesUpdated(newReserves, block.timestamp);
    }

    function getReserves() external view override returns (uint256) {
        return _reserves;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, int256(_reserves), block.timestamp, block.timestamp, _roundId);
    }
}

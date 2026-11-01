// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @notice Base for admin-updatable mock feeds that behave like a Chainlink aggregator.
abstract contract MockFeed is AggregatorV3Interface, AccessControl {
    bytes32 public constant FEED_ADMIN_ROLE = keccak256("FEED_ADMIN_ROLE");

    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
    }

    uint8 private immutable _feedDecimals;
    string private _feedDescription;
    uint80 public latestRound;
    mapping(uint80 => Round) private _rounds;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    constructor(uint8 feedDecimals_, string memory feedDescription_, int256 initialAnswer, address admin) {
        require(admin != address(0), "admin is zero address");
        _feedDecimals = feedDecimals_;
        _feedDescription = feedDescription_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FEED_ADMIN_ROLE, admin);
        _push(initialAnswer);
    }

    function decimals() external view override returns (uint8) {
        return _feedDecimals;
    }

    function description() external view override returns (string memory) {
        return _feedDescription;
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        Round memory r = _rounds[_roundId];
        require(r.updatedAt != 0, "No data present");
        return (_roundId, r.answer, r.startedAt, r.updatedAt, _roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        Round memory r = _rounds[latestRound];
        return (latestRound, r.answer, r.startedAt, r.updatedAt, latestRound);
    }

    /// @notice convenience getter for the most recent answer
    function latestAnswer() public view returns (int256) {
        return _rounds[latestRound].answer;
    }

    function _push(int256 answer) internal {
        latestRound += 1;
        _rounds[latestRound] = Round(answer, block.timestamp, block.timestamp);
        emit AnswerUpdated(answer, latestRound, block.timestamp);
    }
}

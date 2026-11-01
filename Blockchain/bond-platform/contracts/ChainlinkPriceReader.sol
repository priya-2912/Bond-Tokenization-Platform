// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

/// @notice Reads a Chainlink price feed (real on Sepolia, mock locally) so the UI can
/// show the bond's value in a second currency, e.g. an ETH amount converted to USD.
contract ChainlinkPriceReader {
    AggregatorV3Interface public immutable feed;

    constructor(address feed_) {
        require(feed_ != address(0), "feed is zero address");
        feed = AggregatorV3Interface(feed_);
    }

    function latestPrice() public view returns (int256 price, uint8 feedDecimals, uint256 updatedAt) {
        (, int256 answer, , uint256 updated, ) = feed.latestRoundData();
        require(answer > 0, "invalid price");
        return (answer, feed.decimals(), updated);
    }

    /// @param baseAmount amount of the base asset (e.g. wei of ETH)
    /// @param baseDecimals decimals of the base asset (18 for ETH)
    /// @return value in quote units scaled by the feed's decimals
    function toQuote(uint256 baseAmount, uint8 baseDecimals) external view returns (uint256) {
        (int256 price, , ) = latestPrice();
        return (baseAmount * uint256(price)) / (10 ** baseDecimals);
    }
}

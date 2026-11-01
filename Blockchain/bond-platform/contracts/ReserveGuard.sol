// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

interface IBondInfo {
    function totalSupply() external view returns (uint256);
    function decimals() external view returns (uint8);
    function faceValue() external view returns (uint256);
}

/// @notice Reserve monitor for the bond. Uses the same maths as Part 1's BondToken:
///   required reserves = totalSupply * faceValue / 10^tokenDecimals   (in face-value currency units)
///   ratio             = reserves / required                           (in basis points)
/// The oracle must report reserves in the same units as faceValue (MockUSDC, 6 decimals).
///
/// Why this exists on top of BondToken's own check: BondToken emits ReserveRatioAlert right
/// before reverting, so that event is rolled back and never appears on-chain. Anyone can call
/// checkAndAlert() here to emit a real, persistent alert (and a "restored" event), which the
/// dashboard and event indexer can read. It also adds a minimum-ratio setting and an optional
/// staleness check.
contract ReserveGuard is AccessControl {
    bytes32 public constant GUARD_ADMIN_ROLE = keccak256("GUARD_ADMIN_ROLE");
    uint256 public constant BPS = 10_000; // 10_000 bps = 100%

    IBondInfo public immutable bond;
    AggregatorV3Interface public reserveFeed;
    uint256 public minRatioBps; // minimum reserves/required, in bps
    uint256 public maxStaleness; // seconds; 0 disables the freshness check
    bool public alertActive;

    event ReserveAlert(uint256 ratioBps, uint256 minRatioBps, uint256 reserves, uint256 required, uint256 timestamp);
    event ReserveRestored(uint256 ratioBps, uint256 minRatioBps, uint256 reserves, uint256 required, uint256 timestamp);
    event ReserveFeedUpdated(address feed);
    event MinRatioUpdated(uint256 minRatioBps);
    event MaxStalenessUpdated(uint256 maxStaleness);

    constructor(address bond_, address feed_, address admin, uint256 minRatioBps_, uint256 maxStaleness_) {
        require(bond_ != address(0) && feed_ != address(0) && admin != address(0), "zero address");
        require(minRatioBps_ > 0, "min ratio is zero");
        bond = IBondInfo(bond_);
        reserveFeed = AggregatorV3Interface(feed_);
        minRatioBps = minRatioBps_;
        maxStaleness = maxStaleness_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARD_ADMIN_ROLE, admin);
    }

    /// @return amount reserves as reported by the oracle (face-value currency units)
    /// @return updatedAt timestamp of the last oracle update
    function reserves() public view returns (uint256 amount, uint256 updatedAt) {
        (, int256 answer, , uint256 updated, ) = reserveFeed.latestRoundData();
        require(answer >= 0, "negative reserve");
        return (uint256(answer), updated);
    }

    /// @notice reserves the bond needs for its current supply
    function requiredReserves() public view returns (uint256) {
        return _required(bond.totalSupply());
    }

    /// @notice reserves / required in bps (type(uint256).max when nothing is required)
    function reserveRatioBps() public view returns (uint256) {
        (uint256 r, ) = reserves();
        uint256 req = requiredReserves();
        if (req == 0) return type(uint256).max;
        return (r * BPS) / req;
    }

    /// @notice true when the oracle is fresh and reserves cover the current supply
    function isHealthy() public view returns (bool) {
        (uint256 r, uint256 u) = reserves();
        return _fresh(u) && r * BPS >= requiredReserves() * minRatioBps;
    }

    /// @notice true when minting `amount` more tokens keeps the ratio at or above the minimum
    function canMint(uint256 amount) external view returns (bool) {
        (uint256 r, uint256 u) = reserves();
        if (!_fresh(u)) return false;
        return r * BPS >= _required(bond.totalSupply() + amount) * minRatioBps;
    }

    /// @notice Callable by anyone. Emits ReserveAlert on the first unhealthy check and
    /// ReserveRestored when the ratio recovers.
    function checkAndAlert() external returns (bool healthy) {
        (uint256 r, uint256 u) = reserves();
        uint256 req = requiredReserves();
        healthy = _fresh(u) && r * BPS >= req * minRatioBps;
        uint256 ratio = req == 0 ? type(uint256).max : (r * BPS) / req;

        if (!healthy && !alertActive) {
            alertActive = true;
            emit ReserveAlert(ratio, minRatioBps, r, req, block.timestamp);
        } else if (healthy && alertActive) {
            alertActive = false;
            emit ReserveRestored(ratio, minRatioBps, r, req, block.timestamp);
        }
    }

    function setReserveFeed(address feed_) external onlyRole(GUARD_ADMIN_ROLE) {
        require(feed_ != address(0), "zero address");
        reserveFeed = AggregatorV3Interface(feed_);
        emit ReserveFeedUpdated(feed_);
    }

    function setMinRatioBps(uint256 v) external onlyRole(GUARD_ADMIN_ROLE) {
        require(v > 0, "min ratio is zero");
        minRatioBps = v;
        emit MinRatioUpdated(v);
    }

    function setMaxStaleness(uint256 v) external onlyRole(GUARD_ADMIN_ROLE) {
        maxStaleness = v;
        emit MaxStalenessUpdated(v);
    }

    function _required(uint256 supply) private view returns (uint256) {
        return (supply * bond.faceValue()) / (10 ** bond.decimals());
    }

    function _fresh(uint256 updatedAt) private view returns (bool) {
        return maxStaleness == 0 || block.timestamp <= updatedAt + maxStaleness;
    }
}

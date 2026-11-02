// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only ERC-20 with a faceValue(), used to unit-test ReserveGuard in isolation.
contract TestToken is ERC20 {
    uint8 private immutable _tokenDecimals;
    uint256 public immutable faceValue;

    constructor(uint8 tokenDecimals_, uint256 faceValue_) ERC20("Test Token", "TST") {
        _tokenDecimals = tokenDecimals_;
        faceValue = faceValue_;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

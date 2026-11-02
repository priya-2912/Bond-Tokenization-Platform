// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IKYCRegistry {
    function isVerified(address account) external view returns (bool);
    function addToWhitelist(address account) external;
    function removeFromWhitelist(address account) external;
}

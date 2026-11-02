// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IKYCRegistry.sol";

/**
 * @title KYCRegistry
 * @dev Manages KYC status whitelist for investors, restricted to COMPLIANCE_ROLE.
 */
contract KYCRegistry is AccessControl, IKYCRegistry {
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    mapping(address => bool) private _whitelist;

    event AddressWhitelisted(address indexed account, address indexed complianceOfficer);
    event AddressRemovedFromWhitelist(address indexed account, address indexed complianceOfficer);

    constructor(address admin, address complianceOfficer) {
        require(admin != address(0), "KYCRegistry: admin cannot be zero address");
        require(complianceOfficer != address(0), "KYCRegistry: complianceOfficer cannot be zero address");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, complianceOfficer);
    }

    /**
     * @notice Add a single account to the KYC whitelist.
     * @param account Address to whitelist.
     */
    function addToWhitelist(address account) external override onlyRole(COMPLIANCE_ROLE) {
        require(account != address(0), "KYCRegistry: invalid address");
        require(!_whitelist[account], "KYCRegistry: address already whitelisted");
        _whitelist[account] = true;
        emit AddressWhitelisted(account, msg.sender);
    }

    /**
     * @notice Remove an account from the KYC whitelist.
     * @param account Address to remove.
     */
    function removeFromWhitelist(address account) external override onlyRole(COMPLIANCE_ROLE) {
        require(account != address(0), "KYCRegistry: invalid address");
        require(_whitelist[account], "KYCRegistry: address not whitelisted");
        _whitelist[account] = false;
        emit AddressRemovedFromWhitelist(account, msg.sender);
    }

    /**
     * @notice Batch add accounts to the KYC whitelist.
     * @param accounts Array of addresses to whitelist.
     */
    function batchAddToWhitelist(address[] calldata accounts) external onlyRole(COMPLIANCE_ROLE) {
        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            require(account != address(0), "KYCRegistry: invalid address");
            if (!_whitelist[account]) {
                _whitelist[account] = true;
                emit AddressWhitelisted(account, msg.sender);
            }
        }
    }

    /**
     * @notice Check if an account is KYC verified.
     * @param account Address to check.
     */
    function isVerified(address account) external view override returns (bool) {
        return _whitelist[account];
    }
}

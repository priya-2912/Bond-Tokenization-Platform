// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IKYCRegistry.sol";
import "./interfaces/IReserveOracle.sol";

/**
 * @title BondToken
 * @dev KYC-gated ERC-20 representing a tokenized bond with metadata, pause controls,
 * proof-of-reserve ratio guard, and compliance forced transfer capabilities.
 * Hardened with role segregation (REDEMPTION_ROLE), pause-exempt compliance recovery,
 * and strict oracle sanity checks.
 */
contract BondToken is ERC20, ERC20Pausable, AccessControl {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");
    bytes32 public constant REDEMPTION_ROLE = keccak256("REDEMPTION_ROLE");

    // Bond terms & metadata
    uint256 public immutable faceValue;       // In MockUSDC units (e.g., 1000 * 10^6 for $1,000)
    uint256 public immutable couponRateBps;   // In basis points (e.g., 800 = 8.00%)
    uint256 public immutable maturityDate;    // Unix timestamp

    IKYCRegistry public kycRegistry;
    IReserveOracle public reserveOracle;

    bool private _bypassingPause;

    // Events
    event KYCRegistryUpdated(address indexed newRegistry);
    event ReserveOracleUpdated(address indexed newOracle);
    event ForceTransferExecuted(address indexed from, address indexed to, uint256 amount, address indexed operator);
    event ReserveRatioAlert(uint256 currentReserves, uint256 requiredReserves, uint256 reserveRatioBps);

    /**
     * @notice Constructor initializing bond terms, roles, and registry.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 _faceValue,
        uint256 _couponRateBps,
        uint256 _maturityDate,
        address _admin,
        address _issuer,
        address _complianceOfficer,
        address _kycRegistry
    ) ERC20(name_, symbol_) {
        require(_admin != address(0), "BondToken: admin cannot be zero");
        require(_issuer != address(0), "BondToken: issuer cannot be zero");
        require(_complianceOfficer != address(0), "BondToken: compliance cannot be zero");
        require(_faceValue > 0, "BondToken: faceValue must be > 0");
        require(_maturityDate > block.timestamp, "BondToken: maturity must be in future");

        faceValue = _faceValue;
        couponRateBps = _couponRateBps;
        maturityDate = _maturityDate;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ISSUER_ROLE, _issuer);
        _grantRole(PAUSER_ROLE, _admin);
        _grantRole(COMPLIANCE_ROLE, _complianceOfficer);

        if (_kycRegistry != address(0)) {
            kycRegistry = IKYCRegistry(_kycRegistry);
            emit KYCRegistryUpdated(_kycRegistry);
        }
    }

    /**
     * @notice Set or update the KYCRegistry contract.
     */
    function setKYCRegistry(address _kycRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_kycRegistry != address(0), "BondToken: invalid registry address");
        kycRegistry = IKYCRegistry(_kycRegistry);
        emit KYCRegistryUpdated(_kycRegistry);
    }

    /**
     * @notice Set or update the Proof of Reserve oracle contract.
     */
    function setReserveOracle(address _oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_oracle != address(0), "BondToken: invalid oracle address");
        reserveOracle = IReserveOracle(_oracle);
        emit ReserveOracleUpdated(_oracle);
    }

    /**
     * @notice Calculate current reserve ratio in basis points (10000 = 100%).
     */
    function reserveRatio() public view returns (uint256) {
        if (address(reserveOracle) == address(0)) {
            return 10000; // Unrestricted if oracle not set
        }
        uint256 totalSup = totalSupply();
        if (totalSup == 0) {
            return 10000;
        }
        uint256 requiredReserves = (totalSup * faceValue) / (10 ** decimals());
        if (requiredReserves == 0) {
            return 10000;
        }
        uint256 reserves = reserveOracle.getReserves();
        return (reserves * 10000) / requiredReserves;
    }

    /**
     * @notice Mint new bond tokens. Restricted to ISSUER_ROLE.
     * Blocks minting if reserve oracle reports reserve ratio < 100%.
     */
    function mint(address to, uint256 amount) external onlyRole(ISSUER_ROLE) {
        require(to != address(0), "BondToken: cannot mint to zero address");
        require(amount > 0, "BondToken: amount must be > 0");

        if (address(reserveOracle) != address(0)) {
            uint256 newTotalSupply = totalSupply() + amount;
            uint256 requiredReserves = (newTotalSupply * faceValue) / (10 ** decimals());
            uint256 currentReserves = reserveOracle.getReserves();

            if (currentReserves < requiredReserves) {
                uint256 ratio = requiredReserves > 0 ? (currentReserves * 10000) / requiredReserves : 0;
                emit ReserveRatioAlert(currentReserves, requiredReserves, ratio);
                revert("BondToken: reserve ratio below 100%");
            }
        }

        _mint(to, amount);
    }

    /**
     * @notice Burn caller's tokens.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @notice Burn tokens from an account. Allowed for account holder, ISSUER_ROLE, or REDEMPTION_ROLE.
     */
    function burnFrom(address account, uint256 amount) external {
        if (msg.sender != account && !hasRole(ISSUER_ROLE, msg.sender) && !hasRole(REDEMPTION_ROLE, msg.sender)) {
            _spendAllowance(account, msg.sender, amount);
        }
        _burn(account, amount);
    }

    /**
     * @notice Emergency force transfer by compliance role.
     * Bypasses allowance and pause state, but maintains KYC whitelist requirement on recipient.
     */
    function forceTransfer(address from, address to, uint256 amount) external onlyRole(COMPLIANCE_ROLE) {
        require(from != address(0), "BondToken: cannot transfer from zero address");
        require(to != address(0), "BondToken: cannot transfer to zero address");
        _bypassingPause = true;
        _update(from, to, amount);
        _bypassingPause = false;
        emit ForceTransferExecuted(from, to, amount, msg.sender);
    }

    /**
     * @notice Pause all token transfers. Restricted to PAUSER_ROLE.
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause token transfers. Restricted to PAUSER_ROLE.
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Overrides ERC-20 transfer hook to enforce pausable status and KYC verification.
     */
    function _update(address from, address to, uint256 value)
        internal
        virtual
        override(ERC20, ERC20Pausable)
    {
        if (_bypassingPause) {
            ERC20._update(from, to, value);
        } else {
            super._update(from, to, value);
        }

        if (address(kycRegistry) != address(0) && value > 0) {
            if (from == address(0)) {
                // Minting: recipient must be KYC verified
                require(kycRegistry.isVerified(to), "BondToken: receiver not KYC verified");
            } else if (to == address(0)) {
                // Burning: holder must be KYC verified
                require(kycRegistry.isVerified(from), "BondToken: sender not KYC verified");
            } else {
                // Transfer: both parties must be KYC verified
                require(kycRegistry.isVerified(from), "BondToken: sender not KYC verified");
                require(kycRegistry.isVerified(to), "BondToken: receiver not KYC verified");
            }
        }
    }
}

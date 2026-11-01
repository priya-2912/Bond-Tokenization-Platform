// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./BondToken.sol";
import "./interfaces/IKYCRegistry.sol";

/**
 * @title CouponDistributor
 * @dev Handles periodic bond coupon payouts based on balance snapshots and
 * full principal redemption at maturity by burning BondTokens.
 */
contract CouponDistributor is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    BondToken public immutable bondToken;
    IERC20 public immutable usdcToken;
    IKYCRegistry public immutable kycRegistry;

    // Snapshot storage: periodId => account => balance
    mapping(uint256 => mapping(address => uint256)) public snapshotBalances;
    // Claim tracking: periodId => account => claimed
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event CouponFundsDeposited(address indexed issuer, uint256 amount);
    event SnapshotRecorded(uint256 indexed periodId, uint256 accountsCount);
    event CouponClaimed(uint256 indexed periodId, address indexed account, uint256 amount);
    event BondRedeemed(address indexed account, uint256 bondAmount, uint256 payoutUSDC);

    constructor(
        address _bondToken,
        address _usdcToken,
        address _kycRegistry,
        address _admin,
        address _issuer
    ) {
        require(_bondToken != address(0), "CouponDistributor: invalid bondToken");
        require(_usdcToken != address(0), "CouponDistributor: invalid usdcToken");
        require(_kycRegistry != address(0), "CouponDistributor: invalid kycRegistry");
        require(_admin != address(0), "CouponDistributor: invalid admin");
        require(_issuer != address(0), "CouponDistributor: invalid issuer");

        bondToken = BondToken(_bondToken);
        usdcToken = IERC20(_usdcToken);
        kycRegistry = IKYCRegistry(_kycRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ISSUER_ROLE, _issuer);
    }

    /**
     * @notice Deposit MockUSDC to fund coupon payouts or redemption liquidity.
     * @param amount Amount of MockUSDC to deposit.
     */
    function depositFunds(uint256 amount) external {
        require(amount > 0, "CouponDistributor: amount must be > 0");
        usdcToken.safeTransferFrom(msg.sender, address(this), amount);
        emit CouponFundsDeposited(msg.sender, amount);
    }

    /**
     * @notice Record bond balance snapshot for a specific coupon period.
     * @param periodId Unique ID for the coupon period.
     * @param accounts Array of bondholders at the snapshot record date.
     * @param balances Array of token balances matching accounts.
     */
    function recordSnapshot(
        uint256 periodId,
        address[] calldata accounts,
        uint256[] calldata balances
    ) external onlyRole(ISSUER_ROLE) {
        require(accounts.length == balances.length, "CouponDistributor: array length mismatch");
        for (uint256 i = 0; i < accounts.length; i++) {
            snapshotBalances[periodId][accounts[i]] = balances[i];
        }
        emit SnapshotRecorded(periodId, accounts.length);
    }

    /**
     * @notice Calculate coupon owed for a given balance.
     */
    function calculateCoupon(uint256 balance) public view returns (uint256) {
        return (balance * bondToken.faceValue() * bondToken.couponRateBps()) /
            (10000 * (10 ** bondToken.decimals()));
    }

    /**
     * @notice Claim accrued coupon payment for an active period.
     * @param periodId ID of the coupon period.
     */
    function claimCoupon(uint256 periodId) external nonReentrant {
        require(kycRegistry.isVerified(msg.sender), "CouponDistributor: caller not KYC verified");
        require(!hasClaimed[periodId][msg.sender], "CouponDistributor: coupon already claimed");

        uint256 balance = snapshotBalances[periodId][msg.sender];
        require(balance > 0, "CouponDistributor: no coupon balance in snapshot");

        uint256 payout = calculateCoupon(balance);
        require(payout > 0, "CouponDistributor: coupon payout is 0");
        require(usdcToken.balanceOf(address(this)) >= payout, "CouponDistributor: insufficient payout funds");

        hasClaimed[periodId][msg.sender] = true;
        usdcToken.safeTransfer(msg.sender, payout);

        emit CouponClaimed(periodId, msg.sender, payout);
    }

    /**
     * @notice Redeem bond tokens at maturity for face value in MockUSDC.
     * Burns the redeemed BondTokens and transfers the principal payout to the holder.
     * @param bondAmount Amount of BondTokens to redeem.
     */
    function redeem(uint256 bondAmount) external nonReentrant {
        require(block.timestamp >= bondToken.maturityDate(), "CouponDistributor: bond has not matured yet");
        require(kycRegistry.isVerified(msg.sender), "CouponDistributor: caller not KYC verified");
        require(bondAmount > 0, "CouponDistributor: bondAmount must be > 0");

        uint256 payoutUSDC = (bondAmount * bondToken.faceValue()) / (10 ** bondToken.decimals());
        require(usdcToken.balanceOf(address(this)) >= payoutUSDC, "CouponDistributor: insufficient redemption funds");

        // Burn caller's bond tokens
        bondToken.burnFrom(msg.sender, bondAmount);

        // Transfer principal payout
        usdcToken.safeTransfer(msg.sender, payoutUSDC);

        emit BondRedeemed(msg.sender, bondAmount, payoutUSDC);
    }
}

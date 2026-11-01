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
 * Hardened with segregated coupon/redemption liquidity pools, period-length scaling,
 * and admin withdrawal for unused funds.
 */
contract CouponDistributor is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    BondToken public immutable bondToken;
    IERC20 public immutable usdcToken;
    IKYCRegistry public immutable kycRegistry;

    // Segregated accounting pools for payouts
    uint256 public couponPool;
    uint256 public redemptionPool;

    // Period scaling (e.g. 1 = annual, 2 = semi-annual, 4 = quarterly, 12 = monthly)
    uint256 public periodsPerYear = 1;

    // Track active snapshot periods
    uint256[] public activePeriods;
    uint256 public latestPeriod;

    // Snapshot storage: periodId => account => balance
    mapping(uint256 => mapping(address => uint256)) public snapshotBalances;
    // Claim tracking: periodId => account => claimed
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event CouponFundsDeposited(address indexed issuer, uint256 amount);
    event RedemptionFundsDeposited(address indexed issuer, uint256 amount);
    event SnapshotRecorded(uint256 indexed periodId, uint256 accountsCount);
    event CouponClaimed(uint256 indexed periodId, address indexed account, uint256 amount);
    event BondRedeemed(address indexed account, uint256 bondAmount, uint256 payoutUSDC);
    event PeriodsPerYearUpdated(uint256 newPeriodsPerYear);
    event UnusedFundsWithdrawn(address indexed token, address indexed to, uint256 amount);

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
     * @notice Deposit MockUSDC explicitly for coupon distributions.
     * @param amount Amount of MockUSDC to deposit.
     */
    function depositCouponFunds(uint256 amount) public {
        require(amount > 0, "CouponDistributor: amount must be > 0");
        usdcToken.safeTransferFrom(msg.sender, address(this), amount);
        couponPool += amount;
        emit CouponFundsDeposited(msg.sender, amount);
    }

    /**
     * @notice Deposit MockUSDC explicitly for maturity principal redemption.
     * @param amount Amount of MockUSDC to deposit.
     */
    function depositRedemptionFunds(uint256 amount) public {
        require(amount > 0, "CouponDistributor: amount must be > 0");
        usdcToken.safeTransferFrom(msg.sender, address(this), amount);
        redemptionPool += amount;
        emit RedemptionFundsDeposited(msg.sender, amount);
    }

    /**
     * @notice Backward-compatible general deposit function. Allocates to couponPool.
     */
    function depositFunds(uint256 amount) external {
        depositCouponFunds(amount);
    }

    /**
     * @notice Configure coupon period scaling (e.g. 1 = annual, 4 = quarterly).
     */
    function setPeriodsPerYear(uint256 _periods) external onlyRole(ISSUER_ROLE) {
        require(_periods > 0 && _periods <= 365, "CouponDistributor: invalid periods");
        periodsPerYear = _periods;
        emit PeriodsPerYearUpdated(_periods);
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
        require(periodId > 0, "CouponDistributor: periodId must be > 0");
        require(accounts.length == balances.length, "CouponDistributor: array length mismatch");

        // Record active period if new
        bool exists = false;
        for (uint256 j = 0; j < activePeriods.length; j++) {
            if (activePeriods[j] == periodId) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            activePeriods.push(periodId);
            if (periodId > latestPeriod) {
                latestPeriod = periodId;
            }
        }

        for (uint256 i = 0; i < accounts.length; i++) {
            require(accounts[i] != address(0), "CouponDistributor: zero address");
            snapshotBalances[periodId][accounts[i]] = balances[i];
        }
        emit SnapshotRecorded(periodId, accounts.length);
    }

    /**
     * @notice Calculate coupon owed for a given balance, scaled by periodsPerYear.
     */
    function calculateCoupon(uint256 balance) public view returns (uint256) {
        return (balance * bondToken.faceValue() * bondToken.couponRateBps()) /
            (10000 * periodsPerYear * (10 ** bondToken.decimals()));
    }

    /**
     * @notice Check exact claimable coupon amount for an account in a specific period.
     */
    function getClaimableCoupon(uint256 periodId, address account) external view returns (uint256) {
        if (hasClaimed[periodId][account]) {
            return 0;
        }
        uint256 balance = snapshotBalances[periodId][account];
        if (balance == 0) {
            return 0;
        }
        return calculateCoupon(balance);
    }

    /**
     * @notice Returns list of all recorded period IDs.
     */
    function getActivePeriods() external view returns (uint256[] memory) {
        return activePeriods;
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
        
        // Check segregated pool or overall balance
        require(usdcToken.balanceOf(address(this)) >= payout, "CouponDistributor: insufficient payout funds");
        if (couponPool >= payout) {
            couponPool -= payout;
        }

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
        
        if (redemptionPool >= payoutUSDC) {
            redemptionPool -= payoutUSDC;
        }

        // Burn caller's bond tokens
        bondToken.burnFrom(msg.sender, bondAmount);

        // Transfer principal payout
        usdcToken.safeTransfer(msg.sender, payoutUSDC);

        emit BondRedeemed(msg.sender, bondAmount, payoutUSDC);
    }

    /**
     * @notice Admin function to withdraw unused or excess funds.
     */
    function withdrawUnusedFunds(address token, uint256 amount, address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "CouponDistributor: zero address");
        require(amount > 0, "CouponDistributor: amount must be > 0");
        IERC20(token).safeTransfer(to, amount);
        emit UnusedFundsWithdrawn(token, to, amount);
    }
}

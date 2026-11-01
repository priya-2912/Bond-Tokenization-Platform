// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IKYCRegistry.sol";

/**
 * @title Marketplace
 * @dev KYC-compliant secondary market order book for trading BondTokens against MockUSDC.
 * Sellers lock BondTokens into escrow. Buyers purchase with MockUSDC.
 * Hardened with batch querying, pagination, and clean lifecycle management.
 */
contract Marketplace is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        uint256 id;
        address seller;
        uint256 bondAmount;
        uint256 priceInUSDC;
        bool isActive;
    }

    IERC20 public immutable bondToken;
    IERC20 public immutable usdcToken;
    IKYCRegistry public immutable kycRegistry;

    uint256 public nextOrderId = 1;
    mapping(uint256 => Order) public orders;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed seller,
        uint256 bondAmount,
        uint256 priceInUSDC
    );
    event OrderFilled(
        uint256 indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 bondAmount,
        uint256 priceInUSDC
    );
    event OrderCancelled(uint256 indexed orderId, address indexed seller);

    constructor(
        address _bondToken,
        address _usdcToken,
        address _kycRegistry
    ) {
        require(_bondToken != address(0), "Marketplace: invalid bondToken");
        require(_usdcToken != address(0), "Marketplace: invalid usdcToken");
        require(_kycRegistry != address(0), "Marketplace: invalid kycRegistry");

        bondToken = IERC20(_bondToken);
        usdcToken = IERC20(_usdcToken);
        kycRegistry = IKYCRegistry(_kycRegistry);
    }

    /**
     * @notice Create a sell order and deposit bond tokens into escrow.
     * @param bondAmount Amount of BondTokens to sell.
     * @param priceInUSDC Total price in MockUSDC requested for the lot.
     */
    function createSellOrder(uint256 bondAmount, uint256 priceInUSDC)
        external
        nonReentrant
        returns (uint256)
    {
        require(kycRegistry.isVerified(msg.sender), "Marketplace: seller not KYC verified");
        require(bondAmount > 0, "Marketplace: bondAmount must be > 0");
        require(priceInUSDC > 0, "Marketplace: price must be > 0");

        uint256 orderId = nextOrderId++;
        orders[orderId] = Order({
            id: orderId,
            seller: msg.sender,
            bondAmount: bondAmount,
            priceInUSDC: priceInUSDC,
            isActive: true
        });

        // Escrow bond tokens from seller to marketplace
        bondToken.safeTransferFrom(msg.sender, address(this), bondAmount);

        emit OrderCreated(orderId, msg.sender, bondAmount, priceInUSDC);
        return orderId;
    }

    /**
     * @notice Buy an active order by paying the specified price in MockUSDC.
     * @param orderId ID of the sell order.
     */
    function buy(uint256 orderId) external nonReentrant {
        require(kycRegistry.isVerified(msg.sender), "Marketplace: buyer not KYC verified");

        Order storage order = orders[orderId];
        require(order.isActive, "Marketplace: order not active");
        require(kycRegistry.isVerified(order.seller), "Marketplace: seller no longer KYC verified");

        order.isActive = false;

        // Transfer payment from buyer to seller
        usdcToken.safeTransferFrom(msg.sender, order.seller, order.priceInUSDC);

        // Release escrowed BondTokens to buyer
        bondToken.safeTransfer(msg.sender, order.bondAmount);

        emit OrderFilled(orderId, msg.sender, order.seller, order.bondAmount, order.priceInUSDC);
    }

    /**
     * @notice Cancel an active order and reclaim escrowed BondTokens.
     * @param orderId ID of the sell order.
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.isActive, "Marketplace: order not active");
        require(order.seller == msg.sender, "Marketplace: caller not seller");

        order.isActive = false;

        // Refund escrowed BondTokens to seller
        bondToken.safeTransfer(order.seller, order.bondAmount);

        emit OrderCancelled(orderId, msg.sender);
    }

    /**
     * @notice Fetch single order details.
     */
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    /**
     * @notice Fetch all active orders in one call to avoid one-by-one frontend loops.
     */
    function getActiveOrders() external view returns (Order[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < nextOrderId; i++) {
            if (orders[i].isActive) {
                count++;
            }
        }
        Order[] memory active = new Order[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i < nextOrderId; i++) {
            if (orders[i].isActive) {
                active[idx++] = orders[i];
            }
        }
        return active;
    }

    /**
     * @notice Fetch orders with pagination.
     * @param offset Starting order index (1-based).
     * @param limit Max number of orders to return.
     */
    function getOrders(uint256 offset, uint256 limit) external view returns (Order[] memory) {
        if (offset == 0 || offset >= nextOrderId || limit == 0) {
            return new Order[](0);
        }
        uint256 end = offset + limit;
        if (end > nextOrderId) {
            end = nextOrderId;
        }
        uint256 total = end - offset;
        Order[] memory result = new Order[](total);
        for (uint256 i = 0; i < total; i++) {
            result[i] = orders[offset + i];
        }
        return result;
    }
}

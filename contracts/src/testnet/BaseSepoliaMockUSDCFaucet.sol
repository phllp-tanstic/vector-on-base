// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Finite-inventory mUSDC faucet fixture for Base Sepolia demos only.
contract BaseSepoliaMockUSDCFaucet {
    using SafeERC20 for IERC20;

    uint256 public constant CLAIM_AMOUNT = 10_000_000;
    uint256 public constant CLAIM_COOLDOWN = 24 hours;

    IERC20 public immutable mockUSDC;
    mapping(address recipient => uint256 timestamp) public lastClaimAt;
    mapping(address recipient => bool claimed) private hasClaimed;

    error InvalidMockUSDC();
    error ClaimCooldownActive(address recipient, uint256 availableAt);
    error FaucetInventoryExhausted(uint256 available, uint256 required);

    event DemoTokensClaimed(address indexed recipient, uint256 amount);

    constructor(address mockUSDC_) {
        if (mockUSDC_ == address(0)) revert InvalidMockUSDC();
        mockUSDC = IERC20(mockUSDC_);
    }

    /// @notice Transfers exactly 10 mUSDC from this fixture's finite inventory to the caller.
    function claim() external {
        uint256 previousClaimAt = lastClaimAt[msg.sender];
        uint256 availableAt = previousClaimAt + CLAIM_COOLDOWN;
        if (hasClaimed[msg.sender] && block.timestamp < availableAt) {
            revert ClaimCooldownActive(msg.sender, availableAt);
        }

        uint256 inventory = mockUSDC.balanceOf(address(this));
        if (inventory < CLAIM_AMOUNT) revert FaucetInventoryExhausted(inventory, CLAIM_AMOUNT);

        lastClaimAt[msg.sender] = block.timestamp;
        hasClaimed[msg.sender] = true;
        mockUSDC.safeTransfer(msg.sender, CLAIM_AMOUNT);
        emit DemoTokensClaimed(msg.sender, CLAIM_AMOUNT);
    }
}

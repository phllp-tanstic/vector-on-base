// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Base Sepolia-only fixed-rate router for exercising VectorExecutor.
/// @dev The configured 100:1 base-unit rate maps 6-decimal mUSDC to an equal number of
///      8-decimal NOTB20 whole tokens. This contract is not a price source or production router.
contract MockExecutionRouter {
    using SafeERC20 for IERC20;

    uint256 public constant BUY_UNITS_PER_SELL_UNIT = 100;

    IERC20 public immutable sellToken;
    IERC20 public immutable buyToken;

    error InvalidToken(address token);
    error IdenticalTokens();
    error ZeroSellAmount();
    error InvalidRecipient(address recipient);
    error UnauthorizedPayer(address caller, address payer);
    error SellAmountExceedsAllowance(uint256 sellAmount, uint256 allowance);

    constructor(address sellToken_, address buyToken_) {
        if (sellToken_ == address(0)) revert InvalidToken(sellToken_);
        if (buyToken_ == address(0)) revert InvalidToken(buyToken_);
        if (sellToken_ == buyToken_) revert IdenticalTokens();

        sellToken = IERC20(sellToken_);
        buyToken = IERC20(buyToken_);
    }

    function buyAmountFor(uint256 sellAmount) public pure returns (uint256) {
        return Math.mulDiv(sellAmount, BUY_UNITS_PER_SELL_UNIT, 1);
    }

    /// @notice Pulls no more than the allowance granted by `payer` and transfers fixed-rate output.
    function executeSwap(address payer, address outputRecipient, uint256 sellAmount)
        external
        returns (uint256 buyAmount)
    {
        if (payer != msg.sender) revert UnauthorizedPayer(msg.sender, payer);
        if (sellAmount == 0) revert ZeroSellAmount();
        if (outputRecipient == address(0)) revert InvalidRecipient(outputRecipient);

        uint256 boundedAllowance = sellToken.allowance(payer, address(this));
        if (sellAmount > boundedAllowance) {
            revert SellAmountExceedsAllowance(sellAmount, boundedAllowance);
        }

        buyAmount = buyAmountFor(sellAmount);
        sellToken.safeTransferFrom(payer, address(this), sellAmount);
        buyToken.safeTransfer(outputRecipient, buyAmount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MockERC20} from "./MockERC20.sol";

contract MockExecutionRouter {
    using SafeERC20 for IERC20;

    error MockRouterFailure();
    error NativeRefundFailure();

    uint256 public maximumAllowanceObserved;
    uint256 public totalSellPulled;
    bool public reentrantCallSucceeded;
    bytes4 public reentrantRevertSelector;

    address private _reentrantTarget;
    bytes private _reentrantData;
    bool private _forceFailure;
    uint256 private _nativeRefundAmount;

    function configureFailure(bool forceFailure) external {
        _forceFailure = forceFailure;
    }

    function configureNativeRefund(uint256 amount) external {
        _nativeRefundAmount = amount;
    }

    function configureReentry(address target, bytes calldata data) external {
        _reentrantTarget = target;
        _reentrantData = data;
    }

    function executeSwap(
        address sellToken,
        address buyToken,
        address payer,
        address outputRecipient,
        uint256 sellAmount,
        uint256 buyAmount
    ) external payable {
        if (_forceFailure) revert MockRouterFailure();

        if (_reentrantTarget != address(0)) {
            (bool reentrantSuccess, bytes memory returnData) = _reentrantTarget.call(_reentrantData);
            reentrantCallSucceeded = reentrantSuccess;
            if (returnData.length >= 4) {
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(returnData, 0x20))
                }
                reentrantRevertSelector = selector;
            }
        }

        uint256 allowance = IERC20(sellToken).allowance(payer, address(this));
        if (allowance > maximumAllowanceObserved) maximumAllowanceObserved = allowance;

        IERC20(sellToken).safeTransferFrom(payer, address(this), sellAmount);
        totalSellPulled += sellAmount;
        MockERC20(buyToken).mint(outputRecipient, buyAmount);

        if (_nativeRefundAmount != 0) {
            (bool refunded,) = payable(payer).call{value: _nativeRefundAmount}("");
            if (!refunded) revert NativeRefundFailure();
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";

import {VectorExecutor} from "../src/VectorExecutor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockExecutionRouter} from "./mocks/MockExecutionRouter.sol";

contract VectorExecutorHandler {
    uint256 private constant MAX_ACTION_AMOUNT = 1_000_000 ether;

    VectorExecutor public immutable executor;
    MockERC20 public immutable sellToken;
    MockERC20 public immutable buyToken;
    MockExecutionRouter public immutable router;

    uint256 public totalSuccessfulMaximumSell;
    uint256 public maximumSuccessfulSell;
    bool public duplicateNonceSucceeded;
    bool public excessiveSellSucceeded;
    bool public insufficientBuySucceeded;
    bool public unapprovedTargetSucceeded;

    constructor(VectorExecutor executor_, MockERC20 sellToken_, MockERC20 buyToken_, MockExecutionRouter router_) {
        executor = executor_;
        sellToken = sellToken_;
        buyToken = buyToken_;
        router = router_;
        sellToken_.approve(address(executor_), type(uint256).max);
    }

    function trade(uint96 rawSell, uint96 rawOutput, uint96 rawMinimum, uint256 nonce) external {
        uint256 sellAmount = uint256(rawSell) % MAX_ACTION_AMOUNT + 1;
        uint256 outputAmount = uint256(rawOutput) % MAX_ACTION_AMOUNT + 1;
        uint256 minimumAmount = uint256(rawMinimum) % MAX_ACTION_AMOUNT + 1;
        bool nonceWasUsed = executor.usedNonce(address(this), nonce);

        sellToken.mint(address(this), sellAmount);
        VectorExecutor.ExecutionIntent memory intent =
            _intent(sellAmount, outputAmount, minimumAmount, nonce, address(router));

        try executor.execute(intent) returns (bytes32, uint256 actualSellAmount, uint256 actualBuyAmount) {
            if (nonceWasUsed) duplicateNonceSucceeded = true;
            if (actualSellAmount > sellAmount) excessiveSellSucceeded = true;
            if (actualBuyAmount < minimumAmount) insufficientBuySucceeded = true;
            totalSuccessfulMaximumSell += sellAmount;
            if (sellAmount > maximumSuccessfulSell) maximumSuccessfulSell = sellAmount;
        } catch {}
    }

    function attemptUnapprovedTarget(address target, uint256 nonce) external {
        if (target == address(router) || target == address(0)) return;

        uint256 sellAmount = 1 ether;
        sellToken.mint(address(this), sellAmount);
        VectorExecutor.ExecutionIntent memory intent = _intent(sellAmount, 1 ether, 1, nonce, target);

        try executor.execute(intent) {
            unapprovedTargetSucceeded = true;
        } catch {}
    }

    function _intent(
        uint256 sellAmount,
        uint256 outputAmount,
        uint256 minimumAmount,
        uint256 nonce,
        address executionTarget
    ) private view returns (VectorExecutor.ExecutionIntent memory) {
        return VectorExecutor.ExecutionIntent({
            owner: address(this),
            sellToken: address(sellToken),
            buyToken: address(buyToken),
            sellAmount: sellAmount,
            minBuyAmount: minimumAmount,
            recipient: address(this),
            executionTarget: executionTarget,
            allowanceTarget: address(router),
            callValue: 0,
            deadline: block.timestamp,
            nonce: nonce,
            executionData: abi.encodeCall(
                MockExecutionRouter.executeSwap,
                (address(sellToken), address(buyToken), address(executor), address(executor), sellAmount, outputAmount)
            )
        });
    }
}

contract VectorExecutorInvariantTest is Test {
    VectorExecutor private executor;
    MockERC20 private sellToken;
    MockERC20 private buyToken;
    MockExecutionRouter private router;
    VectorExecutorHandler private handler;

    function setUp() public {
        executor = new VectorExecutor(address(this));
        sellToken = new MockERC20("Invariant Sell", "ISELL");
        buyToken = new MockERC20("Invariant Buy", "IBUY");
        router = new MockExecutionRouter();
        handler = new VectorExecutorHandler(executor, sellToken, buyToken, router);

        executor.setSupportedAsset(address(sellToken), true);
        executor.setSupportedAsset(address(buyToken), true);
        executor.setExecutionTargetApproval(address(router), true);
        executor.setAllowanceTargetApproval(address(router), true);

        targetContract(address(handler));
    }

    function invariant_ExecutorRetainsNoTradeFundsOrAllowance() public view {
        assertEq(sellToken.balanceOf(address(executor)), 0);
        assertEq(buyToken.balanceOf(address(executor)), 0);
        assertEq(sellToken.allowance(address(executor), address(router)), 0);
    }

    function invariant_RouterCannotPullBeyondSuccessfulMaximums() public view {
        assertEq(router.totalSellPulled(), handler.totalSuccessfulMaximumSell());
        assertLe(router.maximumAllowanceObserved(), handler.maximumSuccessfulSell());
    }

    function invariant_SuccessAlwaysMeetsSpendOutputAndReplayRules() public view {
        assertFalse(handler.excessiveSellSucceeded());
        assertFalse(handler.insufficientBuySucceeded());
        assertFalse(handler.duplicateNonceSucceeded());
    }

    function invariant_UnapprovedTargetNeverSucceeds() public view {
        assertFalse(handler.unapprovedTargetSucceeded());
    }
}

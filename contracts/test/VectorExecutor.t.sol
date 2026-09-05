// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Test} from "forge-std/Test.sol";

import {VectorExecutor} from "../src/VectorExecutor.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockExecutionRouter} from "./mocks/MockExecutionRouter.sol";
import {MockFeeOnTransferERC20} from "./mocks/MockFeeOnTransferERC20.sol";

contract VectorExecutorTest is Test {
    event IntentExecuted(
        bytes32 indexed executionId,
        address indexed owner,
        uint256 indexed nonce,
        address sellToken,
        address buyToken,
        address recipient,
        uint256 maximumSellAmount,
        uint256 actualSellAmount,
        uint256 actualBuyAmount
    );
    event IntentCancelled(address indexed owner, uint256 indexed nonce);
    event AssetSupportUpdated(address indexed asset, bool supported);
    event ExecutionTargetApprovalUpdated(address indexed target, bool approved);
    event AllowanceTargetApprovalUpdated(address indexed target, bool approved);

    uint256 private constant START_TIME = 1_800_000_000;
    uint256 private constant OWNER_BALANCE = 1_000_000 ether;

    address private ownerAccount;
    address private recipient;
    address private attacker;
    VectorExecutor private executor;
    MockERC20 private sellToken;
    MockERC20 private buyToken;
    MockExecutionRouter private router;

    function setUp() public {
        ownerAccount = makeAddr("owner");
        recipient = makeAddr("recipient");
        attacker = makeAddr("attacker");

        executor = new VectorExecutor(address(this));
        sellToken = new MockERC20("Sell Token", "SELL");
        buyToken = new MockERC20("Buy Token", "BUY");
        router = new MockExecutionRouter();

        executor.setSupportedAsset(address(sellToken), true);
        executor.setSupportedAsset(address(buyToken), true);
        executor.setExecutionTargetApproval(address(router), true);
        executor.setAllowanceTargetApproval(address(router), true);

        sellToken.mint(ownerAccount, OWNER_BALANCE);
        vm.prank(ownerAccount);
        sellToken.approve(address(executor), type(uint256).max);
        vm.deal(ownerAccount, 100 ether);
        vm.warp(START_TIME);
    }

    function test_ExecuteSelectorMatchesTypedPlanAbi() public pure {
        bytes4 expected = bytes4(
            keccak256(
                "execute((address,address,address,uint256,uint256,address,address,address,uint256,uint256,uint256,bytes))"
            )
        );
        assertEq(VectorExecutor.execute.selector, expected);
        assertEq(VectorExecutor.execute.selector, bytes4(0xa79dd7fa));
    }

    function test_ExecutesExactSellAndLeavesNoCurrentTradeFundsOrAllowance() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(100 ether, 125 ether, 120 ether, 1);

        vm.prank(ownerAccount);
        (bytes32 executionId, uint256 actualSell, uint256 actualBuy) = executor.execute(intent);

        assertEq(executionId, executor.hashExecutionIntent(intent));
        assertEq(actualSell, 100 ether);
        assertEq(actualBuy, 125 ether);
        assertEq(sellToken.balanceOf(ownerAccount), OWNER_BALANCE - 100 ether);
        assertEq(sellToken.balanceOf(address(router)), 100 ether);
        assertEq(buyToken.balanceOf(recipient), 125 ether);
        assertEq(sellToken.balanceOf(address(executor)), 0);
        assertEq(buyToken.balanceOf(address(executor)), 0);
        assertEq(sellToken.allowance(address(executor), address(router)), 0);
        assertEq(router.maximumAllowanceObserved(), 100 ether);
        assertTrue(executor.usedNonce(ownerAccount, 1));
    }

    function test_AllowanceHolderShapedFlowUsesExactApprovalsAndRefundsUnusedSell() public {
        uint256 sellMaximum = 100 ether;
        uint256 sellUsed = 60 ether;
        uint256 buyReceived = 75 ether;
        uint256 minimumBuy = 70 ether;
        uint256 nonce = 32;

        vm.startPrank(ownerAccount);
        sellToken.approve(address(executor), 0);
        sellToken.approve(address(executor), sellMaximum);
        vm.stopPrank();

        VectorExecutor.ExecutionIntent memory intent =
            _intentWithRoute(sellMaximum, sellUsed, buyReceived, minimumBuy, nonce, address(executor));
        assertEq(intent.executionTarget, intent.allowanceTarget);
        assertEq(sellToken.allowance(ownerAccount, address(executor)), sellMaximum);

        vm.prank(ownerAccount);
        (, uint256 actualSell, uint256 actualBuy) = executor.execute(intent);

        assertEq(actualSell, sellUsed);
        assertEq(actualBuy, buyReceived);
        assertGe(actualBuy, minimumBuy);
        assertEq(sellToken.allowance(ownerAccount, address(executor)), 0);
        assertEq(router.maximumAllowanceObserved(), sellMaximum);
        assertEq(sellToken.allowance(address(executor), address(router)), 0);
        assertEq(sellToken.balanceOf(ownerAccount), OWNER_BALANCE - sellUsed);
        assertEq(sellToken.balanceOf(address(router)), sellUsed);
        assertEq(sellToken.balanceOf(address(executor)), 0);
        assertEq(buyToken.balanceOf(recipient), buyReceived);
        assertTrue(executor.usedNonce(ownerAccount, nonce));
    }

    function test_EmitsDeterministicExecutionEvent() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(100 ether, 125 ether, 120 ether, 2);
        bytes32 executionId = executor.hashExecutionIntent(intent);

        vm.expectEmit(true, true, true, true, address(executor));
        emit IntentExecuted(
            executionId,
            ownerAccount,
            2,
            address(sellToken),
            address(buyToken),
            recipient,
            100 ether,
            100 ether,
            125 ether
        );
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RefundsUnusedSellAmount() public {
        VectorExecutor.ExecutionIntent memory intent =
            _intentWithRoute(100 ether, 60 ether, 75 ether, 70 ether, 3, address(executor));

        vm.prank(ownerAccount);
        (, uint256 actualSell, uint256 actualBuy) = executor.execute(intent);

        assertEq(actualSell, 60 ether);
        assertEq(actualBuy, 75 ether);
        assertEq(sellToken.balanceOf(ownerAccount), OWNER_BALANCE - 60 ether);
        assertEq(sellToken.balanceOf(address(router)), 60 ether);
        assertEq(sellToken.balanceOf(address(executor)), 0);
        assertEq(sellToken.allowance(address(executor), address(router)), 0);
    }

    function test_PreservesPreexistingExecutorTokenBalances() public {
        sellToken.mint(address(executor), 7 ether);
        buyToken.mint(address(executor), 9 ether);
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 28);

        vm.prank(ownerAccount);
        executor.execute(intent);

        assertEq(sellToken.balanceOf(address(executor)), 7 ether);
        assertEq(buyToken.balanceOf(address(executor)), 9 ether);
        assertEq(buyToken.balanceOf(recipient), 12 ether);
    }

    function test_AcceptsExactDeadlineBoundary() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 12 ether, 4);
        intent.deadline = block.timestamp;

        vm.prank(ownerAccount);
        executor.execute(intent);

        assertTrue(executor.usedNonce(ownerAccount, 4));
    }

    function test_AcceptsExactMinimumOutputBoundary() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 12 ether, 5);

        vm.prank(ownerAccount);
        (,, uint256 actualBuy) = executor.execute(intent);

        assertEq(actualBuy, intent.minBuyAmount);
    }

    function test_RevertsForWrongCaller() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 6);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.UnauthorizedCaller.selector, attacker, ownerAccount));
        vm.prank(attacker);
        executor.execute(intent);
    }

    function test_RevertsForUnsupportedSellAsset() public {
        executor.setSupportedAsset(address(sellToken), false);
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 7);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.UnsupportedAsset.selector, address(sellToken)));
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RevertsForUnsupportedBuyAsset() public {
        executor.setSupportedAsset(address(buyToken), false);
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 8);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.UnsupportedAsset.selector, address(buyToken)));
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RevertsForIdenticalAssets() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 29);
        intent.buyToken = address(sellToken);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.IdenticalAssets.selector, address(sellToken)));
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RevertsForUnapprovedExecutionTarget() public {
        MockExecutionRouter otherRouter = new MockExecutionRouter();
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 9);
        intent.executionTarget = address(otherRouter);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.UnapprovedExecutionTarget.selector, address(otherRouter)));
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RevertsForUnapprovedAllowanceTarget() public {
        MockExecutionRouter otherRouter = new MockExecutionRouter();
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 10);
        intent.allowanceTarget = address(otherRouter);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.UnapprovedAllowanceTarget.selector, address(otherRouter)));
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RevertsForZeroSellAmount() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 11);
        intent.sellAmount = 0;

        vm.expectRevert(VectorExecutor.ZeroSellAmount.selector);
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RevertsForZeroMinimumOutput() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 12);
        intent.minBuyAmount = 0;

        vm.expectRevert(VectorExecutor.ZeroMinimumBuyAmount.selector);
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RevertsForZeroOrExecutorRecipient() public {
        VectorExecutor.ExecutionIntent memory zeroRecipient = _intent(10 ether, 12 ether, 10 ether, 13);
        zeroRecipient.recipient = address(0);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.InvalidRecipient.selector, address(0)));
        vm.prank(ownerAccount);
        executor.execute(zeroRecipient);

        VectorExecutor.ExecutionIntent memory executorRecipient = _intent(10 ether, 12 ether, 10 ether, 14);
        executorRecipient.recipient = address(executor);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.InvalidRecipient.selector, address(executor)));
        vm.prank(ownerAccount);
        executor.execute(executorRecipient);
    }

    function test_RevertsAfterDeadline() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 15);
        intent.deadline = block.timestamp - 1;

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.IntentExpired.selector, intent.deadline, block.timestamp));
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RevertsForUsedNonce() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 16);
        vm.prank(ownerAccount);
        executor.execute(intent);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.NonceAlreadyUsed.selector, ownerAccount, intent.nonce));
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RevertsBelowMinimumAndRollsBackNonceAndTransfers() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 9 ether, 10 ether, 17);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.MinimumOutputNotMet.selector, 10 ether, 9 ether));
        vm.prank(ownerAccount);
        executor.execute(intent);

        assertFalse(executor.usedNonce(ownerAccount, 17));
        assertEq(sellToken.balanceOf(ownerAccount), OWNER_BALANCE);
        assertEq(sellToken.balanceOf(address(router)), 0);
        assertEq(buyToken.balanceOf(recipient), 0);
        assertEq(sellToken.allowance(address(executor), address(router)), 0);
    }

    function test_RejectsShortFundingFromTransferTaxSellToken() public {
        MockFeeOnTransferERC20 taxedSell = new MockFeeOnTransferERC20("Taxed Sell", "TSELL", 100);
        executor.setSupportedAsset(address(taxedSell), true);
        taxedSell.mint(ownerAccount, 100 ether);
        vm.prank(ownerAccount);
        taxedSell.approve(address(executor), 100 ether);

        VectorExecutor.ExecutionIntent memory intent = _intent(100 ether, 125 ether, 100 ether, 30);
        intent.sellToken = address(taxedSell);
        intent.executionData = abi.encodeCall(
            MockExecutionRouter.executeSwap,
            (address(taxedSell), address(buyToken), address(executor), address(executor), 100 ether, 125 ether)
        );

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.SellInvariantViolation.selector, 100 ether, 99 ether));
        vm.prank(ownerAccount);
        executor.execute(intent);

        assertFalse(executor.usedNonce(ownerAccount, 30));
        assertEq(taxedSell.balanceOf(ownerAccount), 100 ether);
    }

    function test_RequiresActualRecipientDeltaAfterTransferTax() public {
        MockFeeOnTransferERC20 taxedBuy = new MockFeeOnTransferERC20("Taxed Buy", "TBUY", 100);
        executor.setSupportedAsset(address(taxedBuy), true);

        VectorExecutor.ExecutionIntent memory intent = _intent(100 ether, 100 ether, 100 ether, 31);
        intent.buyToken = address(taxedBuy);
        intent.executionData = abi.encodeCall(
            MockExecutionRouter.executeSwap,
            (address(sellToken), address(taxedBuy), address(executor), address(executor), 100 ether, 100 ether)
        );

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.MinimumOutputNotMet.selector, 100 ether, 99 ether));
        vm.prank(ownerAccount);
        executor.execute(intent);

        assertFalse(executor.usedNonce(ownerAccount, 31));
        assertEq(taxedBuy.balanceOf(recipient), 0);
    }

    function test_WrapsFailedRouterCallAndRollsBackNonce() public {
        router.configureFailure(true);
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 18);

        vm.expectRevert(
            abi.encodeWithSelector(
                VectorExecutor.ExecutionCallFailed.selector,
                abi.encodeWithSelector(MockExecutionRouter.MockRouterFailure.selector)
            )
        );
        vm.prank(ownerAccount);
        executor.execute(intent);

        assertFalse(executor.usedNonce(ownerAccount, 18));
        assertEq(sellToken.balanceOf(ownerAccount), OWNER_BALANCE);
    }

    function test_BoundedAllowancePreventsAttemptedOverspend() public {
        VectorExecutor.ExecutionIntent memory intent =
            _intentWithRoute(10 ether, 10 ether + 1, 12 ether, 10 ether, 19, recipient);

        bytes memory allowanceError = abi.encodeWithSignature(
            "ERC20InsufficientAllowance(address,uint256,uint256)", address(router), 10 ether, 10 ether + 1
        );
        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.ExecutionCallFailed.selector, allowanceError));
        vm.prank(ownerAccount);
        executor.execute(intent);

        assertFalse(executor.usedNonce(ownerAccount, 19));
        assertEq(sellToken.balanceOf(ownerAccount), OWNER_BALANCE);
        assertEq(sellToken.balanceOf(address(router)), 0);
        assertEq(sellToken.allowance(address(executor), address(router)), 0);
    }

    function test_RejectsRouterOutputSentToWrongRecipient() public {
        VectorExecutor.ExecutionIntent memory intent =
            _intentWithRoute(10 ether, 10 ether, 12 ether, 10 ether, 20, attacker);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.MinimumOutputNotMet.selector, 10 ether, 0));
        vm.prank(ownerAccount);
        executor.execute(intent);

        assertEq(buyToken.balanceOf(attacker), 0);
        assertFalse(executor.usedNonce(ownerAccount, 20));
    }

    function test_BlocksReentrantExecutionCallback() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 21);
        router.configureReentry(address(executor), abi.encodeCall(VectorExecutor.execute, (intent)));

        vm.prank(ownerAccount);
        executor.execute(intent);

        assertFalse(router.reentrantCallSucceeded());
        assertEq(router.reentrantRevertSelector(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertTrue(executor.usedNonce(ownerAccount, 21));
    }

    function test_OnlyOwnerCanUpdateAllowlists() public {
        vm.startPrank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        executor.setSupportedAsset(address(sellToken), false);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        executor.setExecutionTargetApproval(address(router), false);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        executor.setAllowanceTargetApproval(address(router), false);
        vm.stopPrank();
    }

    function test_AdminUpdatesEmitEventsAndChangeState() public {
        vm.expectEmit(true, false, false, true, address(executor));
        emit AssetSupportUpdated(address(sellToken), false);
        executor.setSupportedAsset(address(sellToken), false);
        assertFalse(executor.supportedAssets(address(sellToken)));

        vm.expectEmit(true, false, false, true, address(executor));
        emit ExecutionTargetApprovalUpdated(address(router), false);
        executor.setExecutionTargetApproval(address(router), false);
        assertFalse(executor.approvedExecutionTargets(address(router)));

        vm.expectEmit(true, false, false, true, address(executor));
        emit AllowanceTargetApprovalUpdated(address(router), false);
        executor.setAllowanceTargetApproval(address(router), false);
        assertFalse(executor.approvedAllowanceTargets(address(router)));
    }

    function test_AdminCannotEnableEOAAsAllowlistedContract() public {
        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.InvalidContract.selector, attacker));
        executor.setSupportedAsset(attacker, true);
        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.InvalidContract.selector, attacker));
        executor.setExecutionTargetApproval(attacker, true);
        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.InvalidContract.selector, attacker));
        executor.setAllowanceTargetApproval(attacker, true);
    }

    function test_OwnershipTransferRequiresAcceptance() public {
        executor.transferOwnership(attacker);
        assertEq(executor.owner(), address(this));
        assertEq(executor.pendingOwner(), attacker);

        vm.prank(attacker);
        executor.acceptOwnership();
        assertEq(executor.owner(), attacker);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        executor.setSupportedAsset(address(sellToken), false);
    }

    function test_CancelledNonceCannotExecute() public {
        vm.expectEmit(true, true, false, true, address(executor));
        emit IntentCancelled(ownerAccount, 22);
        vm.prank(ownerAccount);
        executor.cancelNonce(22);

        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 22);
        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.NonceAlreadyUsed.selector, ownerAccount, 22));
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RevertsWhenCancellingUsedNonce() public {
        vm.prank(ownerAccount);
        executor.cancelNonce(23);

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.NonceAlreadyUsed.selector, ownerAccount, 23));
        vm.prank(ownerAccount);
        executor.cancelNonce(23);
    }

    function test_ForwardsExactCallValueAndRefundsReturnedNativeValue() public {
        uint256 callValue = 1 ether;
        uint256 nativeRefund = 0.4 ether;
        router.configureNativeRefund(nativeRefund);
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 24);
        intent.callValue = callValue;
        uint256 ownerNativeBefore = ownerAccount.balance;

        vm.prank(ownerAccount);
        executor.execute{value: callValue}(intent);

        assertEq(ownerAccount.balance, ownerNativeBefore - callValue + nativeRefund);
        assertEq(address(router).balance, callValue - nativeRefund);
        assertEq(address(executor).balance, 0);
    }

    function test_RevertsForIncorrectCallValue() public {
        VectorExecutor.ExecutionIntent memory intent = _intent(10 ether, 12 ether, 10 ether, 25);
        intent.callValue = 1 ether;

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.InvalidCallValue.selector, 1 ether, 0));
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function test_RejectsNativeTransfersOutsideExecution() public {
        (bool success, bytes memory returnData) = address(executor).call{value: 1}("");
        assertFalse(success);
        assertEq(bytes4(returnData), VectorExecutor.UnexpectedNativeTransfer.selector);
    }

    function testFuzz_ExactSellAmountsRemainBounded(uint128 rawSellAmount, uint256 nonce) public {
        uint256 sellAmount = bound(uint256(rawSellAmount), 1, OWNER_BALANCE);
        VectorExecutor.ExecutionIntent memory intent = _intent(sellAmount, sellAmount, 1, nonce);

        vm.prank(ownerAccount);
        (, uint256 actualSell,) = executor.execute(intent);

        assertEq(actualSell, sellAmount);
        assertEq(router.maximumAllowanceObserved(), sellAmount);
        assertEq(sellToken.allowance(address(executor), address(router)), 0);
        assertTrue(executor.usedNonce(ownerAccount, nonce));
    }

    function testFuzz_MinimumOutputBoundary(uint96 rawOutput, uint96 rawMinimum) public {
        uint256 output = bound(uint256(rawOutput), 1, type(uint96).max);
        uint256 minimum = bound(uint256(rawMinimum), 1, type(uint96).max);
        VectorExecutor.ExecutionIntent memory intent = _intent(1 ether, output, minimum, 26);

        if (output < minimum) {
            vm.expectRevert(abi.encodeWithSelector(VectorExecutor.MinimumOutputNotMet.selector, minimum, output));
        }
        vm.prank(ownerAccount);
        executor.execute(intent);

        assertEq(buyToken.balanceOf(recipient), output >= minimum ? output : 0);
    }

    function testFuzz_DeadlineBoundary(uint32 rawDeadline) public {
        uint256 deadline = bound(uint256(rawDeadline), START_TIME - 1_000, START_TIME + 1_000);
        VectorExecutor.ExecutionIntent memory intent = _intent(1 ether, 1 ether, 1, 27);
        intent.deadline = deadline;

        if (deadline < block.timestamp) {
            vm.expectRevert(abi.encodeWithSelector(VectorExecutor.IntentExpired.selector, deadline, block.timestamp));
        }
        vm.prank(ownerAccount);
        executor.execute(intent);

        assertEq(executor.usedNonce(ownerAccount, 27), deadline >= block.timestamp);
    }

    function testFuzz_ArbitraryNonceIsConsumedOnlyAfterSuccess(uint256 nonce) public {
        VectorExecutor.ExecutionIntent memory intent = _intent(1 ether, 1 ether, 1, nonce);

        vm.prank(ownerAccount);
        executor.execute(intent);
        assertTrue(executor.usedNonce(ownerAccount, nonce));

        vm.expectRevert(abi.encodeWithSelector(VectorExecutor.NonceAlreadyUsed.selector, ownerAccount, nonce));
        vm.prank(ownerAccount);
        executor.execute(intent);
    }

    function _intent(uint256 sellAmount, uint256 buyAmount, uint256 minBuyAmount, uint256 nonce)
        private
        view
        returns (VectorExecutor.ExecutionIntent memory)
    {
        return _intentWithRoute(sellAmount, sellAmount, buyAmount, minBuyAmount, nonce, address(executor));
    }

    function _intentWithRoute(
        uint256 maximumSellAmount,
        uint256 routerSellAmount,
        uint256 buyAmount,
        uint256 minBuyAmount,
        uint256 nonce,
        address outputRecipient
    ) private view returns (VectorExecutor.ExecutionIntent memory) {
        return VectorExecutor.ExecutionIntent({
            owner: ownerAccount,
            sellToken: address(sellToken),
            buyToken: address(buyToken),
            sellAmount: maximumSellAmount,
            minBuyAmount: minBuyAmount,
            recipient: recipient,
            executionTarget: address(router),
            allowanceTarget: address(router),
            callValue: 0,
            deadline: block.timestamp + 300,
            nonce: nonce,
            executionData: abi.encodeCall(
                MockExecutionRouter.executeSwap,
                (address(sellToken), address(buyToken), address(executor), outputRecipient, routerSellAmount, buyAmount)
            )
        });
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";

import {VectorExecutor} from "../src/VectorExecutor.sol";
import {MockB20LikeToken} from "../src/testnet/BaseSepoliaMockB20LikeToken.sol";
import {MockExecutionRouter} from "../src/testnet/BaseSepoliaMockExecutionRouter.sol";
import {MockUSDC} from "../src/testnet/BaseSepoliaMockUSDC.sol";

contract BaseSepoliaFixturesTest is Test {
    MockUSDC private mockUSDC;
    MockB20LikeToken private mockB20LikeToken;
    MockExecutionRouter private router;

    address private payer;
    address private recipient;

    function setUp() public {
        payer = makeAddr("payer");
        recipient = makeAddr("recipient");
        mockUSDC = new MockUSDC();
        mockB20LikeToken = new MockB20LikeToken();
        router = new MockExecutionRouter(address(mockUSDC), address(mockB20LikeToken));

        mockUSDC.mint(payer, 20 * 10 ** 6);
        mockB20LikeToken.mint(address(router), 20 * 10 ** 8);
    }

    function test_FixtureIdentityAndDecimalsAreExplicit() public view {
        assertEq(mockUSDC.name(), "Vector Base Sepolia Mock USDC");
        assertEq(mockUSDC.symbol(), "mUSDC");
        assertEq(mockUSDC.decimals(), 6);
        assertEq(mockB20LikeToken.name(), "Vector Mock - NOT A REAL B20 ASSET");
        assertEq(mockB20LikeToken.symbol(), "NOTB20");
        assertEq(mockB20LikeToken.decimals(), 8);
    }

    function test_TransfersDeterministicOutputWithinBoundedAllowance() public {
        uint256 allowance = 12 * 10 ** 6;
        uint256 sellAmount = 10 * 10 ** 6;

        vm.prank(payer);
        mockUSDC.approve(address(router), allowance);

        vm.prank(payer);
        uint256 buyAmount = router.executeSwap(payer, recipient, sellAmount);

        assertEq(buyAmount, 10 * 10 ** 8);
        assertEq(mockUSDC.balanceOf(payer), 10 * 10 ** 6);
        assertEq(mockUSDC.balanceOf(address(router)), sellAmount);
        assertEq(mockUSDC.allowance(payer, address(router)), allowance - sellAmount);
        assertEq(mockB20LikeToken.balanceOf(recipient), buyAmount);
    }

    function test_RevertsRatherThanExceedingBoundedAllowance() public {
        uint256 allowance = 5 * 10 ** 6;
        uint256 sellAmount = allowance + 1;

        vm.prank(payer);
        mockUSDC.approve(address(router), allowance);

        vm.expectRevert(
            abi.encodeWithSelector(MockExecutionRouter.SellAmountExceedsAllowance.selector, sellAmount, allowance)
        );
        vm.prank(payer);
        router.executeSwap(payer, recipient, sellAmount);
    }

    function test_RouterExecutesThroughVectorExecutorAndLeavesNoAllowance() public {
        uint256 sellAmount = 10 * 10 ** 6;
        uint256 expectedBuyAmount = 10 * 10 ** 8;
        VectorExecutor executor = new VectorExecutor(address(this));
        executor.setSupportedAsset(address(mockUSDC), true);
        executor.setSupportedAsset(address(mockB20LikeToken), true);
        executor.setExecutionTargetApproval(address(router), true);
        executor.setAllowanceTargetApproval(address(router), true);

        vm.prank(payer);
        mockUSDC.approve(address(executor), sellAmount);

        VectorExecutor.ExecutionIntent memory intent = VectorExecutor.ExecutionIntent({
            owner: payer,
            sellToken: address(mockUSDC),
            buyToken: address(mockB20LikeToken),
            sellAmount: sellAmount,
            minBuyAmount: expectedBuyAmount,
            recipient: recipient,
            executionTarget: address(router),
            allowanceTarget: address(router),
            callValue: 0,
            deadline: block.timestamp + 1 hours,
            nonce: 1,
            executionData: abi.encodeCall(
                MockExecutionRouter.executeSwap, (address(executor), address(executor), sellAmount)
            )
        });

        vm.prank(payer);
        (, uint256 actualSellAmount, uint256 actualBuyAmount) = executor.execute(intent);

        assertEq(actualSellAmount, sellAmount);
        assertEq(actualBuyAmount, expectedBuyAmount);
        assertEq(mockB20LikeToken.balanceOf(recipient), expectedBuyAmount);
        assertEq(mockUSDC.allowance(address(executor), address(router)), 0);
    }
}

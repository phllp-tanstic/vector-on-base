// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";

import {BaseSepoliaMockUSDCFaucet} from "../src/testnet/BaseSepoliaMockUSDCFaucet.sol";
import {MockUSDC} from "../src/testnet/BaseSepoliaMockUSDC.sol";

contract BaseSepoliaMockUSDCFaucetTest is Test {
    uint256 private constant CLAIM_AMOUNT = 10_000_000;
    uint256 private constant INVENTORY = 1_000_000_000;

    MockUSDC private mockUSDC;
    BaseSepoliaMockUSDCFaucet private faucet;
    address private alice;
    address private bob;

    event DemoTokensClaimed(address indexed recipient, uint256 amount);

    function setUp() public {
        mockUSDC = new MockUSDC();
        faucet = new BaseSepoliaMockUSDCFaucet(address(mockUSDC));
        mockUSDC.mint(address(faucet), INVENTORY);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        vm.warp(2 days);
    }

    function test_ConstructorRejectsZeroToken() public {
        vm.expectRevert(BaseSepoliaMockUSDCFaucet.InvalidMockUSDC.selector);
        new BaseSepoliaMockUSDCFaucet(address(0));
    }

    function test_FirstClaimTransfersExactAmountToCallerAndEmitsEvent() public {
        uint256 supplyBefore = mockUSDC.totalSupply();
        vm.expectEmit(true, false, false, true, address(faucet));
        emit DemoTokensClaimed(alice, CLAIM_AMOUNT);

        vm.prank(alice);
        faucet.claim();

        assertEq(mockUSDC.balanceOf(alice), CLAIM_AMOUNT);
        assertEq(mockUSDC.balanceOf(address(faucet)), INVENTORY - CLAIM_AMOUNT);
        assertEq(mockUSDC.totalSupply(), supplyBefore, "claim must transfer, not mint");
        assertEq(faucet.lastClaimAt(alice), block.timestamp);
    }

    function test_SecondClaimInsideCooldownReverts() public {
        vm.prank(alice);
        faucet.claim();
        uint256 availableAt = block.timestamp + 24 hours;

        vm.expectRevert(
            abi.encodeWithSelector(BaseSepoliaMockUSDCFaucet.ClaimCooldownActive.selector, alice, availableAt)
        );
        vm.prank(alice);
        faucet.claim();
    }

    function test_ClaimAtCooldownBoundarySucceeds() public {
        vm.prank(alice);
        faucet.claim();
        vm.warp(block.timestamp + 24 hours);

        vm.prank(alice);
        faucet.claim();

        assertEq(mockUSDC.balanceOf(alice), CLAIM_AMOUNT * 2);
    }

    function test_ExhaustedInventoryFailsCleanly() public {
        BaseSepoliaMockUSDCFaucet emptyFaucet = new BaseSepoliaMockUSDCFaucet(address(mockUSDC));
        vm.expectRevert(
            abi.encodeWithSelector(BaseSepoliaMockUSDCFaucet.FaucetInventoryExhausted.selector, 0, CLAIM_AMOUNT)
        );
        vm.prank(alice);
        emptyFaucet.claim();
    }

    function test_UsersHaveIndependentCooldowns() public {
        vm.prank(alice);
        faucet.claim();
        vm.prank(bob);
        faucet.claim();

        assertEq(mockUSDC.balanceOf(alice), CLAIM_AMOUNT);
        assertEq(mockUSDC.balanceOf(bob), CLAIM_AMOUNT);
        assertEq(faucet.lastClaimAt(alice), faucet.lastClaimAt(bob));
    }

    function test_NoArbitraryAmountOrRecipientEntryPointExists() public {
        vm.prank(alice);
        (bool amountSucceeded,) = address(faucet).call(abi.encodeWithSignature("claim(uint256)", 1));
        assertFalse(amountSucceeded);

        vm.prank(alice);
        (bool recipientSucceeded,) = address(faucet).call(abi.encodeWithSignature("claim(address)", bob));
        assertFalse(recipientSucceeded);
        assertEq(mockUSDC.balanceOf(alice), 0);
        assertEq(mockUSDC.balanceOf(bob), 0);
    }
}

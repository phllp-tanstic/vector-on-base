// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script, console2} from "forge-std/Script.sol";

import {MockUSDC} from "../src/testnet/BaseSepoliaMockUSDC.sol";

contract MintBaseSepoliaMockUSDC is Script {
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 private constant DEFAULT_MINT_AMOUNT = 10 * 10 ** 6;
    uint256 private constant MAXIMUM_MINT_AMOUNT = 100 * 10 ** 6;

    error WrongChain(uint256 expected, uint256 actual);
    error InvalidMockUSDC(address token);
    error InvalidSmartAccount(address account);
    error InvalidMintAmount(uint256 amount, uint256 maximum);

    function run() external {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(BASE_SEPOLIA_CHAIN_ID, block.chainid);
        }

        address mockUSDCAddress = vm.envAddress("VECTOR_TEST_MOCK_USDC_ADDRESS");
        address smartAccount = vm.envAddress("VECTOR_TEST_SMART_ACCOUNT");
        uint256 amount = vm.envOr("VECTOR_TEST_MOCK_USDC_MINT_AMOUNT", DEFAULT_MINT_AMOUNT);

        if (mockUSDCAddress == address(0) || mockUSDCAddress.code.length == 0) {
            revert InvalidMockUSDC(mockUSDCAddress);
        }
        if (smartAccount == address(0)) revert InvalidSmartAccount(smartAccount);
        if (amount == 0 || amount > MAXIMUM_MINT_AMOUNT) {
            revert InvalidMintAmount(amount, MAXIMUM_MINT_AMOUNT);
        }

        vm.startBroadcast();
        MockUSDC(mockUSDCAddress).mint(smartAccount, amount);
        vm.stopBroadcast();

        console2.log("MockUSDC", mockUSDCAddress);
        console2.log("Recipient Smart Account", smartAccount);
        console2.log("Minted mUSDC base units", amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script, console2} from "forge-std/Script.sol";

import {BaseSepoliaMockUSDCFaucet} from "../src/testnet/BaseSepoliaMockUSDCFaucet.sol";
import {MockUSDC} from "../src/testnet/BaseSepoliaMockUSDC.sol";

contract DeployBaseSepoliaDemoFaucet is Script {
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 private constant INITIAL_INVENTORY = 1_000_000_000;

    error WrongChain(uint256 expected, uint256 actual);
    error InvalidMockUSDC(address token);
    error InventoryFundingFailed(uint256 expected, uint256 actual);

    function run() external returns (BaseSepoliaMockUSDCFaucet faucet) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(BASE_SEPOLIA_CHAIN_ID, block.chainid);
        }

        address mockUSDCAddress = vm.envAddress("VECTOR_TEST_MOCK_USDC_ADDRESS");
        if (mockUSDCAddress == address(0) || mockUSDCAddress.code.length == 0) {
            revert InvalidMockUSDC(mockUSDCAddress);
        }

        // Forge supplies the signer from the CLI account/keystore. No private key is read from env.
        vm.startBroadcast();
        faucet = new BaseSepoliaMockUSDCFaucet(mockUSDCAddress);
        MockUSDC(mockUSDCAddress).mint(address(faucet), INITIAL_INVENTORY);
        vm.stopBroadcast();

        uint256 fundedInventory = MockUSDC(mockUSDCAddress).balanceOf(address(faucet));
        if (fundedInventory != INITIAL_INVENTORY) {
            revert InventoryFundingFailed(INITIAL_INVENTORY, fundedInventory);
        }

        console2.log("Base Sepolia demo faucet", address(faucet));
        console2.log("Initial mUSDC inventory (base units)", fundedInventory);
    }
}

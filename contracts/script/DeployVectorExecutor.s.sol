// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script, console2} from "forge-std/Script.sol";
import {VectorExecutor} from "../src/VectorExecutor.sol";

contract DeployVectorExecutor is Script {
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84_532;

    error WrongChain(uint256 expected, uint256 actual);
    error InvalidInitialOwner();

    function run() external returns (VectorExecutor executor) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(BASE_SEPOLIA_CHAIN_ID, block.chainid);
        }

        address initialOwner = vm.envAddress("VECTOR_OWNER_ADDRESS");
        if (initialOwner == address(0)) revert InvalidInitialOwner();

        // The signer comes from Forge CLI account/keystore configuration. This script never reads a key.
        vm.startBroadcast();
        executor = new VectorExecutor(initialOwner);
        vm.stopBroadcast();

        console2.log("VectorExecutor owner", initialOwner);
        console2.log("VectorExecutor deployed", address(executor));
        // Forge's broadcast receipt prints and records the deployment transaction hash.
    }
}

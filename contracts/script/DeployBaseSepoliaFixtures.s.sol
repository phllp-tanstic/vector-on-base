// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script, console2} from "forge-std/Script.sol";

import {MockB20LikeToken} from "../src/testnet/BaseSepoliaMockB20LikeToken.sol";
import {MockExecutionRouter} from "../src/testnet/BaseSepoliaMockExecutionRouter.sol";
import {MockUSDC} from "../src/testnet/BaseSepoliaMockUSDC.sol";

contract DeployBaseSepoliaFixtures is Script {
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    uint256 private constant ROUTER_BUY_LIQUIDITY = 1_000_000 * 10 ** 8;

    error WrongChain(uint256 expected, uint256 actual);

    function run() external returns (MockUSDC mockUSDC, MockB20LikeToken mockB20LikeToken, MockExecutionRouter router) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(BASE_SEPOLIA_CHAIN_ID, block.chainid);
        }

        // Forge supplies the signer from the CLI account/keystore. No private key is read from env.
        vm.startBroadcast();
        mockUSDC = new MockUSDC();
        mockB20LikeToken = new MockB20LikeToken();
        router = new MockExecutionRouter(address(mockUSDC), address(mockB20LikeToken));
        mockB20LikeToken.mint(address(router), ROUTER_BUY_LIQUIDITY);
        vm.stopBroadcast();

        console2.log("MockUSDC", address(mockUSDC));
        console2.log("MockB20LikeToken", address(mockB20LikeToken));
        console2.log("MockExecutionRouter", address(router));
        console2.log("Router NOTB20 liquidity", ROUTER_BUY_LIQUIDITY);
    }
}

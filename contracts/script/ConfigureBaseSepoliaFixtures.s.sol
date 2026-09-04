// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script, console2} from "forge-std/Script.sol";

import {VectorExecutor} from "../src/VectorExecutor.sol";

contract ConfigureBaseSepoliaFixtures is Script {
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    VectorExecutor private constant EXECUTOR = VectorExecutor(payable(0x6F638384B3d750F902CE74Fd98a8536C3D8b8EdE));

    error WrongChain(uint256 expected, uint256 actual);
    error InvalidFixtureContract(address fixture);
    error DuplicateFixtureAddress(address fixture);

    function run() external {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) {
            revert WrongChain(BASE_SEPOLIA_CHAIN_ID, block.chainid);
        }
        if (address(EXECUTOR).code.length == 0) revert InvalidFixtureContract(address(EXECUTOR));

        address mockUSDC = vm.envAddress("VECTOR_TEST_MOCK_USDC_ADDRESS");
        address mockB20LikeToken = vm.envAddress("VECTOR_TEST_MOCK_B20_LIKE_TOKEN_ADDRESS");
        address router = vm.envAddress("VECTOR_TEST_MOCK_EXECUTION_ROUTER_ADDRESS");

        _requireContract(mockUSDC);
        _requireContract(mockB20LikeToken);
        _requireContract(router);
        if (mockUSDC == mockB20LikeToken || mockUSDC == router) revert DuplicateFixtureAddress(mockUSDC);
        if (mockB20LikeToken == router) revert DuplicateFixtureAddress(mockB20LikeToken);

        vm.startBroadcast();
        EXECUTOR.setSupportedAsset(mockUSDC, true);
        EXECUTOR.setSupportedAsset(mockB20LikeToken, true);
        EXECUTOR.setExecutionTargetApproval(router, true);
        EXECUTOR.setAllowanceTargetApproval(router, true);
        vm.stopBroadcast();

        console2.log("VectorExecutor", address(EXECUTOR));
        console2.log("Supported MockUSDC", mockUSDC);
        console2.log("Supported MockB20LikeToken", mockB20LikeToken);
        console2.log("Approved execution and allowance target", router);
    }

    function _requireContract(address fixture) private view {
        if (fixture == address(0) || fixture.code.length == 0) revert InvalidFixtureContract(fixture);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Base Sepolia-only faucet token. This is not Circle-issued USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("Vector Base Sepolia Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Unrestricted by design so test accounts can fund themselves on testnet.
    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

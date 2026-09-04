// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Base Sepolia-only ERC-20 fixture. It does not implement or represent a real B20 asset.
contract MockB20LikeToken is ERC20 {
    constructor() ERC20("Vector Mock - NOT A REAL B20 ASSET", "NOTB20") {}

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    /// @notice Unrestricted testnet mint used only to seed deterministic router liquidity.
    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

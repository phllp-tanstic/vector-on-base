// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {MockERC20} from "./MockERC20.sol";

contract MockFeeOnTransferERC20 is MockERC20 {
    uint256 private immutable _feeBps;

    constructor(string memory name, string memory symbol, uint256 feeBps) MockERC20(name, symbol) {
        _feeBps = feeBps;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || _feeBps == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * _feeBps) / 10_000;
        super._update(from, address(0), fee);
        super._update(from, to, value - fee);
    }
}

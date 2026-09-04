// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice Test-only atomic call dispatcher for the local authorization E2E harness.
/// @dev This is not a Coinbase Smart Account and must never be deployed outside local tests.
contract LocalAuthorizationHarness {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    error UnauthorizedHarnessCaller(address caller);
    error HarnessCallFailed(uint256 index, bytes returnData);
    error InvalidHarnessOwner();

    address public immutable OWNER;

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidHarnessOwner();
        OWNER = owner_;
    }

    function executeBatch(Call[] calldata calls) external payable returns (bytes[] memory results) {
        if (msg.sender != OWNER) revert UnauthorizedHarnessCaller(msg.sender);

        results = new bytes[](calls.length);
        for (uint256 index = 0; index < calls.length; ++index) {
            (bool success, bytes memory returnData) = calls[index].to.call{value: calls[index].value}(calls[index].data);
            if (!success) revert HarnessCallFailed(index, returnData);
            results[index] = returnData;
        }
    }
}

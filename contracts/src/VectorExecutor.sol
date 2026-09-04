// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @title VectorExecutor
/// @notice Executes a user-authorized, offchain-validated exact-sell instruction.
/// @dev Opaque router calldata is constrained by allowlists, exact allowance, and balance deltas.
contract VectorExecutor is Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 private constant EXECUTION_DOMAIN = keccak256("VECTOR_EXECUTION_V1");

    struct ExecutionIntent {
        address owner;
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        address recipient;
        address executionTarget;
        address allowanceTarget;
        uint256 callValue;
        uint256 deadline;
        uint256 nonce;
        bytes executionData;
    }

    error UnauthorizedCaller(address caller, address expectedOwner);
    error UnsupportedAsset(address asset);
    error UnapprovedExecutionTarget(address target);
    error UnapprovedAllowanceTarget(address target);
    error IntentExpired(uint256 deadline, uint256 currentTimestamp);
    error NonceAlreadyUsed(address owner, uint256 nonce);
    error ZeroSellAmount();
    error ZeroMinimumBuyAmount();
    error InvalidRecipient(address recipient);
    error IdenticalAssets(address asset);
    error InvalidCallValue(uint256 expected, uint256 actual);
    error ExecutionCallFailed(bytes returnData);
    error MinimumOutputNotMet(uint256 minimum, uint256 actual);
    error SellInvariantViolation(uint256 maximumSellAmount, uint256 observedSellAmount);
    error BuyInvariantViolation(uint256 balanceBefore, uint256 balanceAfter);
    error InvalidContract(address account);
    error UnexpectedNativeTransfer();
    error NativeRefundFailed(address recipient, uint256 amount);

    event IntentExecuted(
        bytes32 indexed executionId,
        address indexed owner,
        uint256 indexed nonce,
        address sellToken,
        address buyToken,
        address recipient,
        uint256 maximumSellAmount,
        uint256 actualSellAmount,
        uint256 actualBuyAmount
    );
    event IntentCancelled(address indexed owner, uint256 indexed nonce);
    event AssetSupportUpdated(address indexed asset, bool supported);
    event ExecutionTargetApprovalUpdated(address indexed target, bool approved);
    event AllowanceTargetApprovalUpdated(address indexed target, bool approved);

    mapping(address asset => bool supported) public supportedAssets;
    mapping(address target => bool approved) public approvedExecutionTargets;
    mapping(address target => bool approved) public approvedAllowanceTargets;
    mapping(address intentOwner => mapping(uint256 nonce => bool consumed)) public usedNonce;

    address private _activeNativeRefundOwner;

    constructor(address initialOwner) Ownable(initialOwner) {}

    receive() external payable {
        if (_activeNativeRefundOwner == address(0)) revert UnexpectedNativeTransfer();
    }

    function setSupportedAsset(address asset, bool supported) external onlyOwner {
        _requireContractWhenEnabling(asset, supported);
        supportedAssets[asset] = supported;
        emit AssetSupportUpdated(asset, supported);
    }

    function setExecutionTargetApproval(address target, bool approved) external onlyOwner {
        _requireContractWhenEnabling(target, approved);
        approvedExecutionTargets[target] = approved;
        emit ExecutionTargetApprovalUpdated(target, approved);
    }

    function setAllowanceTargetApproval(address target, bool approved) external onlyOwner {
        _requireContractWhenEnabling(target, approved);
        approvedAllowanceTargets[target] = approved;
        emit AllowanceTargetApprovalUpdated(target, approved);
    }

    /// @notice Irreversibly consumes one caller-owned nonce.
    function cancelNonce(uint256 nonce) external {
        if (usedNonce[msg.sender][nonce]) revert NonceAlreadyUsed(msg.sender, nonce);
        usedNonce[msg.sender][nonce] = true;
        emit IntentCancelled(msg.sender, nonce);
    }

    /// @notice Executes an intent directly authorized by its owner.
    /// @return executionId Domain-separated identifier for this exact instruction.
    /// @return actualSellAmount Amount removed from the executor during the router call.
    /// @return actualBuyAmount Amount actually delivered to the required recipient.
    function execute(ExecutionIntent calldata intent)
        external
        payable
        nonReentrant
        returns (bytes32 executionId, uint256 actualSellAmount, uint256 actualBuyAmount)
    {
        _validateIntent(intent);

        // Consumption precedes every untrusted token/router interaction. Any later revert rolls it back atomically.
        usedNonce[intent.owner][intent.nonce] = true;
        executionId = hashExecutionIntent(intent);

        IERC20 sellToken = IERC20(intent.sellToken);
        IERC20 buyToken = IERC20(intent.buyToken);
        uint256 buyBalanceBefore = buyToken.balanceOf(address(this));
        (uint256 sellBalanceBefore, uint256 sellBalanceFunded) = _fundSell(intent, sellToken);
        uint256 nativeBalanceBefore = _callExecution(intent, sellToken);
        actualSellAmount = _settleSell(intent, sellToken, sellBalanceBefore, sellBalanceFunded);
        actualBuyAmount = _settleBuy(intent, buyToken, buyBalanceBefore);
        _refundNative(intent.owner, nativeBalanceBefore);

        _emitIntentExecuted(intent, executionId, actualSellAmount, actualBuyAmount);
    }

    function hashExecutionIntent(ExecutionIntent calldata intent) public view returns (bytes32) {
        return keccak256(abi.encode(EXECUTION_DOMAIN, block.chainid, address(this), intent));
    }

    function _validateIntent(ExecutionIntent calldata intent) private view {
        if (intent.owner != msg.sender) revert UnauthorizedCaller(msg.sender, intent.owner);
        if (!supportedAssets[intent.sellToken]) revert UnsupportedAsset(intent.sellToken);
        if (!supportedAssets[intent.buyToken]) revert UnsupportedAsset(intent.buyToken);
        if (intent.sellToken == intent.buyToken) revert IdenticalAssets(intent.sellToken);
        if (!approvedExecutionTargets[intent.executionTarget]) {
            revert UnapprovedExecutionTarget(intent.executionTarget);
        }
        if (!approvedAllowanceTargets[intent.allowanceTarget]) {
            revert UnapprovedAllowanceTarget(intent.allowanceTarget);
        }
        if (intent.sellAmount == 0) revert ZeroSellAmount();
        if (intent.minBuyAmount == 0) revert ZeroMinimumBuyAmount();
        if (intent.recipient == address(0) || intent.recipient == address(this)) {
            revert InvalidRecipient(intent.recipient);
        }
        if (block.timestamp > intent.deadline) {
            revert IntentExpired(intent.deadline, block.timestamp);
        }
        if (usedNonce[intent.owner][intent.nonce]) {
            revert NonceAlreadyUsed(intent.owner, intent.nonce);
        }
        if (msg.value != intent.callValue) revert InvalidCallValue(intent.callValue, msg.value);
    }

    function _fundSell(ExecutionIntent calldata intent, IERC20 sellToken)
        private
        returns (uint256 balanceBefore, uint256 balanceFunded)
    {
        balanceBefore = sellToken.balanceOf(address(this));
        sellToken.safeTransferFrom(intent.owner, address(this), intent.sellAmount);
        balanceFunded = sellToken.balanceOf(address(this));

        if (balanceFunded < balanceBefore || balanceFunded - balanceBefore != intent.sellAmount) {
            uint256 fundedAmount = balanceFunded >= balanceBefore ? balanceFunded - balanceBefore : 0;
            revert SellInvariantViolation(intent.sellAmount, fundedAmount);
        }
    }

    function _callExecution(ExecutionIntent calldata intent, IERC20 sellToken)
        private
        returns (uint256 nativeBalanceBefore)
    {
        sellToken.forceApprove(intent.allowanceTarget, intent.sellAmount);
        nativeBalanceBefore = address(this).balance - msg.value;

        _activeNativeRefundOwner = intent.owner;
        (bool success, bytes memory returnData) =
            intent.executionTarget.call{value: intent.callValue}(intent.executionData);
        delete _activeNativeRefundOwner;

        if (!success) revert ExecutionCallFailed(returnData);
        sellToken.forceApprove(intent.allowanceTarget, 0);
    }

    function _settleSell(
        ExecutionIntent calldata intent,
        IERC20 sellToken,
        uint256 balanceBefore,
        uint256 balanceFunded
    ) private returns (uint256 actualSellAmount) {
        uint256 balanceAfterExecution = sellToken.balanceOf(address(this));
        if (balanceAfterExecution < balanceBefore) {
            uint256 overspentAmount = intent.sellAmount + balanceBefore - balanceAfterExecution;
            revert SellInvariantViolation(intent.sellAmount, overspentAmount);
        }
        if (balanceAfterExecution > balanceFunded) {
            revert SellInvariantViolation(intent.sellAmount, 0);
        }

        uint256 unusedSellAmount = balanceAfterExecution - balanceBefore;
        actualSellAmount = intent.sellAmount - unusedSellAmount;
        if (unusedSellAmount != 0) sellToken.safeTransfer(intent.owner, unusedSellAmount);
        if (sellToken.balanceOf(address(this)) != balanceBefore) {
            revert SellInvariantViolation(intent.sellAmount, actualSellAmount);
        }
    }

    function _settleBuy(ExecutionIntent calldata intent, IERC20 buyToken, uint256 balanceBefore)
        private
        returns (uint256 actualBuyAmount)
    {
        uint256 balanceAfterExecution = buyToken.balanceOf(address(this));
        if (balanceAfterExecution < balanceBefore) {
            revert BuyInvariantViolation(balanceBefore, balanceAfterExecution);
        }

        uint256 receivedByExecutor = balanceAfterExecution - balanceBefore;
        if (receivedByExecutor < intent.minBuyAmount) {
            revert MinimumOutputNotMet(intent.minBuyAmount, receivedByExecutor);
        }

        uint256 recipientBalanceBefore = buyToken.balanceOf(intent.recipient);
        buyToken.safeTransfer(intent.recipient, receivedByExecutor);
        uint256 recipientBalanceAfter = buyToken.balanceOf(intent.recipient);
        if (recipientBalanceAfter < recipientBalanceBefore) {
            revert BuyInvariantViolation(recipientBalanceBefore, recipientBalanceAfter);
        }

        actualBuyAmount = recipientBalanceAfter - recipientBalanceBefore;
        if (actualBuyAmount < intent.minBuyAmount) {
            revert MinimumOutputNotMet(intent.minBuyAmount, actualBuyAmount);
        }

        uint256 finalExecutorBalance = buyToken.balanceOf(address(this));
        if (finalExecutorBalance != balanceBefore) {
            revert BuyInvariantViolation(balanceBefore, finalExecutorBalance);
        }
    }

    function _refundNative(address recipient, uint256 nativeBalanceBefore) private {
        uint256 nativeRefund = address(this).balance - nativeBalanceBefore;
        if (nativeRefund == 0) return;

        (bool refunded,) = payable(recipient).call{value: nativeRefund}("");
        if (!refunded) revert NativeRefundFailed(recipient, nativeRefund);
    }

    function _emitIntentExecuted(
        ExecutionIntent calldata intent,
        bytes32 executionId,
        uint256 actualSellAmount,
        uint256 actualBuyAmount
    ) private {
        emit IntentExecuted(
            executionId,
            intent.owner,
            intent.nonce,
            intent.sellToken,
            intent.buyToken,
            intent.recipient,
            intent.sellAmount,
            actualSellAmount,
            actualBuyAmount
        );
    }

    function _requireContractWhenEnabling(address account, bool enabled) private view {
        if (account == address(0) || (enabled && account.code.length == 0)) {
            revert InvalidContract(account);
        }
    }
}

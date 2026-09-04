import { BASE_MAINNET_USDC } from "@vector/integrations";
import type { ExecutionCandidate, RiskValidationResult } from "@vector/risk";
import {
  VECTOR_CHAIN_ID,
  type AssetRegistry,
  type EvmAddress,
  type VectorAsset,
  type VectorChainId,
} from "@vector/shared";
import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  zeroAddress,
  type Hex,
} from "viem";

import type { VectorExecutionQuote } from "./external-quote.ts";

const MAX_UINT256 = (1n << 256n) - 1n;
const BYTE_ALIGNED_HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;

export const VECTOR_EXECUTOR_EXECUTE_SELECTOR = "0xa79dd7fa" as const;

/** Minimal checked ABI copied field-for-field from VectorExecutor.ExecutionIntent. */
export const VECTOR_EXECUTOR_ABI = [
  {
    inputs: [
      {
        components: [
          { name: "owner", type: "address" },
          { name: "sellToken", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "sellAmount", type: "uint256" },
          { name: "minBuyAmount", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "executionTarget", type: "address" },
          { name: "allowanceTarget", type: "address" },
          { name: "callValue", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "executionData", type: "bytes" },
        ],
        name: "intent",
        type: "tuple",
      },
    ],
    name: "execute",
    outputs: [
      { name: "executionId", type: "bytes32" },
      { name: "actualSellAmount", type: "uint256" },
      { name: "actualBuyAmount", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
] as const;

export interface VectorExecutionIntent {
  readonly allowanceTarget: EvmAddress;
  readonly buyToken: EvmAddress;
  readonly callValue: bigint;
  readonly deadline: bigint;
  readonly executionData: Hex;
  readonly executionTarget: EvmAddress;
  readonly minBuyAmount: bigint;
  readonly nonce: bigint;
  readonly owner: EvmAddress;
  readonly recipient: EvmAddress;
  readonly sellAmount: bigint;
  readonly sellToken: EvmAddress;
}

export interface VectorErc20ApprovalCall {
  readonly amount: bigint;
  readonly data: Hex;
  readonly spender: EvmAddress;
  readonly to: EvmAddress;
  readonly type: "ERC20_APPROVAL";
  readonly value: 0n;
}

export interface VectorExecutorCall {
  readonly data: Hex;
  readonly intent: VectorExecutionIntent;
  readonly to: EvmAddress;
  readonly type: "VECTOR_EXECUTION";
  readonly value: bigint;
}

export type VectorExecutionCalls = readonly [VectorErc20ApprovalCall, VectorExecutorCall];

export interface VectorExecutionPlan {
  readonly allowanceTarget: EvmAddress;
  readonly authorizationMode: "EXPLICIT_SMART_ACCOUNT";
  readonly buyAsset: VectorAsset;
  readonly calls: VectorExecutionCalls;
  readonly chainId: VectorChainId;
  readonly deadline: bigint;
  readonly executionData: Hex;
  readonly executionTarget: EvmAddress;
  readonly executionValue: bigint;
  readonly executor: EvmAddress;
  readonly minBuyAmount: bigint;
  readonly nonce: bigint;
  readonly owner: EvmAddress;
  readonly quoteSource: "0x";
  readonly recipient: EvmAddress;
  readonly sellAmount: bigint;
  readonly sellAsset: VectorAsset;
  readonly smartAccountAddress: EvmAddress;
}

export interface VectorExecutionAuthorizationConfig {
  readonly approvedAllowanceTargets: readonly EvmAddress[];
  readonly approvedExecutionTargets: readonly EvmAddress[];
  readonly executorAddress?: EvmAddress | undefined;
}

export interface BuildVectorExecutionPlanInput {
  readonly assetRegistry: AssetRegistry;
  readonly candidate: ExecutionCandidate & { readonly executionQuote: VectorExecutionQuote };
  readonly currentTimestamp: bigint;
  readonly nonce: bigint;
  readonly recipient: EvmAddress;
  readonly riskResult: RiskValidationResult;
  readonly smartAccountAddress: EvmAddress;
  readonly trustedConfig: VectorExecutionAuthorizationConfig;
}

export type ExecutionPlanValidationErrorCode =
  | "ADDRESS_INVALID"
  | "ALLOWANCE_TARGET_UNAPPROVED"
  | "ASSET_UNSUPPORTED"
  | "CANDIDATE_EXPIRED"
  | "EXECUTION_TARGET_UNAPPROVED"
  | "EXECUTOR_MISSING"
  | "INVALID_AMOUNT"
  | "INVALID_CALLDATA"
  | "INVALID_NATIVE_VALUE"
  | "INVALID_NONCE"
  | "OWNER_MISMATCH"
  | "QUOTE_INVALID"
  | "RISK_NOT_ACCEPTED"
  | "WRONG_CHAIN";

export class ExecutionPlanValidationError extends Error {
  readonly code: ExecutionPlanValidationErrorCode;

  constructor(code: ExecutionPlanValidationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const ERC20_APPROVE_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameAsset(left: VectorAsset, right: VectorAsset): boolean {
  return (
    left.assetStandard === right.assetStandard &&
    left.decimals === right.decimals &&
    left.enabled === right.enabled &&
    left.name === right.name &&
    left.symbol === right.symbol &&
    left.underlyingTicker === right.underlyingTicker &&
    sameAddress(left.tokenAddress, right.tokenAddress)
  );
}

function requireAddress(
  value: string | undefined,
  field: string,
  missingCode: ExecutionPlanValidationErrorCode = "ADDRESS_INVALID",
): EvmAddress {
  if (value === undefined || value.trim().length === 0) {
    throw new ExecutionPlanValidationError(missingCode, `${field} must be configured.`);
  }
  if (!isAddress(value, { strict: false }) || sameAddress(value, zeroAddress)) {
    throw new ExecutionPlanValidationError("ADDRESS_INVALID", `${field} must be non-zero address.`);
  }
  return getAddress(value) as EvmAddress;
}

function requireUint256(
  value: bigint,
  field: string,
  code: ExecutionPlanValidationErrorCode,
  allowZero = false,
): void {
  if (typeof value !== "bigint" || value < (allowZero ? 0n : 1n) || value > MAX_UINT256) {
    throw new ExecutionPlanValidationError(code, `${field} is outside its allowed uint256 range.`);
  }
}

function requireRegisteredEnabledAsset(asset: VectorAsset, registry: AssetRegistry): void {
  const registered = registry.getByAddress(asset.tokenAddress);
  if (registered === undefined || !registered.enabled || !sameAsset(asset, registered)) {
    throw new ExecutionPlanValidationError(
      "ASSET_UNSUPPORTED",
      `${asset.symbol} is not an enabled registered asset.`,
    );
  }
}

function isApproved(target: EvmAddress, approvedTargets: readonly EvmAddress[]): boolean {
  return approvedTargets.some((approved) => sameAddress(approved, target));
}

export function encodeVectorExecutionIntent(intent: VectorExecutionIntent): Hex {
  return encodeFunctionData({
    abi: VECTOR_EXECUTOR_ABI,
    functionName: "execute",
    args: [intent],
  });
}

export function decodeVectorExecutionIntent(data: Hex): VectorExecutionIntent {
  const decoded = decodeFunctionData({ abi: VECTOR_EXECUTOR_ABI, data });
  if (decoded.functionName !== "execute") {
    throw new ExecutionPlanValidationError("INVALID_CALLDATA", "Calldata is not execute(...). ");
  }
  return decoded.args[0] as VectorExecutionIntent;
}

export function buildVectorExecutionPlan(
  input: BuildVectorExecutionPlanInput,
): VectorExecutionPlan {
  const { candidate, riskResult } = input;
  const quote = candidate.executionQuote;

  if (riskResult.status !== "ACCEPTED" || riskResult.nextState !== "READY_FOR_AUTHORIZATION") {
    throw new ExecutionPlanValidationError(
      "RISK_NOT_ACCEPTED",
      "Execution plan construction requires READY_FOR_AUTHORIZATION risk acceptance.",
    );
  }
  if (candidate.chainId !== VECTOR_CHAIN_ID || quote.chainId !== VECTOR_CHAIN_ID) {
    throw new ExecutionPlanValidationError("WRONG_CHAIN", "Execution plans are Base Mainnet only.");
  }

  const executor = requireAddress(
    input.trustedConfig.executorAddress,
    "VectorExecutor address",
    "EXECUTOR_MISSING",
  );
  const owner = requireAddress(candidate.owner, "candidate.owner");
  const smartAccountAddress = requireAddress(input.smartAccountAddress, "smartAccountAddress");
  const recipient = requireAddress(input.recipient, "recipient");

  if (!sameAddress(owner, smartAccountAddress)) {
    throw new ExecutionPlanValidationError(
      "OWNER_MISMATCH",
      "Smart Account address must equal ExecutionIntent.owner.",
    );
  }
  if (sameAddress(recipient, executor)) {
    throw new ExecutionPlanValidationError(
      "ADDRESS_INVALID",
      "Recipient cannot be the VectorExecutor address.",
    );
  }

  requireRegisteredEnabledAsset(candidate.sellAsset, input.assetRegistry);
  requireRegisteredEnabledAsset(candidate.buyAsset, input.assetRegistry);
  if (!sameAddress(candidate.sellAsset.tokenAddress, BASE_MAINNET_USDC.tokenAddress)) {
    throw new ExecutionPlanValidationError(
      "ASSET_UNSUPPORTED",
      "This authorization slice only supports selling Base Mainnet USDC.",
    );
  }
  if (sameAddress(candidate.sellAsset.tokenAddress, candidate.buyAsset.tokenAddress)) {
    throw new ExecutionPlanValidationError("ASSET_UNSUPPORTED", "Sell and buy assets must differ.");
  }

  if (
    quote.kind !== "firm-execution-quote" ||
    quote.source !== "0x" ||
    !sameAsset(quote.sellAsset, candidate.sellAsset) ||
    !sameAsset(quote.buyAsset, candidate.buyAsset) ||
    quote.requestedRawSellAmount !== candidate.requestedRawSellAmount ||
    quote.quotedRawSellAmount > quote.requestedRawSellAmount ||
    !sameAddress(quote.taker, executor)
  ) {
    throw new ExecutionPlanValidationError(
      "QUOTE_INVALID",
      "Firm execution quote does not match the accepted candidate bounds.",
    );
  }

  requireUint256(quote.quotedRawSellAmount, "sellAmount", "INVALID_AMOUNT");
  requireUint256(quote.minBuyAmount, "minBuyAmount", "INVALID_AMOUNT");
  if (quote.minBuyAmount > quote.quotedRawBuyAmount) {
    throw new ExecutionPlanValidationError(
      "QUOTE_INVALID",
      "Firm quote minimum buy amount exceeds its quoted buy amount.",
    );
  }
  requireUint256(input.nonce, "nonce", "INVALID_NONCE", true);
  requireUint256(candidate.deadline, "deadline", "CANDIDATE_EXPIRED", true);
  requireUint256(input.currentTimestamp, "currentTimestamp", "CANDIDATE_EXPIRED", true);
  if (input.currentTimestamp > candidate.deadline) {
    throw new ExecutionPlanValidationError("CANDIDATE_EXPIRED", "Accepted candidate has expired.");
  }

  const executionTarget = requireAddress(quote.transaction.target, "executionTarget");
  const allowanceTarget = requireAddress(quote.allowanceTarget ?? undefined, "allowanceTarget");
  if (!isApproved(executionTarget, input.trustedConfig.approvedExecutionTargets)) {
    throw new ExecutionPlanValidationError(
      "EXECUTION_TARGET_UNAPPROVED",
      "Execution target is not in trusted configuration.",
    );
  }
  if (!isApproved(allowanceTarget, input.trustedConfig.approvedAllowanceTargets)) {
    throw new ExecutionPlanValidationError(
      "ALLOWANCE_TARGET_UNAPPROVED",
      "Allowance target is not in trusted configuration.",
    );
  }
  if (!BYTE_ALIGNED_HEX_PATTERN.test(quote.transaction.data)) {
    throw new ExecutionPlanValidationError(
      "INVALID_CALLDATA",
      "Execution calldata must be non-empty byte-aligned hex.",
    );
  }
  requireUint256(quote.transaction.value, "executionValue", "INVALID_NATIVE_VALUE", true);

  const intent = Object.freeze({
    allowanceTarget,
    buyToken: getAddress(candidate.buyAsset.tokenAddress) as EvmAddress,
    callValue: quote.transaction.value,
    deadline: candidate.deadline,
    executionData: quote.transaction.data,
    executionTarget,
    minBuyAmount: quote.minBuyAmount,
    nonce: input.nonce,
    owner,
    recipient,
    sellAmount: quote.quotedRawSellAmount,
    sellToken: getAddress(candidate.sellAsset.tokenAddress) as EvmAddress,
  }) satisfies VectorExecutionIntent;

  const approvalCall = Object.freeze({
    amount: intent.sellAmount,
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [executor, intent.sellAmount],
    }),
    spender: executor,
    to: intent.sellToken,
    type: "ERC20_APPROVAL",
    value: 0n,
  }) satisfies VectorErc20ApprovalCall;
  const executorCall = Object.freeze({
    data: encodeVectorExecutionIntent(intent),
    intent,
    to: executor,
    type: "VECTOR_EXECUTION",
    value: intent.callValue,
  }) satisfies VectorExecutorCall;
  const calls = Object.freeze([approvalCall, executorCall]) as VectorExecutionCalls;

  return Object.freeze({
    allowanceTarget,
    authorizationMode: "EXPLICIT_SMART_ACCOUNT",
    buyAsset: candidate.buyAsset,
    calls,
    chainId: VECTOR_CHAIN_ID,
    deadline: intent.deadline,
    executionData: intent.executionData,
    executionTarget,
    executionValue: intent.callValue,
    executor,
    minBuyAmount: intent.minBuyAmount,
    nonce: intent.nonce,
    owner,
    quoteSource: "0x",
    recipient,
    sellAmount: intent.sellAmount,
    sellAsset: candidate.sellAsset,
    smartAccountAddress,
  });
}

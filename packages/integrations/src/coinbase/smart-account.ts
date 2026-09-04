import { VECTOR_CHAIN_ID, type EvmAddress } from "@vector/shared";
import { decodeFunctionData, erc20Abi, isAddress, type Hex } from "viem";

export const CDP_BASE_MAINNET_NETWORK = "base" as const;
const VECTOR_EXECUTOR_EXECUTE_SELECTOR = "0xa79dd7fa" as const;

export interface CdpSmartAccountCall {
  readonly data: Hex;
  readonly to: EvmAddress;
  readonly value: bigint;
}

interface VectorSmartAccountPlanView {
  readonly authorizationMode: "EXPLICIT_SMART_ACCOUNT";
  readonly calls: readonly [
    {
      readonly amount: bigint;
      readonly data: Hex;
      readonly spender: EvmAddress;
      readonly to: EvmAddress;
      readonly type: "ERC20_APPROVAL";
      readonly value: 0n;
    },
    {
      readonly data: Hex;
      readonly intent: {
        readonly executionValue: bigint;
        readonly owner: EvmAddress;
        readonly sellAmount: bigint;
      };
      readonly to: EvmAddress;
      readonly type: "VECTOR_EXECUTION";
      readonly value: bigint;
    },
  ];
  readonly chainId: number;
  readonly executionValue: bigint;
  readonly executor: EvmAddress;
  readonly owner: EvmAddress;
  readonly sellAmount: bigint;
  readonly sellAsset: { readonly tokenAddress: EvmAddress };
  readonly smartAccountAddress: EvmAddress;
}

export type SmartAccountAuthorizationErrorCode =
  "INVALID_PLAN" | "OWNER_MISMATCH" | "SUBMISSION_DISABLED" | "WRONG_CHAIN";

export class SmartAccountAuthorizationError extends Error {
  readonly code: SmartAccountAuthorizationErrorCode;

  constructor(code: SmartAccountAuthorizationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Converts a closed Vector plan into the exact EncodedCall[] accepted by CDP user-wallet APIs.
 * It does not authenticate, authorize, sign, submit, or add a paymaster.
 */
export function buildSmartAccountCalls(
  plan: VectorSmartAccountPlanView,
): readonly [CdpSmartAccountCall, CdpSmartAccountCall] {
  if (plan.chainId !== VECTOR_CHAIN_ID) {
    throw new SmartAccountAuthorizationError(
      "WRONG_CHAIN",
      "CDP operation must target Base Mainnet.",
    );
  }
  if (
    plan.calls.length !== 2 ||
    plan.authorizationMode !== "EXPLICIT_SMART_ACCOUNT" ||
    !isAddress(plan.owner, { strict: false }) ||
    !isAddress(plan.smartAccountAddress, { strict: false }) ||
    !sameAddress(plan.owner, plan.smartAccountAddress)
  ) {
    throw new SmartAccountAuthorizationError(
      "OWNER_MISMATCH",
      "CDP Smart Account must be the Vector intent owner.",
    );
  }

  const approval = plan.calls[0];
  const execution = plan.calls[1];
  let decodedApproval: ReturnType<typeof decodeFunctionData>;
  try {
    decodedApproval = decodeFunctionData({ abi: erc20Abi, data: approval.data });
  } catch (cause) {
    throw new SmartAccountAuthorizationError(
      "INVALID_PLAN",
      `Approval calldata cannot be decoded: ${cause instanceof Error ? cause.message : "unknown error"}`,
    );
  }

  if (
    approval.type !== "ERC20_APPROVAL" ||
    execution.type !== "VECTOR_EXECUTION" ||
    !sameAddress(execution.intent.owner, plan.owner) ||
    !sameAddress(approval.to, plan.sellAsset.tokenAddress) ||
    !sameAddress(approval.spender, plan.executor) ||
    approval.amount !== plan.sellAmount ||
    approval.value !== 0n ||
    decodedApproval.functionName !== "approve" ||
    decodedApproval.args[0] === undefined ||
    !sameAddress(String(decodedApproval.args[0]), plan.executor) ||
    decodedApproval.args[1] !== plan.sellAmount ||
    !sameAddress(execution.to, plan.executor) ||
    execution.value !== plan.executionValue ||
    execution.intent.executionValue !== plan.executionValue ||
    execution.intent.sellAmount !== plan.sellAmount ||
    !execution.data.startsWith(VECTOR_EXECUTOR_EXECUTE_SELECTOR)
  ) {
    throw new SmartAccountAuthorizationError(
      "INVALID_PLAN",
      "Vector plan is not the exact approval-then-execute batch.",
    );
  }

  return Object.freeze([
    Object.freeze({ data: approval.data, to: approval.to, value: 0n }),
    Object.freeze({ data: execution.data, to: execution.to, value: execution.value }),
  ]);
}

export interface CdpUserOperationRequest {
  readonly calls: readonly CdpSmartAccountCall[];
  readonly evmSmartAccount: EvmAddress;
  readonly network: typeof CDP_BASE_MAINNET_NETWORK;
  readonly useCdpPaymaster?: boolean;
}

export interface CdpUserOperationResult {
  readonly userOperationHash: Hex;
}

/** Structural boundary implemented by @coinbase/cdp-hooks useSendUserOperation(). */
export interface CdpUserOperationSender {
  sendUserOperation(request: CdpUserOperationRequest): Promise<CdpUserOperationResult>;
}

export interface SendSmartAccountExecutionOptions {
  /** Must be opted into by the user-facing authorization flow. Defaults to false. */
  readonly submissionEnabled?: boolean;
  /** Optional CDP sponsorship request. Omitted by default, especially on Base Mainnet. */
  readonly useCdpPaymaster?: boolean;
}

export async function sendSmartAccountExecution(
  plan: VectorSmartAccountPlanView,
  sender: CdpUserOperationSender,
  options: SendSmartAccountExecutionOptions = {},
): Promise<CdpUserOperationResult> {
  if (options.submissionEnabled !== true) {
    throw new SmartAccountAuthorizationError(
      "SUBMISSION_DISABLED",
      "UserOperation submission is disabled until a user explicitly authorizes it.",
    );
  }

  const calls = buildSmartAccountCalls(plan);
  return sender.sendUserOperation({
    calls,
    evmSmartAccount: plan.smartAccountAddress,
    network: CDP_BASE_MAINNET_NETWORK,
    ...(options.useCdpPaymaster === undefined ? {} : { useCdpPaymaster: options.useCdpPaymaster }),
  });
}

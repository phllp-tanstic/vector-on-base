import {
  BASE_MAINNET_ZEROX_CONTRACTS,
  ZEROX_CONTRACT_MANIFEST_VERSION,
  type ZeroXContractManifest,
} from "@vector/integrations";
import { VECTOR_CHAIN_ID, type EvmAddress } from "@vector/shared";
import { getAddress, isAddress, zeroAddress } from "viem";

import type { VectorExecutionQuote } from "./external-quote.ts";

export const ZEROX_TARGET_REJECTION_REASONS = [
  "UNKNOWN_ALLOWANCE_HOLDER",
  "SETTLER_AS_ALLOWANCE_TARGET",
  "ALLOWANCE_TARGET_MISMATCH",
  "EXECUTION_TARGET_MISMATCH",
  "ZERO_TARGET",
  "UNSAFE_QUOTE_TARGET",
] as const;

export type ZeroXTargetRejectionReason = (typeof ZEROX_TARGET_REJECTION_REASONS)[number];

export class ZeroXTargetValidationError extends Error {
  readonly code: ZeroXTargetRejectionReason;

  constructor(code: ZeroXTargetRejectionReason, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ValidatedZeroXAllowanceHolderTargets {
  readonly allowanceHolder: EvmAddress;
  readonly executionTarget: EvmAddress;
  readonly manifestVersion: typeof ZEROX_CONTRACT_MANIFEST_VERSION;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function targetAddress(value: string | null, field: string): EvmAddress {
  if (value === null || !isAddress(value, { strict: false })) {
    throw new ZeroXTargetValidationError(
      "UNSAFE_QUOTE_TARGET",
      `${field} must be a valid EVM address.`,
    );
  }
  if (sameAddress(value, zeroAddress)) {
    throw new ZeroXTargetValidationError("ZERO_TARGET", `${field} must not be zero.`);
  }
  return getAddress(value) as EvmAddress;
}

/** Validates the address roles for Vector's ERC-20 /swap/allowance-holder flow. */
export function validateZeroXAllowanceHolderTargets(
  quote: Pick<VectorExecutionQuote, "allowanceTarget" | "chainId" | "issues" | "transaction">,
  manifest: ZeroXContractManifest = BASE_MAINNET_ZEROX_CONTRACTS,
): ValidatedZeroXAllowanceHolderTargets {
  if (
    quote.chainId !== VECTOR_CHAIN_ID ||
    manifest.chainId !== VECTOR_CHAIN_ID ||
    manifest.version !== ZEROX_CONTRACT_MANIFEST_VERSION
  ) {
    throw new ZeroXTargetValidationError(
      "UNSAFE_QUOTE_TARGET",
      "0x target policy requires the versioned Base Mainnet contract manifest.",
    );
  }

  const allowanceTarget = targetAddress(quote.allowanceTarget, "allowanceTarget");
  const executionTarget = targetAddress(quote.transaction.target, "transaction.to");
  const issueSpender =
    quote.issues.allowance === null
      ? null
      : targetAddress(quote.issues.allowance.spender, "issues.allowance.spender");

  const configuredContract = manifest.contracts.find((contract) =>
    sameAddress(contract.address, allowanceTarget),
  );
  if (configuredContract?.role === "SETTLER") {
    throw new ZeroXTargetValidationError(
      "SETTLER_AS_ALLOWANCE_TARGET",
      "A 0x Settler must never receive ERC-20 allowance.",
    );
  }
  if (configuredContract?.role !== "ALLOWANCE_HOLDER") {
    throw new ZeroXTargetValidationError(
      "UNKNOWN_ALLOWANCE_HOLDER",
      "Allowance target is not a recognized 0x AllowanceHolder deployment.",
    );
  }
  if (issueSpender !== null && !sameAddress(issueSpender, allowanceTarget)) {
    throw new ZeroXTargetValidationError(
      "ALLOWANCE_TARGET_MISMATCH",
      "issues.allowance.spender does not match allowanceTarget.",
    );
  }
  if (!sameAddress(executionTarget, allowanceTarget)) {
    throw new ZeroXTargetValidationError(
      "EXECUTION_TARGET_MISMATCH",
      "ERC-20 AllowanceHolder transaction.to must equal the recognized allowance target.",
    );
  }

  return Object.freeze({
    allowanceHolder: allowanceTarget,
    executionTarget,
    manifestVersion: manifest.version,
  });
}

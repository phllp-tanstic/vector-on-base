import type { EvmAddress } from "@vector/shared";
import { getAddress, isAddress, zeroAddress } from "viem";

export const VECTOR_EXECUTOR_ADDRESS_ENV_VAR = "VECTOR_EXECUTOR_ADDRESS" as const;

export interface VectorExecutorConfig {
  readonly executorAddress: EvmAddress;
}

export class VectorExecutorConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR" as const;
}

export function loadVectorExecutorConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): VectorExecutorConfig {
  const configured = environment[VECTOR_EXECUTOR_ADDRESS_ENV_VAR]?.trim();

  if (!configured) {
    throw new VectorExecutorConfigurationError(
      `${VECTOR_EXECUTOR_ADDRESS_ENV_VAR} must be configured before authorization-plan creation.`,
    );
  }
  if (!isAddress(configured, { strict: false }) || configured.toLowerCase() === zeroAddress) {
    throw new VectorExecutorConfigurationError(
      `${VECTOR_EXECUTOR_ADDRESS_ENV_VAR} must be a valid non-zero deployed contract address.`,
    );
  }

  return Object.freeze({ executorAddress: getAddress(configured) as EvmAddress });
}

import { VECTOR_CHAIN_ID } from "@vector/shared";

import { basePublicClient } from "./client.ts";
import { BaseRpcConfigurationError } from "./config.ts";

export interface BaseNetworkReader {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
}

export interface BaseNetworkVerificationResult {
  readonly chainId: typeof VECTOR_CHAIN_ID;
  readonly latestBlockNumber: bigint;
}

export async function verifyBaseNetwork(
  client: BaseNetworkReader = basePublicClient,
): Promise<BaseNetworkVerificationResult> {
  const chainId = await client.getChainId();

  if (chainId !== VECTOR_CHAIN_ID) {
    throw new BaseRpcConfigurationError(
      "WRONG_CHAIN",
      `Configured Base RPC returned chain ID ${chainId}; expected ${VECTOR_CHAIN_ID}.`,
    );
  }

  const latestBlockNumber = await client.getBlockNumber();

  return Object.freeze({ chainId, latestBlockNumber });
}

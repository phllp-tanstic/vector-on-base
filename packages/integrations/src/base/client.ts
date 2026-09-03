import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

import { loadBaseRpcConfig, type BaseRpcConfig } from "./config.ts";

export function createBasePublicClient(config: BaseRpcConfig = loadBaseRpcConfig()) {
  return createPublicClient({
    chain: base,
    transport: http(config.rpcUrl, {
      batch: {
        batchSize: 100_000,
        wait: 10,
      },
    }),
  });
}

export const basePublicClient = createBasePublicClient();

export type BasePublicClient = ReturnType<typeof createBasePublicClient>;

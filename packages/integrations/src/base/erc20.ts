import type { EvmAddress } from "@vector/shared";
import { getAddress } from "viem";

import type { BasePublicClient } from "./client.ts";

const ERC20_METADATA_ABI = [
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface Erc20Metadata {
  readonly symbol: string;
  readonly decimals: number;
}

export async function readErc20Metadata(
  client: BasePublicClient,
  tokenAddress: EvmAddress,
): Promise<Erc20Metadata> {
  const address = getAddress(tokenAddress);
  const [symbol, decimals] = await Promise.all([
    client.readContract({ abi: ERC20_METADATA_ABI, address, functionName: "symbol" }),
    client.readContract({ abi: ERC20_METADATA_ABI, address, functionName: "decimals" }),
  ]);

  return Object.freeze({ decimals, symbol });
}

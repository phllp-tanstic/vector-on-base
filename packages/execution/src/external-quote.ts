import type { B20UIAmount } from "@vector/b20";
import type { ZeroXIssues, ZeroXRoute } from "@vector/integrations";
import type { B20VectorAsset, EvmAddress, VectorAsset, VectorChainId } from "@vector/shared";
import type { Hex } from "viem";

export interface VectorQuoteTransaction {
  readonly data: Hex;
  readonly target: EvmAddress;
  readonly value: bigint;
}

/** Untrusted external execution data. This type grants no authority to execute it. */
export interface VectorExecutionQuote {
  readonly allowanceTarget: EvmAddress | null;
  readonly buyAsset: B20VectorAsset;
  readonly chainId: VectorChainId;
  readonly issues: ZeroXIssues;
  readonly kind: "firm-execution-quote";
  readonly minBuyAmount: bigint;
  readonly quoteBlockNumber: bigint;
  readonly quoteTimestamp: string;
  readonly quotedB20EconomicBuyAmount: B20UIAmount;
  readonly quotedRawBuyAmount: bigint;
  readonly quotedRawSellAmount: bigint;
  readonly requestedRawSellAmount: bigint;
  readonly route: ZeroXRoute;
  readonly routeSourceNames: readonly string[];
  readonly sellAsset: VectorAsset;
  readonly slippageBps: number;
  readonly source: "0x";
  readonly taker: EvmAddress;
  readonly transaction: VectorQuoteTransaction;
}

export class ExecutionQuoteValidationError extends Error {
  readonly code = "QUOTE_VALIDATION_ERROR" as const;
}

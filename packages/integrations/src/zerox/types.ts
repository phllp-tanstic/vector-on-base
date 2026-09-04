import type { B20VectorAsset, EvmAddress, VectorAsset, VectorChainId } from "@vector/shared";
import type { Hex } from "viem";

export interface ZeroXExactSellRequest {
  readonly buyAsset: B20VectorAsset;
  readonly chainId: VectorChainId;
  readonly sellAmount: bigint;
  readonly sellAsset: VectorAsset;
  readonly slippageBps: number;
  readonly taker: EvmAddress;
}

export interface ZeroXAllowanceIssue {
  readonly actual: bigint;
  readonly spender: EvmAddress;
}

export interface ZeroXBalanceIssue {
  readonly actual: bigint;
  readonly expected: bigint;
  readonly token: EvmAddress;
}

export interface ZeroXIssues {
  readonly allowance: ZeroXAllowanceIssue | null;
  readonly balance: ZeroXBalanceIssue | null;
  readonly invalidSourcesPassed: readonly string[];
  readonly simulationIncomplete: boolean;
}

export interface ZeroXRouteFill {
  readonly from: EvmAddress;
  readonly proportionBps: bigint;
  readonly source: string;
  readonly to: EvmAddress;
}

export interface ZeroXRoute {
  readonly fills: readonly ZeroXRouteFill[];
}

interface ZeroXExactSellResponseBase {
  readonly allowanceTarget: EvmAddress | null;
  readonly blockNumber: bigint;
  readonly buyAmount: bigint;
  readonly buyToken: EvmAddress;
  readonly issues: ZeroXIssues;
  readonly liquidityAvailable: true;
  readonly minBuyAmount: bigint;
  readonly mode: "exact-in";
  readonly route: ZeroXRoute;
  readonly sellAmount: bigint;
  readonly sellToken: EvmAddress;
  readonly zid: string;
}

export interface ZeroXIndicativePrice extends ZeroXExactSellResponseBase {
  readonly kind: "indicative-price";
}

export interface ZeroXTransactionPayload {
  readonly data: Hex;
  readonly gas: bigint | null;
  readonly gasPrice: bigint;
  readonly to: EvmAddress;
  readonly value: bigint;
}

export interface ZeroXFirmQuote extends ZeroXExactSellResponseBase {
  readonly kind: "firm-quote";
  readonly transaction: ZeroXTransactionPayload;
}

export type ZeroXErrorCode =
  | "CONFIGURATION_ERROR"
  | "INVALID_ZEROX_RESPONSE"
  | "NO_LIQUIDITY"
  | "QUOTE_VALIDATION_ERROR"
  | "TOKENIZED_EQUITY_ACCESS_REQUIRED"
  | "TOKEN_NOT_SUPPORTED"
  | "ZEROX_AUTH_ERROR"
  | "ZEROX_RATE_LIMITED"
  | "ZEROX_SERVER_ERROR";

export interface ZeroXRemoteDiagnostic {
  readonly code?: string;
  readonly message?: string;
  readonly zid?: string;
}

export class ZeroXError extends Error {
  readonly code: ZeroXErrorCode;
  readonly httpStatus?: number;
  readonly remote: ZeroXRemoteDiagnostic;

  constructor(
    code: ZeroXErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly httpStatus?: number;
      readonly remote?: ZeroXRemoteDiagnostic;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.remote = Object.freeze(options.remote ?? {});

    if (options.httpStatus !== undefined) {
      this.httpStatus = options.httpStatus;
    }
  }
}

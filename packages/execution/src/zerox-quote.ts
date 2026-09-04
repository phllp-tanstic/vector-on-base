import { b20RawAmount, rawToUIAmount, type B20Multiplier, type B20ReadAdapter } from "@vector/b20";
import {
  createBaseMainnetB20Adapter,
  createZeroXSwapClient,
  type ZeroXExactSellRequest,
  type ZeroXFirmQuote,
  type ZeroXSwapClient,
} from "@vector/integrations";
import { VECTOR_CHAIN_ID, type EvmAddress } from "@vector/shared";
import { isAddress, isHex, zeroAddress } from "viem";

import { ExecutionQuoteValidationError, type VectorExecutionQuote } from "./external-quote.ts";

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function validateNonZeroAddress(value: string, field: string): asserts value is EvmAddress {
  if (!isAddress(value, { strict: false }) || sameAddress(value, zeroAddress)) {
    throw new ExecutionQuoteValidationError(`${field} must be a valid non-zero address.`);
  }
}

function resolveAllowanceTarget(quote: ZeroXFirmQuote): EvmAddress | null {
  const issueSpender = quote.issues.allowance?.spender ?? null;

  if (quote.allowanceTarget !== null) {
    validateNonZeroAddress(quote.allowanceTarget, "0x allowanceTarget");
  }

  if (issueSpender !== null) {
    validateNonZeroAddress(issueSpender, "0x allowance issue spender");
  }

  if (
    quote.allowanceTarget !== null &&
    issueSpender !== null &&
    !sameAddress(quote.allowanceTarget, issueSpender)
  ) {
    throw new ExecutionQuoteValidationError(
      "0x returned conflicting allowance target and allowance issue spender addresses.",
    );
  }

  return issueSpender ?? quote.allowanceTarget;
}

export interface BuildZeroXExecutionQuoteInput {
  readonly capturedAt: Date;
  readonly multiplier: B20Multiplier;
  readonly quote: ZeroXFirmQuote;
  readonly request: ZeroXExactSellRequest;
}

export function buildZeroXExecutionQuote({
  capturedAt,
  multiplier,
  quote,
  request,
}: BuildZeroXExecutionQuoteInput): VectorExecutionQuote {
  if (request.chainId !== VECTOR_CHAIN_ID) {
    throw new ExecutionQuoteValidationError("Execution quote chain must be Base Mainnet.");
  }

  if (!sameAddress(quote.sellToken, request.sellAsset.tokenAddress)) {
    throw new ExecutionQuoteValidationError("0x returned the wrong sell token.");
  }

  if (!sameAddress(quote.buyToken, request.buyAsset.tokenAddress)) {
    throw new ExecutionQuoteValidationError("0x returned the wrong buy token.");
  }

  if (quote.sellAmount > request.sellAmount) {
    throw new ExecutionQuoteValidationError(
      "0x sell amount exceeds the requested exact-sell maximum.",
    );
  }

  if (quote.buyAmount <= 0n) {
    throw new ExecutionQuoteValidationError("0x buy amount must be positive.");
  }

  validateNonZeroAddress(quote.transaction.to, "0x transaction target");

  if (!isHex(quote.transaction.data) || !/^0x(?:[0-9a-fA-F]{2})*$/.test(quote.transaction.data)) {
    throw new ExecutionQuoteValidationError("0x transaction calldata must be byte-aligned hex.");
  }

  if (typeof quote.transaction.value !== "bigint" || quote.transaction.value < 0n) {
    throw new ExecutionQuoteValidationError(
      "0x transaction value must be a non-negative bigint-compatible value.",
    );
  }

  if (Number.isNaN(capturedAt.getTime())) {
    throw new ExecutionQuoteValidationError("Quote timestamp must be a valid Date.");
  }

  if (
    quote.issues.balance !== null &&
    !sameAddress(quote.issues.balance.token, request.sellAsset.tokenAddress)
  ) {
    throw new ExecutionQuoteValidationError("0x balance issue references the wrong sell token.");
  }

  const rawBuyAmount = b20RawAmount(quote.buyAmount);
  const routeSourceNames = Object.freeze([
    ...new Set(quote.route.fills.map((fill) => fill.source)),
  ]);

  return Object.freeze({
    allowanceTarget: resolveAllowanceTarget(quote),
    buyAsset: request.buyAsset,
    chainId: VECTOR_CHAIN_ID,
    issues: quote.issues,
    quoteBlockNumber: quote.blockNumber,
    quoteTimestamp: capturedAt.toISOString(),
    quotedB20EconomicBuyAmount: rawToUIAmount(rawBuyAmount, multiplier),
    quotedRawBuyAmount: rawBuyAmount,
    quotedRawSellAmount: quote.sellAmount,
    requestedRawSellAmount: request.sellAmount,
    route: quote.route,
    routeSourceNames,
    sellAsset: request.sellAsset,
    slippageBps: request.slippageBps,
    source: "0x",
    transaction: Object.freeze({
      data: quote.transaction.data,
      target: quote.transaction.to,
      value: quote.transaction.value,
    }),
  });
}

interface ZeroXFirmQuoteReader {
  getQuote(request: ZeroXExactSellRequest): Promise<ZeroXFirmQuote>;
}

interface B20MultiplierReader {
  multiplier(
    asset: Parameters<B20ReadAdapter["multiplier"]>[0],
    blockNumber?: bigint,
  ): ReturnType<B20ReadAdapter["multiplier"]>;
}

export class ZeroXExecutionQuoteService {
  readonly #b20: B20MultiplierReader;
  readonly #client: ZeroXFirmQuoteReader;
  readonly #now: () => Date;

  constructor(
    client: ZeroXFirmQuoteReader = createZeroXSwapClient(),
    b20: B20MultiplierReader = createBaseMainnetB20Adapter(),
    now: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#b20 = b20;
    this.#now = now;
  }

  async getQuote(request: ZeroXExactSellRequest): Promise<VectorExecutionQuote> {
    const quote = await this.#client.getQuote(request);
    const multiplier = await this.#b20.multiplier(request.buyAsset, quote.blockNumber);
    return buildZeroXExecutionQuote({ capturedAt: this.#now(), multiplier, quote, request });
  }
}

export function createZeroXExecutionQuoteService(
  client?: ZeroXSwapClient,
  b20?: B20MultiplierReader,
): ZeroXExecutionQuoteService {
  return new ZeroXExecutionQuoteService(client, b20);
}

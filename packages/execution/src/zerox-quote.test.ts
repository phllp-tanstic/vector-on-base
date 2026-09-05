import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { b20Multiplier } from "@vector/b20";
import {
  BASE_MAINNET_TOKENIZED_STOCKS,
  BASE_MAINNET_USDC,
  type ZeroXExactSellRequest,
  type ZeroXFirmQuote,
} from "@vector/integrations";
import { VECTOR_CHAIN_ID } from "@vector/shared";

import { ExecutionQuoteValidationError } from "./external-quote.ts";
import { buildZeroXExecutionQuote } from "./zerox-quote.ts";
import { ZeroXTargetValidationError } from "./zerox-target-policy.ts";

const nvdac = BASE_MAINNET_TOKENIZED_STOCKS[0];
const TAKER = "0x0000000000000000000000000000000000000001" as const;
const ALLOWANCE_TARGET = "0x0000000000001fF3684f28c67538d4D072C22734" as const;
const TRANSACTION_TARGET = ALLOWANCE_TARGET;
const CAPTURED_AT = new Date("2026-09-04T12:00:00.000Z");

function request(): ZeroXExactSellRequest {
  return {
    buyAsset: nvdac,
    chainId: VECTOR_CHAIN_ID,
    sellAmount: 1_000_000n,
    sellAsset: BASE_MAINNET_USDC,
    slippageBps: 30,
    taker: TAKER,
  };
}

function quote(): ZeroXFirmQuote {
  return {
    allowanceTarget: ALLOWANCE_TARGET,
    blockNumber: 35_000_000n,
    buyAmount: 250_000n,
    buyToken: nvdac.tokenAddress,
    issues: {
      allowance: { actual: 0n, spender: ALLOWANCE_TARGET },
      balance: { actual: 0n, expected: 1_000_000n, token: BASE_MAINNET_USDC.tokenAddress },
      invalidSourcesPassed: [],
      simulationIncomplete: true,
    },
    kind: "firm-quote",
    liquidityAvailable: true,
    minBuyAmount: 249_250n,
    mode: "exact-in",
    route: {
      fills: [
        {
          from: BASE_MAINNET_USDC.tokenAddress,
          proportionBps: 10_000n,
          source: "Base_Uniswap_V3",
          to: nvdac.tokenAddress,
        },
      ],
    },
    sellAmount: 1_000_000n,
    sellToken: BASE_MAINNET_USDC.tokenAddress,
    transaction: {
      data: "0x1234",
      gas: 250_000n,
      gasPrice: 1_000_000n,
      to: TRANSACTION_TARGET,
      value: 0n,
    },
    zid: "fixture-zid",
  };
}

function build(remoteQuote = quote(), quoteRequest = request()) {
  return buildZeroXExecutionQuote({
    capturedAt: CAPTURED_AT,
    multiplier: b20Multiplier(2_000_000_000_000_000_000n),
    quote: remoteQuote,
    request: quoteRequest,
  });
}

function isValidationError(error: unknown): boolean {
  return error instanceof ExecutionQuoteValidationError && error.code === "QUOTE_VALIDATION_ERROR";
}

function hasTargetCode(code: ZeroXTargetValidationError["code"]) {
  return (error: unknown) => error instanceof ZeroXTargetValidationError && error.code === code;
}

describe("normalized 0x execution quote", () => {
  it("keeps raw swap units distinct from derived B20 economic units", () => {
    const result = build();

    assert.equal(result.source, "0x");
    assert.equal(result.kind, "firm-execution-quote");
    assert.equal(result.minBuyAmount, 249_250n);
    assert.equal(result.requestedRawSellAmount, 1_000_000n);
    assert.equal(result.quotedRawSellAmount, 1_000_000n);
    assert.equal(result.quotedRawBuyAmount, 250_000n);
    assert.equal(result.quotedB20EconomicBuyAmount, 500_000n);
    assert.equal(result.slippageBps, 30);
    assert.equal(result.allowanceTarget, ALLOWANCE_TARGET);
    assert.equal(result.taker, TAKER);
    assert.equal(result.transaction.target, TRANSACTION_TARGET);
    assert.equal(result.quoteTimestamp, CAPTURED_AT.toISOString());
    assert.deepEqual(result.routeSourceNames, ["Base_Uniswap_V3"]);
    assert.equal(result.issues.balance?.expected, 1_000_000n);
    assert.equal(result.issues.simulationIncomplete, true);
  });

  it("rejects wrong returned sell and buy tokens", () => {
    assert.throws(
      () =>
        build({
          ...quote(),
          sellToken: "0x0000000000000000000000000000000000000003",
        }),
      isValidationError,
    );
    assert.throws(
      () =>
        build({
          ...quote(),
          buyToken: "0x0000000000000000000000000000000000000003",
        }),
      isValidationError,
    );
  });

  it("rejects zero buy amounts and any exact-sell amount mismatch", () => {
    assert.throws(() => build({ ...quote(), buyAmount: 0n }), isValidationError);
    assert.throws(() => build({ ...quote(), sellAmount: 1_000_001n }), isValidationError);
    assert.throws(() => build({ ...quote(), sellAmount: 999_999n }), isValidationError);
  });

  it("rejects malformed transaction targets, calldata, and values", () => {
    assert.throws(
      () =>
        build({
          ...quote(),
          transaction: {
            ...quote().transaction,
            to: "0x0000000000000000000000000000000000000000",
          },
        }),
      hasTargetCode("ZERO_TARGET"),
    );
    assert.throws(
      () =>
        build({
          ...quote(),
          transaction: { ...quote().transaction, data: "0x123" },
        }),
      isValidationError,
    );
    assert.throws(
      () => build({ ...quote(), transaction: { ...quote().transaction, data: "0x" } }),
      isValidationError,
    );
    assert.throws(
      () =>
        build({
          ...quote(),
          transaction: { ...quote().transaction, value: "0" as unknown as bigint },
        }),
      isValidationError,
    );
    assert.throws(
      () => build({ ...quote(), transaction: { ...quote().transaction, value: 1n } }),
      isValidationError,
    );
  });

  it("rejects a non-Base request and conflicting dynamic allowance targets", () => {
    assert.throws(
      () => build(quote(), { ...request(), chainId: 1 as ZeroXExactSellRequest["chainId"] }),
      isValidationError,
    );
    assert.throws(
      () =>
        build({
          ...quote(),
          issues: {
            ...quote().issues,
            allowance: {
              actual: 0n,
              spender: "0x0000000000000000000000000000000000000003",
            },
          },
        }),
      hasTargetCode("ALLOWANCE_TARGET_MISMATCH"),
    );
  });
});

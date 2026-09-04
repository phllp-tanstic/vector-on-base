import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VECTOR_CHAIN_ID, type B20VectorAsset, type VectorAsset } from "@vector/shared";

import { BASE_MAINNET_TOKENIZED_STOCKS, BASE_MAINNET_USDC } from "../base/assets.ts";
import { ZeroXSwapClient, type ZeroXHttpRequest, type ZeroXHttpTransport } from "./client.ts";
import { type ZeroXExactSellRequest, ZeroXError } from "./types.ts";

const TAKER = "0x0000000000000000000000000000000000000001" as const;
const ALLOWANCE_TARGET = "0x0000000000001fF3684f28c67538d4D072C22734" as const;
const TRANSACTION_TARGET = "0x0000000000000000000000000000000000000002" as const;
const nvdac = BASE_MAINNET_TOKENIZED_STOCKS[0];

function request(overrides: Partial<ZeroXExactSellRequest> = {}): ZeroXExactSellRequest {
  return {
    buyAsset: nvdac,
    chainId: VECTOR_CHAIN_ID,
    sellAmount: 1_000_000n,
    sellAsset: BASE_MAINNET_USDC,
    slippageBps: 30,
    taker: TAKER,
    ...overrides,
  };
}

function responseBody() {
  return {
    allowanceTarget: ALLOWANCE_TARGET,
    blockNumber: "35000000",
    buyAmount: "250000",
    buyToken: nvdac.tokenAddress,
    issues: {
      allowance: { actual: "0", spender: ALLOWANCE_TARGET },
      balance: { actual: "0", expected: "1000000", token: BASE_MAINNET_USDC.tokenAddress },
      invalidSourcesPassed: [],
      simulationIncomplete: true,
    },
    liquidityAvailable: true,
    minBuyAmount: "249250",
    mode: "exact-in",
    route: {
      fills: [
        {
          from: BASE_MAINNET_USDC.tokenAddress,
          proportionBps: "10000",
          source: "Base_Uniswap_V3",
          to: nvdac.tokenAddress,
        },
      ],
      tokens: [
        { address: BASE_MAINNET_USDC.tokenAddress, symbol: "USDC" },
        { address: nvdac.tokenAddress, symbol: "NVDAc" },
      ],
    },
    sellAmount: "1000000",
    sellToken: BASE_MAINNET_USDC.tokenAddress,
    zid: "fixture-zid",
  };
}

function quoteBody() {
  return {
    ...responseBody(),
    transaction: {
      data: "0x1234",
      gas: "250000",
      gasPrice: "1000000",
      to: TRANSACTION_TARGET,
      value: "0",
    },
  };
}

class MockTransport implements ZeroXHttpTransport {
  readonly requests: ZeroXHttpRequest[] = [];
  readonly #response: { readonly body: unknown; readonly status: number };

  constructor(body: unknown, status = 200) {
    this.#response = { body, status };
  }

  async get(httpRequest: ZeroXHttpRequest) {
    this.requests.push(httpRequest);
    return this.#response;
  }
}

function client(transport: ZeroXHttpTransport): ZeroXSwapClient {
  return new ZeroXSwapClient(
    { apiBaseUrl: "https://api.0x.org", apiKey: "test-only-key" },
    transport,
  );
}

describe("0x AllowanceHolder v2 client", () => {
  it("parses an indicative price and explicitly propagates 30 bps", async () => {
    const transport = new MockTransport(responseBody());
    const price = await client(transport).getPrice(request());
    const sent = transport.requests[0];

    assert.equal(price.kind, "indicative-price");
    assert.equal(price.buyAmount, 250_000n);
    assert.equal(price.blockNumber, 35_000_000n);
    assert.ok(sent?.url.includes("/swap/allowance-holder/price?"));
    assert.equal(new URL(sent!.url).searchParams.get("slippageBps"), "30");
    assert.equal(new URL(sent!.url).searchParams.get("chainId"), "8453");
    assert.equal(sent?.headers["0x-version"], "v2");
    assert.equal(sent?.headers["0x-api-key"], "test-only-key");
  });

  it("parses a firm quote, transaction, route, and all documented issues", async () => {
    const quote = await client(new MockTransport(quoteBody())).getQuote(request());

    assert.equal(quote.kind, "firm-quote");
    assert.equal(quote.transaction.to, TRANSACTION_TARGET);
    assert.equal(quote.transaction.value, 0n);
    assert.equal(quote.issues.allowance?.spender, ALLOWANCE_TARGET);
    assert.equal(quote.issues.balance?.expected, 1_000_000n);
    assert.equal(quote.issues.simulationIncomplete, true);
    assert.equal(quote.route.fills[0]?.source, "Base_Uniswap_V3");
  });

  it("rejects wrong returned sell and buy token identities", async () => {
    await assert.rejects(
      client(
        new MockTransport({
          ...responseBody(),
          sellToken: "0x0000000000000000000000000000000000000003",
        }),
      ).getPrice(request()),
      (error: unknown) => error instanceof ZeroXError && error.code === "QUOTE_VALIDATION_ERROR",
    );
    await assert.rejects(
      client(
        new MockTransport({
          ...responseBody(),
          buyToken: "0x0000000000000000000000000000000000000003",
        }),
      ).getPrice(request()),
      (error: unknown) => error instanceof ZeroXError && error.code === "QUOTE_VALIDATION_ERROR",
    );
  });

  it("rejects zero buy amounts and sell amounts above the exact-sell maximum", async () => {
    await assert.rejects(
      client(new MockTransport({ ...responseBody(), buyAmount: "0" })).getPrice(request()),
      (error: unknown) => error instanceof ZeroXError && error.code === "QUOTE_VALIDATION_ERROR",
    );
    await assert.rejects(
      client(new MockTransport({ ...responseBody(), sellAmount: "1000001" })).getPrice(request()),
      (error: unknown) => error instanceof ZeroXError && error.code === "QUOTE_VALIDATION_ERROR",
    );
  });

  it("rejects malformed transaction targets and calldata as invalid responses", async () => {
    await assert.rejects(
      client(
        new MockTransport({
          ...quoteBody(),
          transaction: {
            ...quoteBody().transaction,
            to: "0x0000000000000000000000000000000000000000",
          },
        }),
      ).getQuote(request()),
      (error: unknown) => error instanceof ZeroXError && error.code === "INVALID_ZEROX_RESPONSE",
    );
    await assert.rejects(
      client(
        new MockTransport({
          ...quoteBody(),
          transaction: { ...quoteBody().transaction, data: "0x123" },
        }),
      ).getQuote(request()),
      (error: unknown) => error instanceof ZeroXError && error.code === "INVALID_ZEROX_RESPONSE",
    );
  });

  it("classifies authentication, unsupported-token, access, and rate-limit errors", async () => {
    const cases = [
      [401, { name: "UNAUTHORIZED", message: "invalid api key" }, "ZEROX_AUTH_ERROR"],
      [400, { name: "TOKEN_NOT_SUPPORTED", message: "unsupported" }, "TOKEN_NOT_SUPPORTED"],
      [
        422,
        {
          name: "BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE",
          message: "The buy token is not authorized for trade due to legal restrictions",
        },
        "TOKEN_NOT_SUPPORTED",
      ],
      [
        403,
        { name: "XSTOCKS_NOT_AUTHORIZED", message: "access required" },
        "TOKENIZED_EQUITY_ACCESS_REQUIRED",
      ],
      [429, { name: "RATE_LIMITED", message: "slow down" }, "ZEROX_RATE_LIMITED"],
    ] as const;

    for (const [status, body, expectedCode] of cases) {
      await assert.rejects(
        client(new MockTransport(body, status)).getPrice(request()),
        (error: unknown) =>
          error instanceof ZeroXError &&
          error.code === expectedCode &&
          error.remote.code === body.name &&
          error.remote.message === body.message,
      );
    }
  });

  it("does not reinterpret a legal buy-token restriction as BStocks access denial or retry", async () => {
    const transport = new MockTransport(
      {
        name: "BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE",
        message: "The buy token is not authorized for trade due to legal restrictions",
      },
      422,
    );

    await assert.rejects(
      client(transport).getPrice(request()),
      (error: unknown) =>
        error instanceof ZeroXError &&
        error.code === "TOKEN_NOT_SUPPORTED" &&
        error.remote.code === "BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE",
    );
    assert.equal(transport.requests.length, 1);
  });

  it("classifies no liquidity and malformed success JSON", async () => {
    await assert.rejects(
      client(new MockTransport({ liquidityAvailable: false, zid: "none" })).getPrice(request()),
      (error: unknown) => error instanceof ZeroXError && error.code === "NO_LIQUIDITY",
    );
    await assert.rejects(
      client(new MockTransport({ liquidityAvailable: true })).getPrice(request()),
      (error: unknown) => error instanceof ZeroXError && error.code === "INVALID_ZEROX_RESPONSE",
    );
  });

  it("enforces the Base USDC to enabled registered B20 boundary", async () => {
    const transport = new MockTransport(responseBody());
    const arbitrary = {
      ...BASE_MAINNET_USDC,
      tokenAddress: "0x0000000000000000000000000000000000000003",
    } as const satisfies VectorAsset;
    const mismatched = { ...nvdac, symbol: "FAKEc" } as const satisfies B20VectorAsset;

    await assert.rejects(client(transport).getPrice(request({ sellAsset: arbitrary })));
    await assert.rejects(client(transport).getPrice(request({ buyAsset: mismatched })));
    await assert.rejects(
      client(transport).getPrice(request({ chainId: 1 as ZeroXExactSellRequest["chainId"] })),
    );
    assert.equal(transport.requests.length, 0);
  });
});

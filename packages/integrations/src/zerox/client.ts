import {
  VECTOR_CHAIN_ID,
  type B20VectorAsset,
  type EvmAddress,
  type VectorAsset,
} from "@vector/shared";
import { getAddress, isAddress, type Hex } from "viem";
import { z } from "zod";

import { BASE_MAINNET_ASSET_REGISTRY, BASE_MAINNET_USDC } from "../base/assets.ts";
import { loadZeroXApiConfig, type ZeroXApiConfig } from "./config.ts";
import {
  ZeroXError,
  type ZeroXExactSellRequest,
  type ZeroXFirmQuote,
  type ZeroXIndicativePrice,
  type ZeroXRemoteDiagnostic,
} from "./types.ts";

export interface ZeroXHttpRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly url: string;
}

export interface ZeroXHttpResponse {
  readonly body: unknown;
  readonly status: number;
}

export interface ZeroXHttpTransport {
  get(request: ZeroXHttpRequest): Promise<ZeroXHttpResponse>;
}

const uintStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .transform((value) => BigInt(value));

const addressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value) => getAddress(value) as EvmAddress);

const nonZeroAddressSchema = addressSchema.refine(
  (value) => value !== "0x0000000000000000000000000000000000000000",
);

const calldataSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
  .transform((value) => value as Hex);

const issuesSchema = z.object({
  allowance: z.object({ actual: uintStringSchema, spender: nonZeroAddressSchema }).nullable(),
  balance: z
    .object({ actual: uintStringSchema, expected: uintStringSchema, token: addressSchema })
    .nullable(),
  invalidSourcesPassed: z.array(z.string()),
  simulationIncomplete: z.boolean(),
});

const routeSchema = z.object({
  fills: z.array(
    z.object({
      from: addressSchema,
      proportionBps: uintStringSchema,
      source: z.string().min(1),
      to: addressSchema,
    }),
  ),
  tokens: z.array(z.object({ address: addressSchema, symbol: z.string() })),
});

const exactSellResponseSchema = z.object({
  allowanceTarget: nonZeroAddressSchema.nullable(),
  blockNumber: uintStringSchema,
  buyAmount: uintStringSchema,
  buyToken: addressSchema,
  issues: issuesSchema,
  liquidityAvailable: z.literal(true),
  minBuyAmount: uintStringSchema,
  mode: z.literal("exact-in"),
  route: routeSchema,
  sellAmount: uintStringSchema,
  sellToken: addressSchema,
  zid: z.string(),
});

const firmQuoteSchema = exactSellResponseSchema.extend({
  transaction: z.object({
    data: calldataSchema,
    gas: uintStringSchema.nullable(),
    gasPrice: uintStringSchema,
    to: nonZeroAddressSchema,
    value: uintStringSchema,
  }),
});

const noLiquiditySchema = z.object({
  liquidityAvailable: z.literal(false),
  zid: z.string(),
});

const remoteErrorSchema = z.object({
  data: z.object({ zid: z.string().optional() }).passthrough().optional(),
  message: z.string().optional(),
  name: z.string().optional(),
});

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameAssetIdentity(left: VectorAsset, right: VectorAsset): boolean {
  return (
    left.assetStandard === right.assetStandard &&
    left.decimals === right.decimals &&
    left.enabled === right.enabled &&
    left.name === right.name &&
    left.symbol === right.symbol &&
    left.underlyingTicker === right.underlyingTicker &&
    sameAddress(left.tokenAddress, right.tokenAddress)
  );
}

function resolveRegisteredAsset(asset: VectorAsset, role: "buy" | "sell"): VectorAsset {
  if (!isAddress(asset.tokenAddress, { strict: false })) {
    throw new ZeroXError("QUOTE_VALIDATION_ERROR", `${role} asset has an invalid address.`);
  }

  const registered = BASE_MAINNET_ASSET_REGISTRY.getByAddress(getAddress(asset.tokenAddress));

  if (registered === undefined) {
    throw new ZeroXError("TOKEN_NOT_SUPPORTED", `${role} asset is not registered on Base Mainnet.`);
  }

  if (!sameAssetIdentity(asset, registered)) {
    throw new ZeroXError(
      "QUOTE_VALIDATION_ERROR",
      `${role} asset identity does not match the verified registry.`,
    );
  }

  if (!registered.enabled) {
    throw new ZeroXError("TOKEN_NOT_SUPPORTED", `${registered.symbol} is disabled.`);
  }

  return registered;
}

function validateRequest(request: ZeroXExactSellRequest): {
  readonly buyAsset: B20VectorAsset;
  readonly sellAsset: VectorAsset;
  readonly taker: EvmAddress;
} {
  if (request.chainId !== VECTOR_CHAIN_ID) {
    throw new ZeroXError(
      "QUOTE_VALIDATION_ERROR",
      "0x execution quotes are restricted to Base Mainnet.",
    );
  }

  if (request.sellAmount <= 0n) {
    throw new ZeroXError("QUOTE_VALIDATION_ERROR", "Exact-sell amount must be greater than zero.");
  }

  if (
    !Number.isInteger(request.slippageBps) ||
    request.slippageBps < 0 ||
    request.slippageBps > 10_000
  ) {
    throw new ZeroXError(
      "QUOTE_VALIDATION_ERROR",
      "slippageBps must be an integer from 0 through 10000.",
    );
  }

  if (!isAddress(request.taker, { strict: false })) {
    throw new ZeroXError("QUOTE_VALIDATION_ERROR", "Taker must be a valid EVM address.");
  }

  const sellAsset = resolveRegisteredAsset(request.sellAsset, "sell");
  const buyAsset = resolveRegisteredAsset(request.buyAsset, "buy");

  if (
    sellAsset.assetStandard !== "ERC20" ||
    !sameAddress(sellAsset.tokenAddress, BASE_MAINNET_USDC.tokenAddress)
  ) {
    throw new ZeroXError(
      "TOKEN_NOT_SUPPORTED",
      "This slice only supports selling Base Mainnet USDC.",
    );
  }

  if (buyAsset.assetStandard !== "B20") {
    throw new ZeroXError(
      "TOKEN_NOT_SUPPORTED",
      "This slice only supports buying an enabled registered B20 stock.",
    );
  }

  return Object.freeze({ buyAsset, sellAsset, taker: getAddress(request.taker) });
}

function diagnostic(body: unknown): ZeroXRemoteDiagnostic {
  const parsed = remoteErrorSchema.safeParse(body);

  if (!parsed.success) return Object.freeze({});

  return Object.freeze({
    ...(parsed.data.name === undefined ? {} : { code: parsed.data.name }),
    ...(parsed.data.message === undefined ? {} : { message: parsed.data.message }),
    ...(parsed.data.data?.zid === undefined ? {} : { zid: parsed.data.data.zid }),
  });
}

function remoteFailure(response: ZeroXHttpResponse): never {
  const remote = diagnostic(response.body);
  const options = { httpStatus: response.status, remote } as const;

  if (remote.code === "XSTOCKS_NOT_AUTHORIZED") {
    throw new ZeroXError(
      "TOKENIZED_EQUITY_ACCESS_REQUIRED",
      "The 0x account is not authorized for tokenized-equity quotes.",
      options,
    );
  }

  if (
    remote.code === "TOKEN_NOT_SUPPORTED" ||
    remote.code === "BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE" ||
    remote.code === "SELL_TOKEN_NOT_AUTHORIZED_FOR_TRADE"
  ) {
    throw new ZeroXError(
      "TOKEN_NOT_SUPPORTED",
      "0x reports that a requested token is unavailable or unauthorized for this trade.",
      options,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ZeroXError("ZEROX_AUTH_ERROR", "0x rejected request authorization.", options);
  }

  if (response.status === 429) {
    throw new ZeroXError("ZEROX_RATE_LIMITED", "0x rate-limited the request.", options);
  }

  if (response.status >= 500) {
    throw new ZeroXError("ZEROX_SERVER_ERROR", "0x could not serve the request.", options);
  }

  throw new ZeroXError("QUOTE_VALIDATION_ERROR", "0x rejected the quote request.", options);
}

class FetchZeroXHttpTransport implements ZeroXHttpTransport {
  async get(request: ZeroXHttpRequest): Promise<ZeroXHttpResponse> {
    let response: Response;

    try {
      response = await fetch(request.url, { headers: request.headers, method: "GET" });
    } catch (error) {
      throw new ZeroXError("ZEROX_SERVER_ERROR", "Unable to reach the 0x API.", { cause: error });
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    return Object.freeze({ body, status: response.status });
  }
}

export class ZeroXSwapClient {
  readonly #config: ZeroXApiConfig;
  readonly #transport: ZeroXHttpTransport;

  constructor(
    config: ZeroXApiConfig = loadZeroXApiConfig(),
    transport: ZeroXHttpTransport = new FetchZeroXHttpTransport(),
  ) {
    this.#config = config;
    this.#transport = transport;
  }

  async #request(endpoint: "price" | "quote", request: ZeroXExactSellRequest): Promise<unknown> {
    const assets = validateRequest(request);
    const parameters = new URLSearchParams({
      buyToken: assets.buyAsset.tokenAddress,
      chainId: String(VECTOR_CHAIN_ID),
      sellAmount: request.sellAmount.toString(),
      sellToken: assets.sellAsset.tokenAddress,
      slippageBps: String(request.slippageBps),
      taker: assets.taker,
    });
    const response = await this.#transport.get({
      headers: { "0x-api-key": this.#config.apiKey, "0x-version": "v2" },
      url: `${this.#config.apiBaseUrl}/swap/allowance-holder/${endpoint}?${parameters.toString()}`,
    });

    if (response.status < 200 || response.status >= 300) remoteFailure(response);

    const noLiquidity = noLiquiditySchema.safeParse(response.body);

    if (noLiquidity.success) {
      throw new ZeroXError("NO_LIQUIDITY", "0x found no liquidity for the registered pair.", {
        httpStatus: response.status,
        remote: { zid: noLiquidity.data.zid },
      });
    }

    return response.body;
  }

  async getPrice(request: ZeroXExactSellRequest): Promise<ZeroXIndicativePrice> {
    const body = await this.#request("price", request);
    const parsed = exactSellResponseSchema.safeParse(body);

    if (!parsed.success) {
      throw new ZeroXError("INVALID_ZEROX_RESPONSE", "0x returned an invalid price response.", {
        cause: parsed.error,
      });
    }

    validateReturnedAmountsAndTokens(request, parsed.data);
    return Object.freeze({ ...parsed.data, kind: "indicative-price" });
  }

  async getQuote(request: ZeroXExactSellRequest): Promise<ZeroXFirmQuote> {
    const body = await this.#request("quote", request);
    const parsed = firmQuoteSchema.safeParse(body);

    if (!parsed.success) {
      throw new ZeroXError(
        "INVALID_ZEROX_RESPONSE",
        "0x returned an invalid firm quote response.",
        {
          cause: parsed.error,
        },
      );
    }

    validateReturnedAmountsAndTokens(request, parsed.data);
    return Object.freeze({ ...parsed.data, kind: "firm-quote" });
  }
}

function validateReturnedAmountsAndTokens(
  request: ZeroXExactSellRequest,
  response: {
    readonly buyAmount: bigint;
    readonly buyToken: EvmAddress;
    readonly sellAmount: bigint;
    readonly sellToken: EvmAddress;
  },
): void {
  if (!sameAddress(response.sellToken, request.sellAsset.tokenAddress)) {
    throw new ZeroXError("QUOTE_VALIDATION_ERROR", "0x returned the wrong sell token.");
  }

  if (!sameAddress(response.buyToken, request.buyAsset.tokenAddress)) {
    throw new ZeroXError("QUOTE_VALIDATION_ERROR", "0x returned the wrong buy token.");
  }

  if (response.sellAmount !== request.sellAmount) {
    throw new ZeroXError(
      "QUOTE_VALIDATION_ERROR",
      "0x sell amount must equal the requested exact-sell amount.",
    );
  }

  if (response.buyAmount <= 0n) {
    throw new ZeroXError("QUOTE_VALIDATION_ERROR", "0x buy amount must be positive.");
  }
}

export function createZeroXSwapClient(
  config: ZeroXApiConfig = loadZeroXApiConfig(),
  transport?: ZeroXHttpTransport,
): ZeroXSwapClient {
  return transport === undefined
    ? new ZeroXSwapClient(config)
    : new ZeroXSwapClient(config, transport);
}

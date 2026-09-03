import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { B20VectorAsset } from "@vector/shared";

import { BASE_MAINNET_TOKENIZED_STOCKS, BASE_MAINNET_USDC } from "./assets.ts";
import {
  B20AdapterError,
  BaseMainnetB20Adapter,
  createBaseMainnetB20Adapter,
} from "./b20-adapter.ts";
import type { BasePublicClient } from "./client.ts";

const nvdac = BASE_MAINNET_TOKENIZED_STOCKS[0];

describe("Base Mainnet B20 adapter boundaries", () => {
  it("rejects an ordinary ERC-20 asset", async () => {
    const adapter = createBaseMainnetB20Adapter();

    await assert.rejects(
      adapter.multiplier(BASE_MAINNET_USDC as unknown as B20VectorAsset),
      (error: unknown) =>
        error instanceof B20AdapterError && error.code === "INVALID_ASSET_ADDRESS",
    );
  });

  it("rejects an unregistered B20 address", async () => {
    const adapter = createBaseMainnetB20Adapter();
    const unregistered = {
      ...nvdac,
      tokenAddress: "0xb20000000000000000000078ee7ce2fE4908108D",
    } as const satisfies B20VectorAsset;

    await assert.rejects(
      adapter.multiplier(unregistered),
      (error: unknown) => error instanceof B20AdapterError && error.code === "ASSET_NOT_REGISTERED",
    );
  });

  it("rejects an invalid account address before making an RPC read", async () => {
    const adapter = createBaseMainnetB20Adapter();

    await assert.rejects(
      adapter.rawBalanceOf(nvdac, "0xinvalid"),
      (error: unknown) =>
        error instanceof B20AdapterError && error.code === "INVALID_ACCOUNT_ADDRESS",
    );
  });

  it("rejects a zero canonical multiplier", async () => {
    const client = {
      readContract: async () => 0n,
    } as unknown as BasePublicClient;
    const adapter = new BaseMainnetB20Adapter(client);

    await assert.rejects(
      adapter.multiplier(nvdac),
      (error: unknown) =>
        error instanceof B20AdapterError && error.code === "MULTIPLIER_READ_FAILED",
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AssetRegistry, AssetRegistryError } from "./asset-registry.ts";
import { InvalidVectorAssetError, parseVectorAsset, type VectorAsset } from "./asset.ts";

const USDC: VectorAsset = {
  assetStandard: "ERC20",
  decimals: 6,
  enabled: true,
  name: "USD Coin",
  symbol: "USDC",
  tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

describe("asset registry", () => {
  it("rejects an invalid asset address", () => {
    assert.throws(
      () => parseVectorAsset({ ...USDC, tokenAddress: "0xinvalid" }),
      InvalidVectorAssetError,
    );
  });

  it("rejects an invalid B20 asset schema", () => {
    assert.throws(
      () =>
        parseVectorAsset({
          ...USDC,
          assetStandard: "B20",
        }),
      InvalidVectorAssetError,
    );
  });

  it("looks up assets case-insensitively by symbol and address", () => {
    const registry = new AssetRegistry([USDC]);

    assert.equal(registry.getBySymbol("usdc"), registry.getBySymbol("USDC"));
    assert.equal(
      registry.getByAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
      registry.getBySymbol("USDC"),
    );
  });

  it("rejects duplicate symbols", () => {
    const registry = new AssetRegistry([USDC]);

    assert.throws(
      () =>
        registry.register({ ...USDC, tokenAddress: "0x0000000000000000000000000000000000000001" }),
      (error: unknown) =>
        error instanceof AssetRegistryError && error.code === "DUPLICATE_ASSET_SYMBOL",
    );
  });

  it("rejects duplicate addresses", () => {
    const registry = new AssetRegistry([USDC]);

    assert.throws(
      () => registry.register({ ...USDC, symbol: "USDC2" }),
      (error: unknown) =>
        error instanceof AssetRegistryError && error.code === "DUPLICATE_ASSET_ADDRESS",
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { B20VectorAsset, Erc20VectorAsset, VectorAsset } from "@vector/shared";

import type { ReferencePriceProvider } from "./price-provider.ts";
import {
  createAssetPrice,
  createB20PortfolioPosition,
  createErc20PortfolioPosition,
  createPortfolioSnapshot,
  type AssetPrice,
  type PortfolioPosition,
  PortfolioDomainError,
  USD_REFERENCE_VALUE_SCALE,
} from "./types.ts";
import {
  PortfolioValuationError,
  valuePortfolio,
  valuePortfolioWithProvider,
} from "./valuation.ts";

const ACCOUNT = "0x0000000000000000000000000000000000000001" as const;
const WAD = 1_000_000_000_000_000_000n;

const USDC = {
  assetStandard: "ERC20",
  decimals: 6,
  enabled: true,
  name: "USD Coin",
  symbol: "USDC",
  tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const satisfies Erc20VectorAsset;

const NVDAC = {
  assetStandard: "B20",
  decimals: 8,
  enabled: true,
  name: "NVIDIA",
  symbol: "NVDAc",
  tokenAddress: "0xb20000000000000000000078ee7ce2fE4908108C",
  underlyingTicker: "NVDA",
} as const satisfies B20VectorAsset;

function snapshot(...positions: PortfolioPosition[]) {
  return createPortfolioSnapshot({
    account: ACCOUNT,
    blockNumber: 100n,
    blockTimestamp: 1_800_000_000n,
    positions,
  });
}

function fixturePrice(asset: VectorAsset, price: bigint, priceDecimals = 8): AssetPrice {
  return createAssetPrice({
    asset,
    observedAt: 1_800_000_000n,
    price,
    priceDecimals,
    source: "TEST FIXTURE PRICE",
  });
}

class TestFixtureReferencePriceProvider implements ReferencePriceProvider {
  readonly #prices: ReadonlyMap<string, AssetPrice>;

  constructor(prices: readonly AssetPrice[]) {
    this.#prices = new Map(prices.map((price) => [price.asset.tokenAddress.toLowerCase(), price]));
  }

  async getPrice(asset: VectorAsset): Promise<AssetPrice> {
    const price = this.#prices.get(asset.tokenAddress.toLowerCase());

    if (price === undefined) {
      throw new Error(`Missing TEST FIXTURE PRICE for ${asset.symbol}.`);
    }

    return price;
  }
}

describe("deterministic portfolio valuation", () => {
  it("values a zero balance at zero", () => {
    const result = valuePortfolio(snapshot(createErc20PortfolioPosition(USDC, 0n)), [
      fixturePrice(USDC, USD_REFERENCE_VALUE_SCALE),
    ]);

    assert.equal(result.positions[0]?.referenceValue, 0n);
    assert.equal(result.totalReferenceValue, 0n);
  });

  it("values USDC without a B20 multiplier", () => {
    const result = valuePortfolio(snapshot(createErc20PortfolioPosition(USDC, 25_500_000n)), [
      fixturePrice(USDC, USD_REFERENCE_VALUE_SCALE),
    ]);

    assert.equal(result.totalReferenceValue, 2_550_000_000n);
  });

  it("values B20 economic units at a one-WAD multiplier", () => {
    const position = createB20PortfolioPosition(NVDAC, 200_000_000n, 200_000_000n, WAD);
    const result = valuePortfolio(snapshot(position), [fixturePrice(NVDAC, 12_500_000_000n)]);

    assert.equal(result.totalReferenceValue, 25_000_000_000n);
  });

  it("uses increased B20 economic exposure when the multiplier is above one WAD", () => {
    const position = createB20PortfolioPosition(NVDAC, 100_000_000n, 200_000_000n, 2n * WAD);
    const result = valuePortfolio(snapshot(position), [fixturePrice(NVDAC, 1_000_000_000n)]);

    assert.equal(result.totalReferenceValue, 2_000_000_000n);
  });

  it("uses reduced B20 economic exposure when the multiplier is below one WAD", () => {
    const position = createB20PortfolioPosition(NVDAC, 100_000_000n, 50_000_000n, WAD / 2n);
    const result = valuePortfolio(snapshot(position), [fixturePrice(NVDAC, 1_000_000_000n)]);

    assert.equal(result.totalReferenceValue, 500_000_000n);
  });

  it("values a mixed ERC-20 and B20 portfolio", async () => {
    const portfolio = snapshot(
      createErc20PortfolioPosition(USDC, 25_000_000n),
      createB20PortfolioPosition(NVDAC, 100_000_000n, 150_000_000n, (3n * WAD) / 2n),
    );
    const provider = new TestFixtureReferencePriceProvider([
      fixturePrice(USDC, USD_REFERENCE_VALUE_SCALE),
      fixturePrice(NVDAC, 20_000_000_000n),
    ]);
    const result = await valuePortfolioWithProvider(portfolio, provider);

    assert.equal(result.positions[0]?.referenceValue, 2_500_000_000n);
    assert.equal(result.positions[1]?.referenceValue, 30_000_000_000n);
    assert.equal(result.totalReferenceValue, 32_500_000_000n);
  });

  it("handles large bigint quantities without overflow", () => {
    const rawBalance = (1n << 200n) - 1n;
    const result = valuePortfolio(snapshot(createErc20PortfolioPosition(USDC, rawBalance)), [
      fixturePrice(USDC, 123_456_789_000_000n, 8),
    ]);
    const expected =
      (rawBalance * 123_456_789_000_000n * USD_REFERENCE_VALUE_SCALE) /
      (1_000_000n * USD_REFERENCE_VALUE_SCALE);

    assert.equal(result.totalReferenceValue, expected);
  });

  it("accounts for the supplied reference-price precision", () => {
    const result = valuePortfolio(snapshot(createErc20PortfolioPosition(USDC, 1_000_000n)), [
      fixturePrice(USDC, 12_345n, 2),
    ]);

    assert.equal(result.totalReferenceValue, 12_345_000_000n);
  });

  it("rounds the final fixed-point valuation down", () => {
    const result = valuePortfolio(
      snapshot(createB20PortfolioPosition(NVDAC, 100_000_001n, 100_000_001n, WAD)),
      [fixturePrice(NVDAC, 123_456_789n)],
    );

    assert.equal(result.totalReferenceValue, 123_456_790n);
  });

  it("rejects duplicate and missing prices", () => {
    const portfolio = snapshot(createErc20PortfolioPosition(USDC, 1_000_000n));
    const price = fixturePrice(USDC, USD_REFERENCE_VALUE_SCALE);

    assert.throws(
      () => valuePortfolio(portfolio, [price, price]),
      (error: unknown) =>
        error instanceof PortfolioValuationError && error.code === "DUPLICATE_PRICE",
    );
    assert.throws(
      () => valuePortfolio(portfolio, []),
      (error: unknown) =>
        error instanceof PortfolioValuationError && error.code === "MISSING_PRICE",
    );
  });

  it("rejects unsupported asset standards", () => {
    const unsupportedPosition = {
      asset: { ...USDC, assetStandard: "UNKNOWN" },
      rawBalance: 0n,
      tokenDecimals: 6,
    } as unknown as PortfolioPosition;

    assert.throws(
      () => snapshot(unsupportedPosition),
      (error: unknown) =>
        error instanceof PortfolioDomainError && error.code === "UNSUPPORTED_ASSET",
    );
  });
});

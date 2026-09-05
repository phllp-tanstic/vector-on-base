import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  createB20PortfolioPosition,
  createPortfolioSnapshot,
  valuePortfolioWithProvider,
} from "@vector/portfolio";
import type { VectorAsset } from "@vector/shared";

import { BASE_MAINNET_TOKENIZED_STOCKS } from "../base/assets.ts";
import {
  CHAINLINK_REFERENCE_PRICE_MANIFEST,
  getChainlinkReferenceSource,
} from "./reference-price-manifest.ts";
import {
  CHAINLINK_DATA_STREAMS_PRICE_DECIMALS,
  CHAINLINK_DATA_STREAMS_PROVIDER,
  ChainlinkReferencePriceError,
  createChainlinkDataStreamsReferencePriceProvider,
  type ChainlinkDataStreamsReportReader,
  type ChainlinkDecodedReferenceReport,
  validateChainlinkReferenceReport,
} from "./reference-price.ts";

const NOW = 1_800_000_000n;
const WAD = 1_000_000_000_000_000_000n;
const NVDA = BASE_MAINNET_TOKENIZED_STOCKS[0];
const NVDA_SOURCE = getChainlinkReferenceSource("NVDAc")!;

function report(
  overrides: Partial<ChainlinkDecodedReferenceReport> = {},
): ChainlinkDecodedReferenceReport {
  return {
    feedId: NVDA_SOURCE.feedIds.regular,
    lastSeenTimestampNs: (NOW - 60n) * 1_000_000_000n,
    marketStatus: 2,
    mid: 180n * 10n ** 18n,
    quoteCurrency: "USD",
    schemaVersion: "V11",
    ...overrides,
  };
}

function validate(overrides: Partial<ChainlinkDecodedReferenceReport> = {}) {
  return validateChainlinkReferenceReport({
    asset: NVDA,
    nowSeconds: NOW,
    report: report(overrides),
    source: NVDA_SOURCE,
  });
}

function rejectsCode(code: ChainlinkReferencePriceError["code"]) {
  return (error: unknown) => error instanceof ChainlinkReferencePriceError && error.code === code;
}

describe("Chainlink Data Streams reference source manifest", () => {
  it("pins exact production V11 USD source IDs for every supported stock", () => {
    const expected = {
      AAPLc: {
        regular: "0x000bbd87a23775b4c11092ae9a1fc7b3393636ae1dbb9f1ef460f845c0f4cff1",
        ticker: "AAPL",
      },
      GOOGLc: {
        regular: "0x000b1a2aa24db17599e5003a09bcd5e2a15ef66f79c2dca4dde108ab923b1e97",
        ticker: "GOOGL",
      },
      METAc: {
        regular: "0x000bc63e601958daafb805b1eecc3972a0ad231e8c08c0432961b7b5c3251166",
        ticker: "META",
      },
      NVDAc: {
        regular: "0x000b6aa036224454037bab103184565f6aa9ea589c3b349f6d8471ee753524b9",
        ticker: "NVDA",
      },
    } as const;

    for (const asset of BASE_MAINNET_TOKENIZED_STOCKS) {
      const source = getChainlinkReferenceSource(asset.symbol);
      assert.ok(source);
      assert.equal(source.underlyingTicker, expected[asset.symbol].ticker);
      assert.equal(source.feedIds.regular, expected[asset.symbol].regular);
      assert.equal(source.quoteCurrency, "USD");
      assert.equal(source.schemaVersion, "V11");
      for (const feedId of Object.values(source.feedIds)) {
        assert.match(feedId, /^0x[0-9a-f]{64}$/);
      }
    }
    assert.match(CHAINLINK_REFERENCE_PRICE_MANIFEST.version, /^chainlink-data-streams-/);
  });

  it("does not derive arbitrary symbols", () => {
    assert.equal(getChainlinkReferenceSource("TSLAc"), undefined);
    assert.equal(getChainlinkReferenceSource("nvdaC"), undefined);
  });
});

describe("Chainlink reference report validation", () => {
  it("accepts a fresh positive integer price and preserves metadata", () => {
    const price = validate();
    assert.equal(price.asset, NVDA);
    assert.equal(price.price, 180n * 10n ** 18n);
    assert.equal(price.priceDecimals, CHAINLINK_DATA_STREAMS_PRICE_DECIMALS);
    assert.equal(price.observedAt, NOW - 60n);
    assert.equal(price.source, CHAINLINK_DATA_STREAMS_PROVIDER);
    assert.equal(price.sourceIdentifier, NVDA_SOURCE.feedIds.regular);
    assert.equal(price.marketStatus, "REGULAR");
  });

  it("rejects missing, future, and stale timestamps", () => {
    assert.throws(
      () => validate({ lastSeenTimestampNs: undefined }),
      rejectsCode("MISSING_TIMESTAMP"),
    );
    assert.throws(
      () => validate({ lastSeenTimestampNs: (NOW + 31n) * 1_000_000_000n }),
      rejectsCode("FUTURE_TIMESTAMP"),
    );
    assert.throws(
      () => validate({ lastSeenTimestampNs: (NOW - 301n) * 1_000_000_000n }),
      rejectsCode("STALE_PRICE"),
    );
  });

  it("allows a bounded last valid reference while the market is closed", () => {
    const price = validate({
      lastSeenTimestampNs: (NOW - 72n * 60n * 60n) * 1_000_000_000n,
      marketStatus: 5,
    });
    assert.equal(price.marketStatus, "CLOSED");
    assert.throws(
      () =>
        validate({
          lastSeenTimestampNs: (NOW - 96n * 60n * 60n - 1n) * 1_000_000_000n,
          marketStatus: 5,
        }),
      rejectsCode("STALE_PRICE"),
    );
  });

  it("rejects zero and negative prices", () => {
    assert.throws(() => validate({ mid: 0n }), rejectsCode("NON_POSITIVE_PRICE"));
    assert.throws(() => validate({ mid: -1n }), rejectsCode("NON_POSITIVE_PRICE"));
  });

  it("rejects source-ID mismatch, wrong quote currency, and unknown status", () => {
    assert.throws(
      () => validate({ feedId: NVDA_SOURCE.feedIds.overnight }),
      rejectsCode("SOURCE_ID_MISMATCH"),
    );
    assert.throws(() => validate({ quoteCurrency: "EUR" }), rejectsCode("WRONG_QUOTE_CURRENCY"));
    assert.throws(() => validate({ marketStatus: 0 }), rejectsCode("MARKET_STATUS_UNKNOWN"));
  });

  it("rejects an asset whose identity is not exactly pinned", () => {
    const arbitrary = { ...NVDA, symbol: "TSLAc", underlyingTicker: "TSLA" } as VectorAsset;
    assert.throws(
      () =>
        validateChainlinkReferenceReport({
          asset: arbitrary,
          nowSeconds: NOW,
          report: report(),
          source: NVDA_SOURCE,
        }),
      rejectsCode("UNSUPPORTED_ASSET"),
    );
  });
});

describe("Chainlink production provider boundary", () => {
  it("routes pre/post and overnight status to the explicitly pinned phase feed", async () => {
    const requested: string[] = [];
    const reader: ChainlinkDataStreamsReportReader = {
      async getLatestReport(feedId) {
        requested.push(feedId);
        if (feedId === NVDA_SOURCE.feedIds.regular) {
          return report({ marketStatus: 4 });
        }
        return report({ feedId, marketStatus: 4 });
      },
    };
    const provider = createChainlinkDataStreamsReferencePriceProvider({
      nowSeconds: () => NOW,
      reader,
    });
    const price = await provider.getPrice(NVDA);

    assert.deepEqual(requested, [NVDA_SOURCE.feedIds.regular, NVDA_SOURCE.feedIds.overnight]);
    assert.equal(price.sourceIdentifier, NVDA_SOURCE.feedIds.overnight);
    assert.equal(price.marketStatus, "OVERNIGHT");
  });

  it("turns provider failure into a typed fail-closed error", async () => {
    const provider = createChainlinkDataStreamsReferencePriceProvider({
      nowSeconds: () => NOW,
      reader: { getLatestReport: async () => Promise.reject(new Error("offline")) },
    });
    await assert.rejects(provider.getPrice(NVDA), rejectsCode("PROVIDER_UNAVAILABLE"));
  });

  it("values B20 economic amount with the verified reference and leaves raw units unchanged", async () => {
    const rawBalance = 100_000_000n;
    const economicBalance = 200_000_000n;
    const position = createB20PortfolioPosition(NVDA, rawBalance, economicBalance, 2n * WAD);
    const provider = createChainlinkDataStreamsReferencePriceProvider({
      nowSeconds: () => NOW,
      reader: { getLatestReport: async () => report() },
    });
    const result = await valuePortfolioWithProvider(
      createPortfolioSnapshot({
        account: "0x0000000000000000000000000000000000000001",
        blockNumber: 1n,
        blockTimestamp: NOW,
        positions: [position],
      }),
      provider,
    );

    assert.equal(result.positions[0]?.position.rawBalance, rawBalance);
    assert.equal(result.positions[0]?.economicAmount, economicBalance);
    assert.equal(result.positions[0]?.referencePrice.sourceIdentifier, NVDA_SOURCE.feedIds.regular);
    assert.equal(result.totalReferenceValue, 36_000_000_000n);
  });

  it("introduces no write, transaction, or signing method", () => {
    const source = readFileSync(new URL("./reference-price.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /sendTransaction|signMessage|signTransaction|writeContract/);
  });
});

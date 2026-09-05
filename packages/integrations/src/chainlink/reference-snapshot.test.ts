import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BASE_MAINNET_TOKENIZED_STOCKS } from "../base/assets.ts";
import { getChainlinkReferenceSource } from "./reference-price-manifest.ts";
import {
  type ChainlinkDataStreamsReferencePriceProvider,
  type ChainlinkReferencePrice,
  ChainlinkReferencePriceError,
  validateChainlinkReferenceReport,
} from "./reference-price.ts";
import { createAssetPrice } from "@vector/portfolio";
import {
  assertChainlinkReferenceSnapshotFresh,
  captureChainlinkReferencePriceSnapshot,
} from "./reference-snapshot.ts";

const NOW = 1_800_000_000n;

function priceFor(
  asset: (typeof BASE_MAINNET_TOKENIZED_STOCKS)[number],
  observedAt = NOW - 60n,
): ChainlinkReferencePrice {
  const source = getChainlinkReferenceSource(asset.symbol)!;
  return validateChainlinkReferenceReport({
    asset,
    nowSeconds: NOW,
    report: {
      feedId: source.feedIds.regular,
      lastSeenTimestampNs: observedAt * 1_000_000_000n,
      marketStatus: 2,
      mid: 100n * 10n ** 18n,
      quoteCurrency: "USD",
      schemaVersion: "V11",
    },
    source,
  });
}

describe("coherent Chainlink reference snapshots", () => {
  it("captures each required constituent exactly once and hashes immutable contents", async () => {
    const calls = new Map<string, number>();
    const provider: ChainlinkDataStreamsReferencePriceProvider = {
      async getPrice(asset) {
        calls.set(asset.symbol, (calls.get(asset.symbol) ?? 0) + 1);
        const registered = BASE_MAINNET_TOKENIZED_STOCKS.find(
          (candidate) => candidate.symbol === asset.symbol,
        );
        assert.ok(registered);
        return priceFor(registered);
      },
    };
    const first = await captureChainlinkReferencePriceSnapshot({
      nowSeconds: () => NOW,
      provider,
    });
    const second = await captureChainlinkReferencePriceSnapshot({
      nowSeconds: () => NOW,
      provider,
    });

    assert.equal(first.prices.length, 4);
    assert.equal(first.snapshotId, second.snapshotId);
    assert.deepEqual(
      first.prices.map((price) => price.asset.symbol),
      ["NVDAc", "AAPLc", "GOOGLc", "METAc"],
    );
    for (const asset of BASE_MAINNET_TOKENIZED_STOCKS) {
      assert.equal(calls.get(asset.symbol), 2);
    }
  });

  it("rejects a constituent that becomes stale before snapshot completion", async () => {
    const provider: ChainlinkDataStreamsReferencePriceProvider = {
      async getPrice(asset) {
        const registered = BASE_MAINNET_TOKENIZED_STOCKS.find(
          (candidate) => candidate.symbol === asset.symbol,
        );
        assert.ok(registered);
        return priceFor(registered);
      },
    };

    await assert.rejects(
      captureChainlinkReferencePriceSnapshot({
        nowSeconds: () => NOW + 241n,
        provider,
      }),
      (error: unknown) =>
        error instanceof ChainlinkReferencePriceError && error.code === "STALE_REPORT",
    );
  });

  it("detects constituent tampering through the deterministic snapshot ID", async () => {
    const provider: ChainlinkDataStreamsReferencePriceProvider = {
      async getPrice(asset) {
        const registered = BASE_MAINNET_TOKENIZED_STOCKS.find(
          (candidate) => candidate.symbol === asset.symbol,
        );
        assert.ok(registered);
        return priceFor(registered);
      },
    };
    const snapshot = await captureChainlinkReferencePriceSnapshot({
      nowSeconds: () => NOW,
      provider,
    });
    const replacement = createAssetPrice({
      ...snapshot.prices[0]!,
      price: snapshot.prices[0]!.price + 1n,
    });
    const tampered = {
      ...snapshot,
      prices: [{ ...snapshot.prices[0]!, price: replacement.price }, ...snapshot.prices.slice(1)],
    };

    assert.throws(
      () => assertChainlinkReferenceSnapshotFresh({ nowSeconds: NOW, snapshot: tampered }),
      (error: unknown) =>
        error instanceof ChainlinkReferencePriceError && error.code === "MALFORMED_REPORT",
    );
  });
});

import { keccak256, stringToHex, type Hex } from "viem";

import { BASE_MAINNET_TOKENIZED_STOCKS } from "../base/assets.ts";
import {
  CHAINLINK_REFERENCE_PRICE_MANIFEST_VERSION,
  getChainlinkReferenceSource,
} from "./reference-price-manifest.ts";
import {
  DEFAULT_CHAINLINK_FRESHNESS_POLICY,
  type ChainlinkDataStreamsReferencePriceProvider,
  type ChainlinkFreshnessPolicy,
  type ChainlinkMarketStatus,
  type ChainlinkReferencePrice,
  ChainlinkReferencePriceError,
  validateChainlinkReferenceReport,
} from "./reference-price.ts";

export interface ChainlinkReferencePriceSnapshot {
  readonly createdAt: bigint;
  readonly manifestVersion: typeof CHAINLINK_REFERENCE_PRICE_MANIFEST_VERSION;
  readonly prices: readonly ChainlinkReferencePrice[];
  readonly snapshotId: Hex;
}

function numericMarketStatus(status: ChainlinkMarketStatus): number {
  switch (status) {
    case "PRE_MARKET":
      return 1;
    case "REGULAR":
      return 2;
    case "POST_MARKET":
      return 3;
    case "OVERNIGHT":
      return 4;
    case "CLOSED":
      return 5;
  }
}

function validateConstituent(
  price: ChainlinkReferencePrice,
  nowSeconds: bigint,
  policy: ChainlinkFreshnessPolicy,
): ChainlinkReferencePrice {
  const source = getChainlinkReferenceSource(price.asset.symbol);
  if (!source) {
    throw new ChainlinkReferencePriceError(
      "UNSUPPORTED_ASSET",
      `${price.asset.symbol} is not in the trusted reference manifest.`,
    );
  }
  return validateChainlinkReferenceReport({
    asset: price.asset,
    nowSeconds,
    policy,
    report: {
      feedId: price.sourceIdentifier,
      lastSeenTimestampNs: price.observedAt * 1_000_000_000n,
      marketStatus: numericMarketStatus(price.marketStatus),
      mid: price.price,
      quoteCurrency: price.quoteCurrency,
      schemaVersion: source.schemaVersion,
    },
    source,
  });
}

function snapshotHash(createdAt: bigint, prices: readonly ChainlinkReferencePrice[]): Hex {
  const canonical = [
    CHAINLINK_REFERENCE_PRICE_MANIFEST_VERSION,
    createdAt.toString(),
    ...prices.flatMap((price) => [
      price.asset.symbol,
      price.asset.tokenAddress.toLowerCase(),
      price.price.toString(),
      price.priceDecimals.toString(),
      price.observedAt.toString(),
      price.sourceIdentifier.toLowerCase(),
      price.marketStatus,
      price.selectedFeedRole,
    ]),
  ].join("|");
  return keccak256(stringToHex(canonical));
}

/** Captures each required stock once, then validates every constituent at one completion time. */
export async function captureChainlinkReferencePriceSnapshot(input: {
  readonly nowSeconds?: () => bigint;
  readonly policy?: ChainlinkFreshnessPolicy;
  readonly provider: ChainlinkDataStreamsReferencePriceProvider;
}): Promise<ChainlinkReferencePriceSnapshot> {
  const nowSeconds = input.nowSeconds ?? (() => BigInt(Math.floor(Date.now() / 1_000)));
  const policy = input.policy ?? DEFAULT_CHAINLINK_FRESHNESS_POLICY;
  const fetched = await Promise.all(
    BASE_MAINNET_TOKENIZED_STOCKS.map((asset) => input.provider.getPrice(asset)),
  );
  const createdAt = nowSeconds();
  const prices = Object.freeze(
    fetched.map((price, index) => {
      const expectedAsset = BASE_MAINNET_TOKENIZED_STOCKS[index];
      if (
        !expectedAsset ||
        price.asset.tokenAddress.toLowerCase() !== expectedAsset.tokenAddress.toLowerCase() ||
        price.asset.symbol !== expectedAsset.symbol
      ) {
        throw new ChainlinkReferencePriceError(
          "SOURCE_ID_MISMATCH",
          "Reference snapshot constituent order or asset identity is invalid.",
        );
      }
      return validateConstituent(price, createdAt, policy);
    }),
  );
  return Object.freeze({
    createdAt,
    manifestVersion: CHAINLINK_REFERENCE_PRICE_MANIFEST_VERSION,
    prices,
    snapshotId: snapshotHash(createdAt, prices),
  });
}

export function assertChainlinkReferenceSnapshotFresh(input: {
  readonly nowSeconds: bigint;
  readonly policy?: ChainlinkFreshnessPolicy;
  readonly snapshot: ChainlinkReferencePriceSnapshot;
}): void {
  const policy = input.policy ?? DEFAULT_CHAINLINK_FRESHNESS_POLICY;
  if (input.snapshot.prices.length !== BASE_MAINNET_TOKENIZED_STOCKS.length) {
    throw new ChainlinkReferencePriceError(
      "MALFORMED_REPORT",
      "Reference snapshot does not contain every required stock exactly once.",
    );
  }
  for (const [index, price] of input.snapshot.prices.entries()) {
    const expectedAsset = BASE_MAINNET_TOKENIZED_STOCKS[index];
    if (
      !expectedAsset ||
      price.asset.symbol !== expectedAsset.symbol ||
      price.asset.tokenAddress.toLowerCase() !== expectedAsset.tokenAddress.toLowerCase()
    ) {
      throw new ChainlinkReferencePriceError(
        "MALFORMED_REPORT",
        "Reference snapshot constituent order or asset identity is invalid.",
      );
    }
    validateConstituent(price, input.nowSeconds, policy);
  }
  if (snapshotHash(input.snapshot.createdAt, input.snapshot.prices) !== input.snapshot.snapshotId) {
    throw new ChainlinkReferencePriceError(
      "MALFORMED_REPORT",
      "Reference snapshot identity does not match its immutable constituents.",
    );
  }
}

export function findSnapshotPrice(
  snapshot: ChainlinkReferencePriceSnapshot,
  symbol: string,
): ChainlinkReferencePrice | undefined {
  return snapshot.prices.find((price) => price.asset.symbol === symbol);
}

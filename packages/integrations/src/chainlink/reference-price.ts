import {
  createClient,
  decodeReport,
  type DataStreamsClient,
  type DecodedV11Report,
} from "@chainlink/data-streams-sdk";
import { createAssetPrice, type AssetPrice, type ReferencePriceProvider } from "@vector/portfolio";
import type { VectorAsset } from "@vector/shared";

import {
  getChainlinkReferenceSource,
  type ChainlinkEquityMarketPhase,
  type ChainlinkReferenceSource,
} from "./reference-price-manifest.ts";

export const CHAINLINK_DATA_STREAMS_PRICE_DECIMALS = 18 as const;
export const CHAINLINK_DATA_STREAMS_PROVIDER = "CHAINLINK_DATA_STREAMS" as const;
export const CHAINLINK_DATA_STREAMS_REST_ENDPOINT = "https://api.dataengine.chain.link" as const;
export const CHAINLINK_DATA_STREAMS_WEBSOCKET_ENDPOINT = "wss://ws.dataengine.chain.link" as const;

export type ChainlinkMarketStatus =
  "CLOSED" | "OVERNIGHT" | "POST_MARKET" | "PRE_MARKET" | "REGULAR";

export type ChainlinkReferencePriceErrorCode =
  | "CONFIGURATION_ERROR"
  | "FUTURE_TIMESTAMP"
  | "INVALID_REPORT"
  | "MARKET_STATUS_UNKNOWN"
  | "MISSING_TIMESTAMP"
  | "NON_POSITIVE_PRICE"
  | "PROVIDER_UNAVAILABLE"
  | "SOURCE_ID_MISMATCH"
  | "STALE_PRICE"
  | "UNSUPPORTED_ASSET"
  | "WRONG_QUOTE_CURRENCY";

export class ChainlinkReferencePriceError extends Error {
  readonly code: ChainlinkReferencePriceErrorCode;

  constructor(code: ChainlinkReferencePriceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export interface ChainlinkFreshnessPolicy {
  readonly activeMaximumAgeSeconds: bigint;
  readonly closedMaximumAgeSeconds: bigint;
  readonly futureToleranceSeconds: bigint;
}

export const DEFAULT_CHAINLINK_FRESHNESS_POLICY = Object.freeze({
  activeMaximumAgeSeconds: 300n,
  closedMaximumAgeSeconds: 345_600n,
  futureToleranceSeconds: 30n,
}) satisfies ChainlinkFreshnessPolicy;

export interface ChainlinkDecodedReferenceReport {
  readonly feedId: string;
  readonly lastSeenTimestampNs?: bigint | undefined;
  readonly marketStatus: number;
  readonly mid: bigint;
  readonly quoteCurrency: string;
  readonly schemaVersion: string;
}

export interface ChainlinkDataStreamsReportReader {
  getLatestReport(feedId: string): Promise<ChainlinkDecodedReferenceReport>;
}

export interface ChainlinkReferencePrice extends AssetPrice {
  readonly marketStatus: ChainlinkMarketStatus;
  readonly quoteCurrency: "USD";
  readonly sourceIdentifier: `0x${string}`;
}

export interface ChainlinkDataStreamsReferencePriceProvider extends ReferencePriceProvider {
  getPrice(asset: VectorAsset): Promise<ChainlinkReferencePrice>;
}

function marketStatusName(status: number): ChainlinkMarketStatus {
  switch (status) {
    case 1:
      return "PRE_MARKET";
    case 2:
      return "REGULAR";
    case 3:
      return "POST_MARKET";
    case 4:
      return "OVERNIGHT";
    case 5:
      return "CLOSED";
    default:
      throw new ChainlinkReferencePriceError(
        status === 0 ? "MARKET_STATUS_UNKNOWN" : "INVALID_REPORT",
        `Chainlink market status ${status} is not usable.`,
      );
  }
}

function selectedPhase(status: ChainlinkMarketStatus): ChainlinkEquityMarketPhase {
  switch (status) {
    case "PRE_MARKET":
    case "POST_MARKET":
      return "extended";
    case "REGULAR":
    case "CLOSED":
      return "regular";
    case "OVERNIGHT":
      return "overnight";
  }
}

function sameAsset(asset: VectorAsset, source: ChainlinkReferenceSource): boolean {
  return (
    asset.assetStandard === "B20" &&
    asset.underlyingTicker === source.underlyingTicker &&
    getChainlinkReferenceSource(asset.symbol) === source
  );
}

export function validateChainlinkReferenceReport(input: {
  readonly asset: VectorAsset;
  readonly nowSeconds: bigint;
  readonly policy?: ChainlinkFreshnessPolicy;
  readonly report: ChainlinkDecodedReferenceReport;
  readonly source: ChainlinkReferenceSource;
}): ChainlinkReferencePrice {
  const policy = input.policy ?? DEFAULT_CHAINLINK_FRESHNESS_POLICY;
  const { asset, nowSeconds, report, source } = input;
  if (
    nowSeconds < 0n ||
    policy.activeMaximumAgeSeconds <= 0n ||
    policy.closedMaximumAgeSeconds <= 0n ||
    policy.futureToleranceSeconds < 0n
  ) {
    throw new ChainlinkReferencePriceError(
      "CONFIGURATION_ERROR",
      "Reference-price clock and freshness policy must use valid non-negative bounds.",
    );
  }
  if (!sameAsset(asset, source)) {
    throw new ChainlinkReferencePriceError(
      "UNSUPPORTED_ASSET",
      `${asset.symbol} is not pinned to this reference source.`,
    );
  }
  if (report.quoteCurrency !== source.quoteCurrency) {
    throw new ChainlinkReferencePriceError(
      "WRONG_QUOTE_CURRENCY",
      `Expected ${source.quoteCurrency}, received ${report.quoteCurrency}.`,
    );
  }
  if (report.schemaVersion !== source.schemaVersion) {
    throw new ChainlinkReferencePriceError(
      "INVALID_REPORT",
      `Expected ${source.schemaVersion}, received ${report.schemaVersion}.`,
    );
  }
  const status = marketStatusName(report.marketStatus);
  const phase = selectedPhase(status);
  const expectedFeedId = source.feedIds[phase];
  if (report.feedId.toLowerCase() !== expectedFeedId.toLowerCase()) {
    throw new ChainlinkReferencePriceError(
      "SOURCE_ID_MISMATCH",
      `Report source does not match the pinned ${phase} feed for ${asset.symbol}.`,
    );
  }
  if (report.mid <= 0n) {
    throw new ChainlinkReferencePriceError(
      "NON_POSITIVE_PRICE",
      "Reference price must be greater than zero.",
    );
  }
  if (report.lastSeenTimestampNs === undefined || report.lastSeenTimestampNs <= 0n) {
    throw new ChainlinkReferencePriceError(
      "MISSING_TIMESTAMP",
      "Chainlink mid-price timestamp is missing.",
    );
  }
  const observedAt = report.lastSeenTimestampNs / 1_000_000_000n;
  if (observedAt > nowSeconds + policy.futureToleranceSeconds) {
    throw new ChainlinkReferencePriceError(
      "FUTURE_TIMESTAMP",
      "Chainlink mid-price timestamp is beyond the configured clock tolerance.",
    );
  }
  const maximumAge =
    status === "CLOSED" ? policy.closedMaximumAgeSeconds : policy.activeMaximumAgeSeconds;
  if (nowSeconds > observedAt && nowSeconds - observedAt > maximumAge) {
    throw new ChainlinkReferencePriceError(
      "STALE_PRICE",
      `Chainlink mid-price is older than the ${maximumAge}-second ${status.toLowerCase()} limit.`,
    );
  }

  const price = createAssetPrice({
    asset,
    marketStatus: status,
    observedAt,
    price: report.mid,
    priceDecimals: CHAINLINK_DATA_STREAMS_PRICE_DECIMALS,
    quoteCurrency: source.quoteCurrency,
    source: CHAINLINK_DATA_STREAMS_PROVIDER,
    sourceIdentifier: expectedFeedId,
  });
  return Object.freeze({
    ...price,
    marketStatus: status,
    quoteCurrency: source.quoteCurrency,
    sourceIdentifier: expectedFeedId,
  });
}

function decodedReport(
  report: Awaited<ReturnType<DataStreamsClient["getLatestReport"]>>,
): ChainlinkDecodedReferenceReport {
  const decoded = decodeReport(report.fullReport, report.feedID);
  if (decoded.version !== "V11") {
    throw new ChainlinkReferencePriceError(
      "INVALID_REPORT",
      `Expected Chainlink V11 report, received ${decoded.version}.`,
    );
  }
  const v11 = decoded as DecodedV11Report;
  return Object.freeze({
    feedId: report.feedID,
    lastSeenTimestampNs: v11.lastSeenTimestampNs,
    marketStatus: v11.marketStatus,
    mid: v11.mid,
    quoteCurrency: "USD",
    schemaVersion: v11.version,
  });
}

export function createChainlinkDataStreamsReportReader(config: {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly userSecret: string;
}): ChainlinkDataStreamsReportReader {
  if (!config.apiKey.trim() || !config.userSecret.trim()) {
    throw new ChainlinkReferencePriceError(
      "CONFIGURATION_ERROR",
      "Chainlink Data Streams API key and user secret are required.",
    );
  }
  const client = createClient({
    apiKey: config.apiKey,
    endpoint: CHAINLINK_DATA_STREAMS_REST_ENDPOINT,
    retryAttempts: 1,
    ...(config.timeoutMs === undefined ? {} : { timeout: config.timeoutMs }),
    userSecret: config.userSecret,
    wsEndpoint: CHAINLINK_DATA_STREAMS_WEBSOCKET_ENDPOINT,
  });
  return Object.freeze({
    async getLatestReport(feedId: string) {
      try {
        return decodedReport(await client.getLatestReport(feedId));
      } catch (error) {
        if (error instanceof ChainlinkReferencePriceError) throw error;
        throw new ChainlinkReferencePriceError(
          "PROVIDER_UNAVAILABLE",
          "Chainlink Data Streams report read failed.",
          { cause: error },
        );
      }
    },
  });
}

export function createChainlinkDataStreamsReferencePriceProvider(input: {
  readonly nowSeconds?: () => bigint;
  readonly policy?: ChainlinkFreshnessPolicy;
  readonly reader: ChainlinkDataStreamsReportReader;
}): ChainlinkDataStreamsReferencePriceProvider {
  const nowSeconds = input.nowSeconds ?? (() => BigInt(Math.floor(Date.now() / 1_000)));
  return Object.freeze({
    async getPrice(asset: VectorAsset): Promise<ChainlinkReferencePrice> {
      const source = getChainlinkReferenceSource(asset.symbol);
      if (!source || !sameAsset(asset, source)) {
        throw new ChainlinkReferencePriceError(
          "UNSUPPORTED_ASSET",
          `${asset.symbol} has no trusted Chainlink reference source.`,
        );
      }
      let routingReport: ChainlinkDecodedReferenceReport;
      try {
        routingReport = await input.reader.getLatestReport(source.feedIds.regular);
      } catch (error) {
        if (error instanceof ChainlinkReferencePriceError) throw error;
        throw new ChainlinkReferencePriceError(
          "PROVIDER_UNAVAILABLE",
          "Chainlink Data Streams routing report read failed.",
          { cause: error },
        );
      }
      if (routingReport.feedId.toLowerCase() !== source.feedIds.regular.toLowerCase()) {
        throw new ChainlinkReferencePriceError(
          "SOURCE_ID_MISMATCH",
          `Routing report source does not match the pinned regular feed for ${asset.symbol}.`,
        );
      }
      const status = marketStatusName(routingReport.marketStatus);
      const phase = selectedPhase(status);
      let selectedReport = routingReport;
      if (phase !== "regular") {
        try {
          selectedReport = await input.reader.getLatestReport(source.feedIds[phase]);
        } catch (error) {
          if (error instanceof ChainlinkReferencePriceError) throw error;
          throw new ChainlinkReferencePriceError(
            "PROVIDER_UNAVAILABLE",
            `Chainlink Data Streams ${phase} report read failed.`,
            { cause: error },
          );
        }
      }
      return validateChainlinkReferenceReport({
        asset,
        nowSeconds: nowSeconds(),
        ...(input.policy === undefined ? {} : { policy: input.policy }),
        report: selectedReport,
        source,
      });
    },
  });
}

export function createConfiguredChainlinkReferencePriceProvider(
  environment: NodeJS.ProcessEnv = process.env,
): ChainlinkDataStreamsReferencePriceProvider | undefined {
  const apiKey = environment.CHAINLINK_DATA_STREAMS_API_KEY?.trim();
  const userSecret = environment.CHAINLINK_DATA_STREAMS_USER_SECRET?.trim();
  if (!apiKey && !userSecret) return undefined;
  if (!apiKey || !userSecret) {
    throw new ChainlinkReferencePriceError(
      "CONFIGURATION_ERROR",
      "Both CHAINLINK_DATA_STREAMS_API_KEY and CHAINLINK_DATA_STREAMS_USER_SECRET are required.",
    );
  }
  return createChainlinkDataStreamsReferencePriceProvider({
    reader: createChainlinkDataStreamsReportReader({ apiKey, userSecret }),
  });
}

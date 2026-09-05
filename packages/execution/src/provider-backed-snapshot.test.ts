import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { B20_WAD_PRECISION, b20Multiplier, b20RawAmount, b20UIAmount } from "@vector/b20";
import {
  BASE_MAINNET_ASSET_REGISTRY,
  BASE_MAINNET_TOKENIZED_STOCKS,
  BASE_MAINNET_USDC,
  captureChainlinkReferencePriceSnapshot,
  getChainlinkReferenceSource,
  type BasePortfolioBalanceRead,
  type ChainlinkDataStreamsReferencePriceProvider,
  validateChainlinkReferenceReport,
} from "@vector/integrations";
import { validateExecutionCandidate } from "@vector/risk";

import type { VectorExecutionQuote } from "./external-quote.ts";
import {
  buildProviderBackedExecutionCandidate,
  CANONICAL_USDC_ONE_USD_POLICY,
  createProviderBackedPortfolioRiskSnapshot,
} from "./provider-backed-snapshot.ts";

const NOW = 1_800_000_000n;
const OWNER = "0x0000000000000000000000000000000000000001" as const;

async function referenceSnapshot() {
  const provider: ChainlinkDataStreamsReferencePriceProvider = {
    async getPrice(asset) {
      const registered = BASE_MAINNET_TOKENIZED_STOCKS.find(
        (candidate) => candidate.symbol === asset.symbol,
      );
      assert.ok(registered);
      const source = getChainlinkReferenceSource(registered.symbol)!;
      return validateChainlinkReferenceReport({
        asset: registered,
        nowSeconds: NOW,
        report: {
          feedId: source.feedIds.regular,
          lastSeenTimestampNs: (NOW - 30n) * 1_000_000_000n,
          marketStatus: 2,
          mid: 100n * 10n ** 18n,
          quoteCurrency: "USD",
          schemaVersion: "V11",
        },
        source,
      });
    },
  };
  return captureChainlinkReferencePriceSnapshot({ nowSeconds: () => NOW, provider });
}

function balanceRead(): BasePortfolioBalanceRead {
  return Object.freeze({
    account: OWNER,
    blockNumber: 42n,
    blockTimestamp: NOW - 1n,
    positions: Object.freeze([
      {
        asset: BASE_MAINNET_USDC,
        rawBalance: 1_000_000_000n,
        tokenDecimals: BASE_MAINNET_USDC.decimals,
      },
      ...BASE_MAINNET_TOKENIZED_STOCKS.map((asset) => ({
        asset,
        economicBalance: b20UIAmount(100_000_000n),
        multiplier: b20Multiplier(B20_WAD_PRECISION),
        rawBalance: b20RawAmount(100_000_000n),
        tokenDecimals: asset.decimals,
      })),
    ]),
  });
}

function quote(): VectorExecutionQuote {
  const buyAsset = BASE_MAINNET_TOKENIZED_STOCKS[0];
  return Object.freeze({
    allowanceTarget: "0x0000000000001fF3684f28c67538d4D072C22734",
    buyAsset,
    chainId: 8453,
    issues: {
      allowance: null,
      balance: null,
      invalidSourcesPassed: [],
      simulationIncomplete: false,
    },
    kind: "firm-execution-quote",
    minBuyAmount: 198_000_000n,
    quoteBlockNumber: 42n,
    quoteTimestamp: "2027-01-15T08:00:00.000Z",
    quotedB20EconomicBuyAmount: b20UIAmount(200_000_000n),
    quotedRawBuyAmount: 200_000_000n,
    quotedRawSellAmount: 100_000_000n,
    requestedRawSellAmount: 100_000_000n,
    route: { fills: [] },
    routeSourceNames: ["DETERMINISTIC_0X_ROUTE_FIXTURE"],
    sellAsset: BASE_MAINNET_USDC,
    slippageBps: 30,
    source: "0x",
    taker: OWNER,
    transaction: {
      data: "0x12345678" as const,
      target: "0x0000000000001fF3684f28c67538d4D072C22734" as const,
      value: 0n,
    },
  });
}

describe("provider-backed portfolio and risk snapshots", () => {
  it("values registered B20 economic balances using one captured provider snapshot", async () => {
    const references = await referenceSnapshot();
    const snapshot = createProviderBackedPortfolioRiskSnapshot({
      balanceRead: balanceRead(),
      nowSeconds: NOW,
      referenceSnapshot: references,
    });

    assert.equal(snapshot.referenceSnapshot, references);
    assert.equal(snapshot.portfolio.totalReferenceValue, 140_000_000_000n);
    assert.equal(
      snapshot.riskPortfolio.totalReferenceValue,
      snapshot.portfolio.totalReferenceValue,
    );
    assert.equal(snapshot.riskReferencePrices.length, 4);
    assert.equal(
      snapshot.portfolio.positions[0]?.referencePrice.source,
      CANONICAL_USDC_ONE_USD_POLICY,
    );
    assert.match(snapshot.snapshotId, /^0x[0-9a-f]{64}$/);
  });

  it("builds trigger and exposure inputs from the same snapshot, never the 0x quote price", async () => {
    const references = await referenceSnapshot();
    const snapshot = createProviderBackedPortfolioRiskSnapshot({
      balanceRead: balanceRead(),
      nowSeconds: NOW,
      referenceSnapshot: references,
    });
    const executionQuote = quote();
    const built = buildProviderBackedExecutionCandidate({
      constraints: {
        maximumPriceDeviationBps: 10_000,
        maximumSingleAssetExposureBps: 2_000,
        maximumSlippageBps: 30,
        minimumReserve: { rawAmount: 500_000_000n, token: BASE_MAINNET_USDC },
      },
      deadline: NOW + 300n,
      executionQuote,
      snapshot,
      trigger: { priceDecimals: 18, type: "PRICE_BELOW", value: 100n * 10n ** 18n },
    });
    const result = validateExecutionCandidate(built.candidate, BASE_MAINNET_ASSET_REGISTRY);

    assert.equal(built.snapshotId, snapshot.snapshotId);
    assert.equal(built.candidate.currentBuyAssetReferencePrice?.source, "CHAINLINK_DATA_STREAMS");
    assert.equal(built.candidate.executionQuote.source, "0x");
    assert.equal(
      built.candidate.executionReferenceValuation.proposedBuyReferenceValue,
      20_000_000_000n,
    );
    assert.notEqual(
      built.candidate.currentBuyAssetReferencePrice?.price,
      built.candidate.executionQuote.quotedRawBuyAmount,
    );
    assert.equal(result.status, "ACCEPTED");
  });
});

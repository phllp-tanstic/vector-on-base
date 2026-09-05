import { B20_WAD_PRECISION, type B20UIAmount } from "@vector/b20";
import {
  assertChainlinkReferenceSnapshotFresh,
  BASE_MAINNET_ASSET_REGISTRY,
  BASE_MAINNET_USDC,
  type BasePortfolioBalanceRead,
  type ChainlinkReferencePrice,
  type ChainlinkReferencePriceSnapshot,
  findSnapshotPrice,
} from "@vector/integrations";
import {
  createAssetPrice,
  createB20PortfolioPosition,
  createErc20PortfolioPosition,
  createPortfolioSnapshot,
  type ValuedPortfolioSnapshot,
  valuePortfolio,
  valuePosition,
  USD_REFERENCE_VALUE_DECIMALS,
  USD_REFERENCE_VALUE_SCALE,
} from "@vector/portfolio";
import type {
  ExecutionCandidate,
  PriceTrigger,
  RiskPolicy,
  RiskPortfolioSnapshot,
  RiskReferencePrice,
} from "@vector/risk";
import { VECTOR_CHAIN_ID } from "@vector/shared";
import { keccak256, stringToHex, type Hex } from "viem";

import type { VectorExecutionQuote } from "./external-quote.ts";

export const CANONICAL_USDC_ONE_USD_POLICY = "CANONICAL_BASE_USDC_ONE_USD_POLICY" as const;

export interface ProviderBackedPortfolioRiskSnapshot {
  readonly createdAt: bigint;
  readonly portfolio: ValuedPortfolioSnapshot;
  readonly referenceSnapshot: ChainlinkReferencePriceSnapshot;
  readonly riskPortfolio: RiskPortfolioSnapshot;
  readonly riskReferencePrices: readonly RiskReferencePrice[];
  readonly snapshotId: Hex;
}

export interface ProviderBackedExecutionCandidate {
  readonly candidate: ExecutionCandidate & { readonly executionQuote: VectorExecutionQuote };
  readonly snapshotId: Hex;
}

function toRiskReferencePrice(price: ChainlinkReferencePrice): RiskReferencePrice {
  return Object.freeze({
    asset: price.asset,
    kind: "REFERENCE_PRICE",
    price: price.price,
    priceDecimals: price.priceDecimals,
    source: price.source,
  });
}

export function createProviderBackedPortfolioRiskSnapshot(input: {
  readonly balanceRead: BasePortfolioBalanceRead;
  readonly nowSeconds: bigint;
  readonly referenceSnapshot: ChainlinkReferencePriceSnapshot;
}): ProviderBackedPortfolioRiskSnapshot {
  assertChainlinkReferenceSnapshotFresh({
    nowSeconds: input.nowSeconds,
    snapshot: input.referenceSnapshot,
  });
  const positions = input.balanceRead.positions.map((position) => {
    const registered = BASE_MAINNET_ASSET_REGISTRY.getByAddress(position.asset.tokenAddress);
    if (
      !registered ||
      registered.symbol !== position.asset.symbol ||
      registered.assetStandard !== position.asset.assetStandard
    ) {
      throw new Error(`Portfolio balance asset is not the registered ${position.asset.symbol}.`);
    }
    return "economicBalance" in position
      ? createB20PortfolioPosition(
          position.asset,
          position.rawBalance,
          position.economicBalance,
          position.multiplier,
          position.tokenDecimals,
        )
      : createErc20PortfolioPosition(position.asset, position.rawBalance, position.tokenDecimals);
  });
  const portfolioSnapshot = createPortfolioSnapshot({
    account: input.balanceRead.account,
    blockNumber: input.balanceRead.blockNumber,
    blockTimestamp: input.balanceRead.blockTimestamp,
    positions,
  });
  const usdcPrice = createAssetPrice({
    asset: BASE_MAINNET_USDC,
    observedAt: input.referenceSnapshot.createdAt,
    price: USD_REFERENCE_VALUE_SCALE,
    priceDecimals: USD_REFERENCE_VALUE_DECIMALS,
    quoteCurrency: "USD",
    source: CANONICAL_USDC_ONE_USD_POLICY,
  });
  const portfolio = valuePortfolio(portfolioSnapshot, [
    usdcPrice,
    ...input.referenceSnapshot.prices,
  ]);
  const riskPortfolio = Object.freeze({
    account: portfolio.snapshot.account,
    positions: Object.freeze(
      portfolio.snapshot.positions.map((position) => ({
        asset: position.asset,
        rawBalance: position.rawBalance,
      })),
    ),
    referenceValueDecimals: portfolio.referenceValueDecimals,
    totalReferenceValue: portfolio.totalReferenceValue,
    valuedPositions: Object.freeze(
      portfolio.positions.map((position) => ({
        asset: position.position.asset,
        referenceValue: position.referenceValue,
      })),
    ),
  }) satisfies RiskPortfolioSnapshot;
  const riskReferencePrices = Object.freeze(
    input.referenceSnapshot.prices.map(toRiskReferencePrice),
  );
  const snapshotId = keccak256(
    stringToHex(
      [
        input.referenceSnapshot.snapshotId,
        input.balanceRead.account.toLowerCase(),
        input.balanceRead.blockNumber.toString(),
        ...portfolio.positions.flatMap((position) => [
          position.position.asset.tokenAddress.toLowerCase(),
          position.position.rawBalance.toString(),
          position.economicAmount.toString(),
          position.referenceValue.toString(),
        ]),
      ].join("|"),
    ),
  );
  return Object.freeze({
    createdAt: input.nowSeconds,
    portfolio,
    referenceSnapshot: input.referenceSnapshot,
    riskPortfolio,
    riskReferencePrices,
    snapshotId,
  });
}

export function buildProviderBackedExecutionCandidate(input: {
  readonly constraints: RiskPolicy;
  readonly deadline: bigint;
  readonly executionQuote: VectorExecutionQuote;
  readonly snapshot: ProviderBackedPortfolioRiskSnapshot;
  readonly trigger?: PriceTrigger;
}): ProviderBackedExecutionCandidate {
  const quote = input.executionQuote;
  const stockPrice = findSnapshotPrice(input.snapshot.referenceSnapshot, quote.buyAsset.symbol);
  if (!stockPrice || quote.buyAsset.assetStandard !== "B20") {
    throw new Error("Execution quote buy asset has no captured stock reference price.");
  }
  const economicBuyAmount = quote.quotedB20EconomicBuyAmount;
  if (economicBuyAmount === undefined) {
    throw new Error("B20 execution quote is missing its economic buy amount.");
  }
  const usdcPosition = createErc20PortfolioPosition(BASE_MAINNET_USDC, quote.quotedRawSellAmount);
  const usdcPrice = createAssetPrice({
    asset: BASE_MAINNET_USDC,
    observedAt: input.snapshot.referenceSnapshot.createdAt,
    price: USD_REFERENCE_VALUE_SCALE,
    priceDecimals: USD_REFERENCE_VALUE_DECIMALS,
    quoteCurrency: "USD",
    source: CANONICAL_USDC_ONE_USD_POLICY,
  });
  const proposedBuyReferenceValue = valuePosition(
    createB20PortfolioPosition(
      quote.buyAsset,
      quote.quotedRawBuyAmount,
      economicBuyAmount as B20UIAmount,
      B20_WAD_PRECISION,
    ),
    stockPrice,
  ).referenceValue;
  const candidate = Object.freeze({
    buyAsset: quote.buyAsset,
    chainId: VECTOR_CHAIN_ID,
    constraints: input.constraints,
    currentBuyAssetReferencePrice: toRiskReferencePrice(stockPrice),
    currentTimestamp: input.snapshot.createdAt,
    deadline: input.deadline,
    executionQuote: quote,
    executionReferenceValuation: Object.freeze({
      kind: "REFERENCE_VALUATION",
      proposedBuyReferenceValue,
      quotedSellReferenceValue: valuePosition(usdcPosition, usdcPrice).referenceValue,
      referenceValueDecimals: USD_REFERENCE_VALUE_DECIMALS,
    }),
    owner: input.snapshot.portfolio.snapshot.account,
    portfolioSnapshot: input.snapshot.riskPortfolio,
    requestedRawSellAmount: quote.requestedRawSellAmount,
    sellAsset: quote.sellAsset,
    ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
  }) satisfies ExecutionCandidate & { readonly executionQuote: VectorExecutionQuote };
  return Object.freeze({ candidate, snapshotId: input.snapshot.snapshotId });
}

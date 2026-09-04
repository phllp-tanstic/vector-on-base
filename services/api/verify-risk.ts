import assert from "node:assert/strict";

import { b20UIAmount, B20_WAD_PRECISION } from "@vector/b20";
import type { VectorExecutionQuote } from "@vector/execution";
import {
  BASE_MAINNET_ASSET_REGISTRY,
  BASE_MAINNET_TOKENIZED_STOCKS,
  BASE_MAINNET_USDC,
} from "@vector/integrations";
import {
  createAssetPrice,
  createB20PortfolioPosition,
  createErc20PortfolioPosition,
  createPortfolioSnapshot,
  valuePortfolio,
  valuePosition,
} from "@vector/portfolio";
import {
  maximumSpendAfterReserve,
  validateExecutionCandidate,
  type ExecutionCandidate,
  type RiskPolicy,
  type RiskPortfolioSnapshot,
  type RiskReferencePrice,
  type RiskValidationResult,
} from "@vector/risk";
import { VECTOR_CHAIN_ID } from "@vector/shared";

const OWNER = "0x0000000000000000000000000000000000000001" as const;
const TRANSACTION_TARGET = "0x0000000000000000000000000000000000000002" as const;
const CURRENT_TIMESTAMP = 1_800_000_000n;
const USD_SCALE = 100_000_000n;
const nvdac = BASE_MAINNET_TOKENIZED_STOCKS[0];

const usdcPrice = createAssetPrice({
  asset: BASE_MAINNET_USDC,
  observedAt: CURRENT_TIMESTAMP,
  price: USD_SCALE,
  priceDecimals: 8,
  source: "DETERMINISTIC DEMO REFERENCE FIXTURE",
});
const nvdacPrice = createAssetPrice({
  asset: nvdac,
  observedAt: CURRENT_TIMESTAMP,
  price: 100n * USD_SCALE,
  priceDecimals: 8,
  source: "DETERMINISTIC DEMO REFERENCE FIXTURE",
});

function riskPrice(price: typeof usdcPrice | typeof nvdacPrice): RiskReferencePrice {
  return Object.freeze({
    asset: price.asset,
    kind: "REFERENCE_PRICE",
    price: price.price,
    priceDecimals: price.priceDecimals,
    source: price.source,
  });
}

function portfolio(usdcRaw: bigint, nvdacRaw: bigint): RiskPortfolioSnapshot {
  const snapshot = createPortfolioSnapshot({
    account: OWNER,
    blockNumber: 1n,
    blockTimestamp: CURRENT_TIMESTAMP,
    positions: [
      createErc20PortfolioPosition(BASE_MAINNET_USDC, usdcRaw),
      createB20PortfolioPosition(nvdac, nvdacRaw, nvdacRaw, B20_WAD_PRECISION),
    ],
  });
  const valued = valuePortfolio(snapshot, [usdcPrice, nvdacPrice]);

  return Object.freeze({
    account: valued.snapshot.account,
    positions: Object.freeze(
      valued.snapshot.positions.map((position) => ({
        asset: position.asset,
        rawBalance: position.rawBalance,
      })),
    ),
    referenceValueDecimals: valued.referenceValueDecimals,
    totalReferenceValue: valued.totalReferenceValue,
    valuedPositions: Object.freeze(
      valued.positions.map((position) => ({
        asset: position.position.asset,
        referenceValue: position.referenceValue,
      })),
    ),
  });
}

function quote(sellAmount: bigint, buyAmount: bigint): VectorExecutionQuote {
  return Object.freeze({
    allowanceTarget: null,
    buyAsset: nvdac,
    chainId: VECTOR_CHAIN_ID,
    issues: {
      allowance: null,
      balance: null,
      invalidSourcesPassed: [],
      simulationIncomplete: false,
    },
    kind: "firm-execution-quote",
    minBuyAmount: buyAmount,
    quoteBlockNumber: 1n,
    quoteTimestamp: "2027-01-15T08:00:00.000Z",
    quotedB20EconomicBuyAmount: b20UIAmount(buyAmount),
    quotedRawBuyAmount: buyAmount,
    quotedRawSellAmount: sellAmount,
    requestedRawSellAmount: sellAmount,
    route: { fills: [] },
    routeSourceNames: ["DETERMINISTIC_0X_ROUTE_FIXTURE"],
    sellAsset: BASE_MAINNET_USDC,
    slippageBps: 30,
    source: "0x",
    taker: OWNER,
    transaction: { data: "0x" as const, target: TRANSACTION_TARGET, value: 0n },
  });
}

function policy(reserveRaw: bigint, exposureBps: number): RiskPolicy {
  return Object.freeze({
    maximumPriceDeviationBps: 0,
    maximumSingleAssetExposureBps: exposureBps,
    maximumSlippageBps: 30,
    minimumReserve: { rawAmount: reserveRaw, token: BASE_MAINNET_USDC },
  });
}

function candidate(
  portfolioSnapshot: RiskPortfolioSnapshot,
  executionQuote: VectorExecutionQuote,
  constraints: RiskPolicy,
  trigger?: ExecutionCandidate["trigger"],
): ExecutionCandidate {
  return Object.freeze({
    buyAsset: nvdac,
    chainId: VECTOR_CHAIN_ID,
    constraints,
    currentBuyAssetReferencePrice: riskPrice(nvdacPrice),
    currentTimestamp: CURRENT_TIMESTAMP,
    deadline: CURRENT_TIMESTAMP + 300n,
    executionQuote,
    executionReferenceValuation: Object.freeze({
      kind: "REFERENCE_VALUATION",
      proposedBuyReferenceValue: valuePosition(
        createB20PortfolioPosition(
          nvdac,
          executionQuote.quotedRawBuyAmount,
          executionQuote.quotedB20EconomicBuyAmount,
          B20_WAD_PRECISION,
        ),
        nvdacPrice,
      ).referenceValue,
      quotedSellReferenceValue: valuePosition(
        createErc20PortfolioPosition(BASE_MAINNET_USDC, executionQuote.quotedRawSellAmount),
        usdcPrice,
      ).referenceValue,
      referenceValueDecimals: 8,
    }),
    owner: OWNER,
    portfolioSnapshot,
    requestedRawSellAmount: executionQuote.requestedRawSellAmount,
    sellAsset: BASE_MAINNET_USDC,
    ...(trigger === undefined ? {} : { trigger }),
  });
}

function printScenario(name: string, result: RiskValidationResult): void {
  console.log(`${name}.status=${result.status}`);
  console.log(`${name}.nextState=${result.nextState ?? "NONE"}`);
  console.log(
    `${name}.checks=${result.checks.map((check) => `${check.stage}:${check.status}`).join(",")}`,
  );
  console.log(
    `${name}.rejections=${result.rejections.map((item) => item.code).join(",") || "NONE"}`,
  );
}

function assertScenario(
  result: RiskValidationResult,
  expectedStatus: RiskValidationResult["status"],
  expectedRejections: readonly string[],
): void {
  assert.equal(result.status, expectedStatus);
  assert.deepEqual(
    result.rejections.map((item) => item.code),
    expectedRejections,
  );
}

const acceptedCandidate = candidate(
  portfolio(2_000_000_000n, 100_000_000n),
  quote(100_000_000n, 100_000_000n),
  policy(1_000_000_000n, 2_000),
  { priceDecimals: 8, type: "PRICE_BELOW", value: 100n * USD_SCALE },
);
const reserveCandidate = candidate(
  portfolio(1_320_000_000n, 0n),
  quote(500_000_000n, 500_000_000n),
  policy(1_000_000_000n, 10_000),
);
const exposureCandidate = candidate(
  portfolio(1_000_000_000n, 0n),
  quote(200_000_000n, 200_000_000n),
  policy(0n, 1_000),
);

console.log(
  "Risk verification uses deterministic reference-price and 0x quote fixtures; not live prices.",
);
const acceptedResult = validateExecutionCandidate(acceptedCandidate, BASE_MAINNET_ASSET_REGISTRY);
const reserveResult = validateExecutionCandidate(reserveCandidate, BASE_MAINNET_ASSET_REGISTRY);
const exposureResult = validateExecutionCandidate(exposureCandidate, BASE_MAINNET_ASSET_REGISTRY);

assertScenario(acceptedResult, "ACCEPTED", []);
assert.equal(acceptedResult.nextState, "READY_FOR_AUTHORIZATION");
assertScenario(reserveResult, "REJECTED", ["RESERVE_VIOLATION"]);
assertScenario(exposureResult, "REJECTED", ["EXPOSURE_LIMIT"]);

printScenario("SCENARIO_A_ACCEPTED_NVDA", acceptedResult);
printScenario("SCENARIO_B_RESERVE_REJECTION", reserveResult);
const maximumReserveSpend = maximumSpendAfterReserve(1_320_000_000n, 1_000_000_000n);
assert.equal(maximumReserveSpend, 320_000_000n);
console.log(`SCENARIO_B_RESERVE_REJECTION.maximumRawSpendAfterReserve=${maximumReserveSpend}`);
printScenario("SCENARIO_C_EXPOSURE_REJECTION", exposureResult);
console.log("authorizationPerformed=false");
console.log("transactionSubmitted=false");

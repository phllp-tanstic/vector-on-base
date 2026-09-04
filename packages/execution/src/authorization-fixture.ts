import { b20UIAmount } from "@vector/b20";
import {
  BASE_MAINNET_ASSET_REGISTRY,
  BASE_MAINNET_TOKENIZED_STOCKS,
  BASE_MAINNET_USDC,
} from "@vector/integrations";
import { validateExecutionCandidate, type ExecutionCandidate } from "@vector/risk";
import { VECTOR_CHAIN_ID } from "@vector/shared";

import type { VectorExecutionQuote } from "./external-quote.ts";
import type { BuildVectorExecutionPlanInput } from "./execution-plan.ts";

/** Deterministic fixtures only. None of these addresses identify a production deployment. */
export const AUTHORIZATION_FIXTURE = Object.freeze({
  allowanceTarget: "0x0000000000001fF3684f28c67538d4D072C22734" as const,
  currentTimestamp: 1_800_000_000n,
  executionTarget: "0x0000000000000000000000000000000000000020" as const,
  executor: "0x0000000000000000000000000000000000000010" as const,
  nonce: 42n,
  owner: "0x0000000000000000000000000000000000000001" as const,
  recipient: "0x0000000000000000000000000000000000000002" as const,
});

export function createAuthorizationFixtureQuote(): VectorExecutionQuote {
  const buyAsset = BASE_MAINNET_TOKENIZED_STOCKS[0];
  const quote = {
    allowanceTarget: AUTHORIZATION_FIXTURE.allowanceTarget,
    buyAsset,
    chainId: VECTOR_CHAIN_ID,
    issues: {
      allowance: null,
      balance: null,
      invalidSourcesPassed: [],
      simulationIncomplete: false,
    },
    kind: "firm-execution-quote",
    minBuyAmount: 99_000_000n,
    quoteBlockNumber: 35_000_000n,
    quoteTimestamp: "2027-01-15T08:00:00.000Z",
    quotedB20EconomicBuyAmount: b20UIAmount(100_000_000n),
    quotedRawBuyAmount: 100_000_000n,
    quotedRawSellAmount: 100_000_000n,
    requestedRawSellAmount: 100_000_000n,
    route: { fills: [] },
    routeSourceNames: ["DETERMINISTIC_0X_ROUTE_FIXTURE"],
    sellAsset: BASE_MAINNET_USDC,
    slippageBps: 30,
    source: "0x",
    taker: AUTHORIZATION_FIXTURE.executor,
    transaction: {
      data: "0x12345678" as const,
      target: AUTHORIZATION_FIXTURE.executionTarget,
      value: 7n,
    },
  } as const satisfies VectorExecutionQuote;
  return Object.freeze(quote);
}

export function createAuthorizationFixtureCandidate(
  executionQuote: VectorExecutionQuote = createAuthorizationFixtureQuote(),
): ExecutionCandidate & { readonly executionQuote: VectorExecutionQuote } {
  const buyAsset = BASE_MAINNET_TOKENIZED_STOCKS[0];
  const candidate = {
    buyAsset,
    chainId: VECTOR_CHAIN_ID,
    constraints: {
      maximumPriceDeviationBps: 0,
      maximumSingleAssetExposureBps: 2_000,
      maximumSlippageBps: 30,
      minimumReserve: { rawAmount: 1_000_000_000n, token: BASE_MAINNET_USDC },
    },
    currentBuyAssetReferencePrice: {
      asset: buyAsset,
      kind: "REFERENCE_PRICE",
      price: 10_000_000_000n,
      priceDecimals: 8,
      source: "DETERMINISTIC AUTHORIZATION FIXTURE",
    },
    currentTimestamp: AUTHORIZATION_FIXTURE.currentTimestamp,
    deadline: AUTHORIZATION_FIXTURE.currentTimestamp + 300n,
    executionQuote,
    executionReferenceValuation: {
      kind: "REFERENCE_VALUATION",
      proposedBuyReferenceValue: 10_000_000_000n,
      quotedSellReferenceValue: 10_000_000_000n,
      referenceValueDecimals: 8,
    },
    owner: AUTHORIZATION_FIXTURE.owner,
    portfolioSnapshot: {
      account: AUTHORIZATION_FIXTURE.owner,
      positions: [
        { asset: BASE_MAINNET_USDC, rawBalance: 2_000_000_000n },
        { asset: buyAsset, rawBalance: 100_000_000n },
      ],
      referenceValueDecimals: 8,
      totalReferenceValue: 210_000_000_000n,
      valuedPositions: [
        { asset: BASE_MAINNET_USDC, referenceValue: 200_000_000_000n },
        { asset: buyAsset, referenceValue: 10_000_000_000n },
      ],
    },
    requestedRawSellAmount: executionQuote.requestedRawSellAmount,
    sellAsset: BASE_MAINNET_USDC,
  } as const satisfies ExecutionCandidate & { readonly executionQuote: VectorExecutionQuote };
  return Object.freeze(candidate);
}

export function createAuthorizationFixtureInput(): BuildVectorExecutionPlanInput {
  const candidate = createAuthorizationFixtureCandidate();
  const riskResult = validateExecutionCandidate(candidate, BASE_MAINNET_ASSET_REGISTRY);
  if (riskResult.status !== "ACCEPTED") {
    throw new Error("Deterministic authorization fixture must remain risk-accepted.");
  }

  return {
    assetRegistry: BASE_MAINNET_ASSET_REGISTRY,
    candidate,
    currentTimestamp: AUTHORIZATION_FIXTURE.currentTimestamp,
    deadline: candidate.deadline,
    nonce: AUTHORIZATION_FIXTURE.nonce,
    recipient: AUTHORIZATION_FIXTURE.recipient,
    riskResult,
    smartAccountAddress: AUTHORIZATION_FIXTURE.owner,
    trustedConfig: {
      approvedAllowanceTargets: [AUTHORIZATION_FIXTURE.allowanceTarget],
      approvedExecutionTargets: [AUTHORIZATION_FIXTURE.executionTarget],
      executorAddress: AUTHORIZATION_FIXTURE.executor,
    },
  };
}

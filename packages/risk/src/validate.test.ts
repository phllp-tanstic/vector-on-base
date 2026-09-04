import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AssetRegistry,
  VECTOR_CHAIN_ID,
  type B20VectorAsset,
  type Erc20VectorAsset,
} from "@vector/shared";

import { maximumExposureValue } from "./math.ts";
import { RISK_VALIDATION_ORDER, type ExecutionCandidate, type RiskRejectionCode } from "./types.ts";
import { validateExecutionCandidate } from "./validate.ts";

const OWNER = "0x0000000000000000000000000000000000000001" as const;
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
const registry = new AssetRegistry([USDC, NVDAC]);
const USD_SCALE = 100_000_000n;

function candidate(overrides: Partial<ExecutionCandidate> = {}): ExecutionCandidate {
  const base = {
    buyAsset: NVDAC,
    currentBuyAssetReferencePrice: {
      asset: NVDAC,
      kind: "REFERENCE_PRICE",
      price: 100n * USD_SCALE,
      priceDecimals: 8,
      source: "DETERMINISTIC TEST REFERENCE",
    },
    chainId: VECTOR_CHAIN_ID,
    constraints: {
      maximumPriceDeviationBps: 0,
      maximumSingleAssetExposureBps: 2_000,
      maximumSlippageBps: 30,
      minimumReserve: { rawAmount: 1_000_000_000n, token: USDC },
    },
    currentTimestamp: 1_800_000_000n,
    deadline: 1_800_000_100n,
    executionQuote: {
      buyAsset: NVDAC,
      chainId: VECTOR_CHAIN_ID,
      issues: { balance: null, invalidSourcesPassed: [], simulationIncomplete: false },
      quotedB20EconomicBuyAmount: 100_000_000n,
      quotedRawBuyAmount: 100_000_000n,
      quotedRawSellAmount: 100_000_000n,
      requestedRawSellAmount: 100_000_000n,
      sellAsset: USDC,
      slippageBps: 30,
      source: "0x",
    },
    executionReferenceValuation: {
      kind: "REFERENCE_VALUATION",
      proposedBuyReferenceValue: 100n * USD_SCALE,
      quotedSellReferenceValue: 100n * USD_SCALE,
      referenceValueDecimals: 8,
    },
    owner: OWNER,
    portfolioSnapshot: {
      account: OWNER,
      positions: [
        { asset: USDC, rawBalance: 2_000_000_000n },
        { asset: NVDAC, rawBalance: 100_000_000n },
      ],
      referenceValueDecimals: 8,
      totalReferenceValue: 2_100n * USD_SCALE,
      valuedPositions: [
        { asset: USDC, referenceValue: 2_000n * USD_SCALE },
        { asset: NVDAC, referenceValue: 100n * USD_SCALE },
      ],
    },
    requestedRawSellAmount: 100_000_000n,
    sellAsset: USDC,
  } as const satisfies ExecutionCandidate;

  return { ...base, ...overrides };
}

function codes(result: ReturnType<typeof validateExecutionCandidate>): RiskRejectionCode[] {
  return result.rejections.map((item) => item.code);
}

function withTrade(
  input: ExecutionCandidate,
  sellAmount: bigint,
  economicBuyAmount: bigint,
): ExecutionCandidate {
  return {
    ...input,
    executionQuote: {
      ...input.executionQuote,
      quotedB20EconomicBuyAmount: economicBuyAmount,
      quotedRawBuyAmount: economicBuyAmount,
      quotedRawSellAmount: sellAmount,
      requestedRawSellAmount: sellAmount,
    },
    executionReferenceValuation: {
      ...input.executionReferenceValuation,
      proposedBuyReferenceValue: (economicBuyAmount * 100n * USD_SCALE) / 100_000_000n,
      quotedSellReferenceValue: (sellAmount * USD_SCALE) / 1_000_000n,
    },
    requestedRawSellAmount: sellAmount,
  };
}

function portfolio(
  usdcRawBalance: bigint,
  usdcReferenceValue: bigint,
  nvdacReferenceValue = 100n * USD_SCALE,
): ExecutionCandidate["portfolioSnapshot"] {
  return {
    account: OWNER,
    positions: [
      { asset: USDC, rawBalance: usdcRawBalance },
      { asset: NVDAC, rawBalance: 0n },
    ],
    referenceValueDecimals: 8,
    totalReferenceValue: usdcReferenceValue + nvdacReferenceValue,
    valuedPositions: [
      { asset: USDC, referenceValue: usdcReferenceValue },
      { asset: NVDAC, referenceValue: nvdacReferenceValue },
    ],
  };
}

describe("deterministic execution-candidate risk validation", () => {
  it("accepts a valid candidate and stops at readiness for user authorization", () => {
    const result = validateExecutionCandidate(candidate(), registry);

    assert.equal(result.status, "ACCEPTED");
    assert.equal(result.nextState, "READY_FOR_AUTHORIZATION");
    assert.deepEqual(result.rejections, []);
    assert.deepEqual(
      result.checks.map((check) => check.stage),
      RISK_VALIDATION_ORDER,
    );
    assert.ok(result.checks.every((check) => check.status === "PASSED"));
  });

  it("rejects insufficient balance and accepts the exact balance boundary", () => {
    const insufficient = candidate({ portfolioSnapshot: portfolio(99_999_999n, 99n * USD_SCALE) });
    assert.ok(
      codes(validateExecutionCandidate(insufficient, registry)).includes("INSUFFICIENT_BALANCE"),
    );

    const exactBase = candidate({
      constraints: {
        ...candidate().constraints,
        maximumSingleAssetExposureBps: 10_000,
        minimumReserve: { rawAmount: 0n, token: USDC },
      },
      portfolioSnapshot: portfolio(100_000_000n, 100n * USD_SCALE, 0n),
    });
    assert.equal(validateExecutionCandidate(exactBase, registry).status, "ACCEPTED");
  });

  it("uses the signed post-execution balance for reserve checks", () => {
    const input = candidate({
      constraints: {
        ...candidate().constraints,
        maximumSingleAssetExposureBps: 10_000,
        minimumReserve: { rawAmount: 0n, token: USDC },
      },
      portfolioSnapshot: portfolio(99_999_999n, 100n * USD_SCALE, 0n),
    });
    const result = validateExecutionCandidate(input, registry);

    assert.deepEqual(codes(result).slice(0, 2), ["INSUFFICIENT_BALANCE", "RESERVE_VIOLATION"]);
    assert.equal(
      result.checks.find((check) => check.stage === "RESERVE")?.metrics.postExecutionRawSellBalance,
      -1n,
    );
  });

  it("enforces reserve violations and the exact reserve boundary", () => {
    const base = candidate({
      constraints: {
        ...candidate().constraints,
        maximumSingleAssetExposureBps: 10_000,
        minimumReserve: { rawAmount: 1_000_000_000n, token: USDC },
      },
      portfolioSnapshot: portfolio(1_320_000_000n, 1_320n * USD_SCALE, 0n),
    });
    const rejected = validateExecutionCandidate(
      withTrade(base, 500_000_000n, 500_000_000n),
      registry,
    );

    assert.ok(codes(rejected).includes("RESERVE_VIOLATION"));
    assert.equal(
      rejected.checks.find((check) => check.stage === "RESERVE")?.metrics
        .maximumRawSpendAfterReserve,
      320_000_000n,
    );

    const exact = candidate({
      constraints: base.constraints,
      portfolioSnapshot: portfolio(1_500_000_000n, 1_500n * USD_SCALE, 0n),
    });
    assert.equal(
      validateExecutionCandidate(withTrade(exact, 500_000_000n, 500_000_000n), registry).status,
      "ACCEPTED",
    );
  });

  it("does not convert or apply a reserve denominated in another asset", () => {
    const input = candidate({
      constraints: {
        ...candidate().constraints,
        minimumReserve: { rawAmount: 10n ** 30n, token: NVDAC },
      },
    });

    assert.equal(validateExecutionCandidate(input, registry).status, "ACCEPTED");
  });

  it("enforces exposure violations and the exact exposure boundary", () => {
    const base = candidate({
      constraints: {
        ...candidate().constraints,
        maximumSingleAssetExposureBps: 1_000,
        minimumReserve: { rawAmount: 0n, token: USDC },
      },
      portfolioSnapshot: portfolio(1_000_000_000n, 1_000n * USD_SCALE, 0n),
    });

    const exact = validateExecutionCandidate(base, registry);
    assert.equal(exact.status, "ACCEPTED");
    const exposureMetrics = exact.checks.find((check) => check.stage === "EXPOSURE")?.metrics;
    assert.equal(exposureMetrics?.postTradeTotalReferenceValue, 1_000n * USD_SCALE);
    assert.equal(exposureMetrics?.postTradeBuyReferenceExposure, 100n * USD_SCALE);
    const violation = {
      ...base,
      constraints: { ...base.constraints, maximumSingleAssetExposureBps: 999 },
    };
    assert.ok(codes(validateExecutionCandidate(violation, registry)).includes("EXPOSURE_LIMIT"));
  });

  it("enforces slippage violations and the exact boundary", () => {
    const exact = candidate();
    assert.equal(validateExecutionCandidate(exact, registry).status, "ACCEPTED");

    const violation = {
      ...exact,
      executionQuote: { ...exact.executionQuote, slippageBps: 31 },
    };
    assert.ok(codes(validateExecutionCandidate(violation, registry)).includes("SLIPPAGE_TOO_HIGH"));
  });

  it("enforces expiry and accepts the exact deadline boundary", () => {
    const exact = candidate({ currentTimestamp: candidate().deadline });
    assert.equal(validateExecutionCandidate(exact, registry).status, "ACCEPTED");
    const expired = candidate({ currentTimestamp: candidate().deadline + 1n });
    assert.ok(codes(validateExecutionCandidate(expired, registry)).includes("INTENT_EXPIRED"));
  });

  it("evaluates PRICE_BELOW inclusively using only the reference price", () => {
    const met = candidate({
      trigger: { priceDecimals: 8, type: "PRICE_BELOW", value: 100n * USD_SCALE },
    });
    const notMet = candidate({
      trigger: { priceDecimals: 8, type: "PRICE_BELOW", value: 99n * USD_SCALE },
    });

    assert.equal(validateExecutionCandidate(met, registry).status, "ACCEPTED");
    assert.ok(codes(validateExecutionCandidate(notMet, registry)).includes("TRIGGER_NOT_MET"));
  });

  it("evaluates PRICE_ABOVE inclusively using only the reference price", () => {
    const met = candidate({
      trigger: { priceDecimals: 8, type: "PRICE_ABOVE", value: 100n * USD_SCALE },
    });
    const notMet = candidate({
      trigger: { priceDecimals: 8, type: "PRICE_ABOVE", value: 101n * USD_SCALE },
    });

    assert.equal(validateExecutionCandidate(met, registry).status, "ACCEPTED");
    assert.ok(codes(validateExecutionCandidate(notMet, registry)).includes("TRIGGER_NOT_MET"));
  });

  it("does not substitute quote valuation for the trigger reference price", () => {
    const input = candidate({
      constraints: {
        maximumSingleAssetExposureBps: candidate().constraints.maximumSingleAssetExposureBps,
        maximumSlippageBps: candidate().constraints.maximumSlippageBps,
        minimumReserve: candidate().constraints.minimumReserve,
      },
      executionReferenceValuation: {
        ...candidate().executionReferenceValuation,
        proposedBuyReferenceValue: 90n * USD_SCALE,
      },
      trigger: { priceDecimals: 8, type: "PRICE_BELOW", value: 100n * USD_SCALE },
    });

    assert.equal(validateExecutionCandidate(input, registry).status, "ACCEPTED");
  });

  it("rejects unsupported assets, wrong chains, and invalid amounts", () => {
    const unsupported = {
      ...NVDAC,
      tokenAddress: "0xb20000000000000000000078ee7ce2fE4908108D",
    } as const satisfies B20VectorAsset;
    assert.ok(
      codes(validateExecutionCandidate(candidate({ buyAsset: unsupported }), registry)).includes(
        "ASSET_UNSUPPORTED",
      ),
    );
    assert.ok(
      codes(validateExecutionCandidate(candidate({ chainId: 1 }), registry)).includes(
        "WRONG_CHAIN",
      ),
    );
    assert.ok(
      codes(
        validateExecutionCandidate(
          candidate({
            executionQuote: {
              ...candidate().executionQuote,
              quotedRawSellAmount: 0n,
              requestedRawSellAmount: 0n,
            },
            requestedRawSellAmount: 0n,
          }),
          registry,
        ),
      ).includes("INVALID_AMOUNT"),
    );
  });

  it("rejects disabled assets and unsupported quote sources", () => {
    const disabledNvdac = { ...NVDAC, enabled: false } as const satisfies B20VectorAsset;
    const disabledRegistry = new AssetRegistry([USDC, disabledNvdac]);
    const base = candidate();
    const disabled = {
      ...base,
      buyAsset: disabledNvdac,
      currentBuyAssetReferencePrice: {
        ...base.currentBuyAssetReferencePrice!,
        asset: disabledNvdac,
      },
      executionQuote: { ...base.executionQuote, buyAsset: disabledNvdac },
      portfolioSnapshot: {
        ...base.portfolioSnapshot,
        positions: base.portfolioSnapshot.positions.map((position) =>
          position.asset.symbol === "NVDAc" ? { ...position, asset: disabledNvdac } : position,
        ),
        valuedPositions: base.portfolioSnapshot.valuedPositions.map((position) =>
          position.asset.symbol === "NVDAc" ? { ...position, asset: disabledNvdac } : position,
        ),
      },
    } satisfies ExecutionCandidate;
    assert.ok(
      codes(validateExecutionCandidate(disabled, disabledRegistry)).includes("ASSET_UNSUPPORTED"),
    );

    const unsupportedSource = candidate({
      executionQuote: { ...candidate().executionQuote, source: "unknown-router" },
    });
    assert.ok(
      codes(validateExecutionCandidate(unsupportedSource, registry)).includes("QUOTE_INVALID"),
    );
  });

  it("rejects malformed trigger and deadline configuration before financial checks", () => {
    const malformedTrigger = candidate({
      trigger: {
        priceDecimals: 7,
        type: "PRICE_BELOW",
        value: 100n * USD_SCALE,
      },
    });
    assert.ok(
      codes(validateExecutionCandidate(malformedTrigger, registry)).includes("INVALID_TRIGGER"),
    );

    const invalidDeadline = candidate({ deadline: -1n });
    assert.ok(
      codes(validateExecutionCandidate(invalidDeadline, registry)).includes("INVALID_DEADLINE"),
    );
  });

  it("returns typed account, portfolio, and reference-valuation rejections", () => {
    const accountMismatch = candidate({
      owner: "0x0000000000000000000000000000000000000002",
    });
    assert.deepEqual(codes(validateExecutionCandidate(accountMismatch, registry)), [
      "ACCOUNT_MISMATCH",
    ]);

    const invalidPortfolio = candidate({
      portfolioSnapshot: {
        ...candidate().portfolioSnapshot,
        totalReferenceValue: 0n,
      },
    });
    assert.ok(
      codes(validateExecutionCandidate(invalidPortfolio, registry)).includes("INVALID_PORTFOLIO"),
    );

    const invalidReferenceValuation = candidate({
      executionReferenceValuation: {
        ...candidate().executionReferenceValuation,
        referenceValueDecimals: 7,
      },
    });
    assert.ok(
      codes(validateExecutionCandidate(invalidReferenceValuation, registry)).includes(
        "INVALID_REFERENCE_PRICE",
      ),
    );
  });

  it("returns typed policy rejection and skips only arithmetic with invalid policy inputs", () => {
    const invalidReserve = candidate({
      constraints: {
        ...candidate().constraints,
        minimumReserve: { rawAmount: -1n, token: USDC },
      },
    });
    const reserveResult = validateExecutionCandidate(invalidReserve, registry);

    assert.deepEqual(codes(reserveResult), ["POLICY_REJECTED"]);
    assert.equal(
      reserveResult.checks.find((check) => check.stage === "RESERVE")?.status,
      "SKIPPED",
    );
    assert.equal(
      reserveResult.checks.find((check) => check.stage === "EXPOSURE")?.status,
      "PASSED",
    );

    const allInvalid = candidate({
      constraints: {
        maximumPriceDeviationBps: -1,
        maximumSingleAssetExposureBps: 10_001,
        maximumSlippageBps: -1,
        minimumReserve: { rawAmount: -1n, token: USDC },
      },
    });
    const allInvalidResult = validateExecutionCandidate(allInvalid, registry);

    assert.deepEqual(codes(allInvalidResult), ["POLICY_REJECTED"]);
    for (const stage of ["RESERVE", "EXPOSURE", "SLIPPAGE", "POLICY"] as const) {
      assert.equal(
        allInvalidResult.checks.find((check) => check.stage === stage)?.status,
        "SKIPPED",
      );
    }
  });

  it("rejects zero buy amounts and quote sell amounts over the request", () => {
    const zeroBuy = candidate({
      executionQuote: {
        ...candidate().executionQuote,
        quotedB20EconomicBuyAmount: 0n,
        quotedRawBuyAmount: 0n,
      },
      executionReferenceValuation: {
        ...candidate().executionReferenceValuation,
        proposedBuyReferenceValue: 0n,
      },
    });
    const excessiveSell = candidate({
      executionQuote: { ...candidate().executionQuote, quotedRawSellAmount: 100_000_001n },
    });

    assert.ok(codes(validateExecutionCandidate(zeroBuy, registry)).includes("QUOTE_INVALID"));
    assert.ok(codes(validateExecutionCandidate(excessiveSell, registry)).includes("QUOTE_INVALID"));
  });

  it("treats quote balance and incomplete-simulation issues as deterministic blockers", () => {
    const balanceIssue = candidate({
      executionQuote: {
        ...candidate().executionQuote,
        issues: {
          balance: {},
          invalidSourcesPassed: [],
          simulationIncomplete: false,
        },
      },
    });
    assert.ok(
      codes(validateExecutionCandidate(balanceIssue, registry)).includes("INSUFFICIENT_BALANCE"),
    );

    const incompleteSimulation = candidate({
      executionQuote: {
        ...candidate().executionQuote,
        issues: {
          balance: null,
          invalidSourcesPassed: [],
          simulationIncomplete: true,
        },
      },
    });
    assert.ok(
      codes(validateExecutionCandidate(incompleteSimulation, registry)).includes("QUOTE_INVALID"),
    );
  });

  it("accumulates independent balance, reserve, exposure, trigger, deadline, and slippage failures", () => {
    const mixed = candidate({
      constraints: {
        ...candidate().constraints,
        maximumSingleAssetExposureBps: 500,
        maximumSlippageBps: 10,
        minimumReserve: { rawAmount: 50_000_000n, token: USDC },
      },
      currentTimestamp: 1_800_000_101n,
      deadline: 1_800_000_100n,
      executionQuote: { ...candidate().executionQuote, slippageBps: 30 },
      portfolioSnapshot: portfolio(50_000_000n, 50n * USD_SCALE),
      trigger: { priceDecimals: 8, type: "PRICE_BELOW", value: 99n * USD_SCALE },
    });
    const resultCodes = codes(validateExecutionCandidate(mixed, registry));

    for (const expected of [
      "INSUFFICIENT_BALANCE",
      "RESERVE_VIOLATION",
      "EXPOSURE_LIMIT",
      "TRIGGER_NOT_MET",
      "INTENT_EXPIRED",
      "SLIPPAGE_TOO_HIGH",
    ] satisfies RiskRejectionCode[]) {
      assert.ok(resultCodes.includes(expected), `missing ${expected}`);
    }
    assert.deepEqual(resultCodes, [
      "INSUFFICIENT_BALANCE",
      "RESERVE_VIOLATION",
      "EXPOSURE_LIMIT",
      "TRIGGER_NOT_MET",
      "INTENT_EXPIRED",
      "SLIPPAGE_TOO_HIGH",
    ]);
  });

  it("handles large bigint amounts without overflow", () => {
    const units = 1n << 180n;
    const sellAmount = units * 1_000_000n;
    const buyAmount = units * 1_000_000n;
    const large = candidate({
      constraints: {
        ...candidate().constraints,
        maximumSingleAssetExposureBps: 10_000,
        minimumReserve: { rawAmount: 0n, token: USDC },
      },
      portfolioSnapshot: portfolio(2n * sellAmount, 2n * units * USD_SCALE, 0n),
    });

    assert.equal(
      validateExecutionCandidate(withTrade(large, sellAmount, buyAmount), registry).status,
      "ACCEPTED",
    );
  });

  it("floors exposure limits deterministically", () => {
    assert.equal(maximumExposureValue(999n, 3_333), 332n);
  });

  it("enforces optional reference-value price deviation without calling it realized slippage", () => {
    const base = candidate({
      constraints: { ...candidate().constraints, maximumPriceDeviationBps: 100 },
      executionQuote: {
        ...candidate().executionQuote,
        quotedRawSellAmount: 101_000_000n,
        requestedRawSellAmount: 101_000_000n,
      },
      executionReferenceValuation: {
        ...candidate().executionReferenceValuation,
        quotedSellReferenceValue: 101n * USD_SCALE,
      },
      requestedRawSellAmount: 101_000_000n,
    });
    assert.equal(validateExecutionCandidate(base, registry).status, "ACCEPTED");

    const rejected = {
      ...base,
      constraints: { ...base.constraints, maximumPriceDeviationBps: 99 },
    };
    assert.ok(codes(validateExecutionCandidate(rejected, registry)).includes("PRICE_DEVIATION"));
  });
});

import { type AssetRegistry, VECTOR_CHAIN_ID, type VectorAsset } from "@vector/shared";

import { deviationBps, maximumExposureValue, maximumSpendAfterReserve } from "./math.ts";
import {
  RISK_VALIDATION_ORDER,
  type ExecutionCandidate,
  type RiskCheck,
  type RiskMetricValue,
  type RiskReferencePrice,
  type RiskRejection,
  type RiskRejectionCode,
  type RiskValidationResult,
  type RiskValidationStage,
} from "./types.ts";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameAsset(left: VectorAsset, right: VectorAsset): boolean {
  return (
    sameAddress(left.tokenAddress, right.tokenAddress) &&
    left.symbol === right.symbol &&
    left.assetStandard === right.assetStandard &&
    left.decimals === right.decimals &&
    left.enabled === right.enabled &&
    left.underlyingTicker === right.underlyingTicker
  );
}

function isValidBps(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10_000;
}

function isValidDecimals(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

function isRegisteredEnabledAsset(asset: VectorAsset, registry: AssetRegistry): boolean {
  if (!ADDRESS_PATTERN.test(asset.tokenAddress)) return false;
  const registered = registry.getByAddress(asset.tokenAddress);
  return registered !== undefined && registered.enabled && sameAsset(asset, registered);
}

function isReferencePriceValid(price: RiskReferencePrice, asset: VectorAsset): boolean {
  return (
    price.kind === "REFERENCE_PRICE" &&
    sameAsset(price.asset, asset) &&
    typeof price.price === "bigint" &&
    price.price > 0n &&
    isValidDecimals(price.priceDecimals) &&
    price.source.trim().length > 0
  );
}

function rejection(
  stage: RiskValidationStage,
  code: RiskRejectionCode,
  field?: string,
): RiskRejection {
  return Object.freeze({ code, ...(field === undefined ? {} : { field }), stage });
}

function quoteMatchesCandidate(candidate: ExecutionCandidate): boolean {
  const quote = candidate.executionQuote;
  const economicBuyAmount =
    candidate.buyAsset.assetStandard === "B20"
      ? quote.quotedB20EconomicBuyAmount
      : quote.quotedRawBuyAmount;

  return (
    quote.source === "0x" &&
    quote.chainId === candidate.chainId &&
    sameAsset(quote.sellAsset, candidate.sellAsset) &&
    sameAsset(quote.buyAsset, candidate.buyAsset) &&
    quote.requestedRawSellAmount === candidate.requestedRawSellAmount &&
    typeof quote.quotedRawSellAmount === "bigint" &&
    quote.quotedRawSellAmount > 0n &&
    quote.quotedRawSellAmount <= candidate.requestedRawSellAmount &&
    typeof quote.quotedRawBuyAmount === "bigint" &&
    quote.quotedRawBuyAmount > 0n &&
    typeof economicBuyAmount === "bigint" &&
    economicBuyAmount > 0n &&
    typeof quote.issues.simulationIncomplete === "boolean" &&
    !quote.issues.simulationIncomplete &&
    Array.isArray(quote.issues.invalidSourcesPassed) &&
    quote.issues.invalidSourcesPassed.length === 0
  );
}

function triggerIsValid(candidate: ExecutionCandidate): boolean {
  const trigger = candidate.trigger;

  if (trigger === undefined) return true;

  const referencePrice = candidate.currentBuyAssetReferencePrice;

  return (
    referencePrice !== undefined &&
    isReferencePriceValid(referencePrice, candidate.buyAsset) &&
    (trigger.type === "PRICE_BELOW" || trigger.type === "PRICE_ABOVE") &&
    typeof trigger.value === "bigint" &&
    trigger.value >= 0n &&
    isValidDecimals(trigger.priceDecimals) &&
    trigger.priceDecimals === referencePrice.priceDecimals
  );
}

function executionReferenceValuationIsValid(candidate: ExecutionCandidate): boolean {
  const valuation = candidate.executionReferenceValuation;
  return (
    valuation.kind === "REFERENCE_VALUATION" &&
    typeof valuation.quotedSellReferenceValue === "bigint" &&
    valuation.quotedSellReferenceValue >= 0n &&
    typeof valuation.proposedBuyReferenceValue === "bigint" &&
    valuation.proposedBuyReferenceValue >= 0n &&
    isValidDecimals(valuation.referenceValueDecimals) &&
    valuation.referenceValueDecimals === candidate.portfolioSnapshot.referenceValueDecimals
  );
}

function portfolioIsValid(candidate: ExecutionCandidate): boolean {
  const portfolio = candidate.portfolioSnapshot;

  if (
    typeof portfolio.totalReferenceValue !== "bigint" ||
    portfolio.totalReferenceValue < 0n ||
    !isValidDecimals(portfolio.referenceValueDecimals)
  ) {
    return false;
  }

  const rawAddresses = new Set<string>();
  for (const position of portfolio.positions) {
    const address = position.asset.tokenAddress.toLowerCase();
    if (
      rawAddresses.has(address) ||
      typeof position.rawBalance !== "bigint" ||
      position.rawBalance < 0n
    ) {
      return false;
    }
    rawAddresses.add(address);
  }

  const valuedAddresses = new Set<string>();
  let valuedTotal = 0n;
  for (const position of portfolio.valuedPositions) {
    const address = position.asset.tokenAddress.toLowerCase();
    const rawPosition = portfolio.positions.find((item) =>
      sameAddress(item.asset.tokenAddress, position.asset.tokenAddress),
    );
    if (
      valuedAddresses.has(address) ||
      typeof position.referenceValue !== "bigint" ||
      position.referenceValue < 0n ||
      rawPosition === undefined ||
      !sameAsset(rawPosition.asset, position.asset)
    ) {
      return false;
    }
    valuedAddresses.add(address);
    valuedTotal += position.referenceValue;
  }

  return (
    rawAddresses.size === valuedAddresses.size && valuedTotal === portfolio.totalReferenceValue
  );
}

/**
 * Accumulates independent failures in RISK_VALIDATION_ORDER. A check is skipped when an invalid
 * prerequisite would make its arithmetic or conclusion unsafe.
 */
export function validateExecutionCandidate(
  candidate: ExecutionCandidate,
  registry: AssetRegistry,
): RiskValidationResult {
  const checks: RiskCheck[] = [];
  const allRejections: RiskRejection[] = [];

  function addCheck(
    stage: RiskValidationStage,
    stageRejections: readonly RiskRejection[],
    metrics: Readonly<Record<string, RiskMetricValue>> = {},
    skipped = false,
  ): void {
    allRejections.push(...stageRejections);
    checks.push(
      Object.freeze({
        metrics: Object.freeze({ ...metrics }),
        rejectionCodes: Object.freeze(stageRejections.map((item) => item.code)),
        stage,
        status: skipped ? "SKIPPED" : stageRejections.length === 0 ? "PASSED" : "FAILED",
      }),
    );
  }

  const schemaRejections: RiskRejection[] = [];
  const candidateAmountValid =
    typeof candidate.requestedRawSellAmount === "bigint" && candidate.requestedRawSellAmount > 0n;
  const deadlineValid =
    typeof candidate.deadline === "bigint" &&
    candidate.deadline >= 0n &&
    typeof candidate.currentTimestamp === "bigint" &&
    candidate.currentTimestamp >= 0n;
  const reservePolicyValid =
    typeof candidate.constraints.minimumReserve.rawAmount === "bigint" &&
    candidate.constraints.minimumReserve.rawAmount >= 0n;
  const exposurePolicyValid = isValidBps(candidate.constraints.maximumSingleAssetExposureBps);
  const slippagePolicyValid = isValidBps(candidate.constraints.maximumSlippageBps);
  const deviationPolicyValid =
    candidate.constraints.maximumPriceDeviationBps === undefined ||
    isValidBps(candidate.constraints.maximumPriceDeviationBps);
  const policyValid =
    reservePolicyValid && exposurePolicyValid && slippagePolicyValid && deviationPolicyValid;
  const portfolioValid = portfolioIsValid(candidate);
  const referenceValuationValid = executionReferenceValuationIsValid(candidate);
  const validTrigger = triggerIsValid(candidate);

  if (candidate.chainId !== VECTOR_CHAIN_ID) {
    schemaRejections.push(rejection("SCHEMA", "WRONG_CHAIN", "chainId"));
  }
  if (!candidateAmountValid) {
    schemaRejections.push(rejection("SCHEMA", "INVALID_AMOUNT", "requestedRawSellAmount"));
  }
  if (!deadlineValid) {
    schemaRejections.push(rejection("SCHEMA", "INVALID_DEADLINE", "deadline"));
  }
  if (!validTrigger) {
    schemaRejections.push(rejection("SCHEMA", "INVALID_TRIGGER", "trigger"));
  }
  if (!policyValid) {
    schemaRejections.push(rejection("SCHEMA", "POLICY_REJECTED", "constraints"));
  }
  if (!portfolioValid) {
    schemaRejections.push(rejection("SCHEMA", "INVALID_PORTFOLIO", "portfolioSnapshot"));
  }
  if (!referenceValuationValid) {
    schemaRejections.push(rejection("SCHEMA", "INVALID_REFERENCE_PRICE", "referencePrices"));
  }
  addCheck("SCHEMA", schemaRejections);

  const assetRejections: RiskRejection[] = [];
  const assetsValid =
    isRegisteredEnabledAsset(candidate.sellAsset, registry) &&
    isRegisteredEnabledAsset(candidate.buyAsset, registry) &&
    isRegisteredEnabledAsset(candidate.constraints.minimumReserve.token, registry) &&
    candidate.portfolioSnapshot.positions.every((position) =>
      isRegisteredEnabledAsset(position.asset, registry),
    ) &&
    candidate.portfolioSnapshot.valuedPositions.every((position) =>
      isRegisteredEnabledAsset(position.asset, registry),
    );

  if (
    !assetsValid ||
    sameAddress(candidate.sellAsset.tokenAddress, candidate.buyAsset.tokenAddress)
  ) {
    assetRejections.push(rejection("ASSET", "ASSET_UNSUPPORTED", "assets"));
  }
  addCheck("ASSET", assetRejections);

  const accountRejections: RiskRejection[] = [];
  const accountValid =
    ADDRESS_PATTERN.test(candidate.owner) &&
    candidate.owner !== "0x0000000000000000000000000000000000000000" &&
    ADDRESS_PATTERN.test(candidate.portfolioSnapshot.account) &&
    sameAddress(candidate.owner, candidate.portfolioSnapshot.account);
  if (!accountValid) {
    accountRejections.push(rejection("ACCOUNT", "ACCOUNT_MISMATCH", "owner"));
  }
  addCheck("ACCOUNT", accountRejections);

  const quoteValid = candidateAmountValid && quoteMatchesCandidate(candidate);
  const financialPrerequisitesValid =
    candidate.chainId === VECTOR_CHAIN_ID &&
    candidateAmountValid &&
    portfolioValid &&
    referenceValuationValid &&
    assetsValid &&
    accountValid &&
    quoteValid;
  const sellPosition = candidate.portfolioSnapshot.positions.find((position) =>
    sameAddress(position.asset.tokenAddress, candidate.sellAsset.tokenAddress),
  );
  const availableBalance = sellPosition?.rawBalance ?? 0n;

  if (!financialPrerequisitesValid) {
    addCheck("BALANCE", [], {}, true);
  } else {
    const balanceRejections =
      availableBalance < candidate.executionQuote.quotedRawSellAmount ||
      candidate.executionQuote.issues.balance !== null
        ? [rejection("BALANCE", "INSUFFICIENT_BALANCE", "quotedRawSellAmount")]
        : [];
    addCheck("BALANCE", balanceRejections, {
      availableRawSellBalance: availableBalance,
      requiredRawSellAmount: candidate.executionQuote.quotedRawSellAmount,
    });
  }

  if (!financialPrerequisitesValid || !reservePolicyValid) {
    addCheck("RESERVE", [], {}, true);
  } else {
    const reserveApplies = sameAddress(
      candidate.constraints.minimumReserve.token.tokenAddress,
      candidate.sellAsset.tokenAddress,
    );
    const postExecutionBalance = availableBalance - candidate.executionQuote.quotedRawSellAmount;
    const reserveRejections =
      reserveApplies && postExecutionBalance < candidate.constraints.minimumReserve.rawAmount
        ? [rejection("RESERVE", "RESERVE_VIOLATION", "minimumReserve")]
        : [];
    addCheck("RESERVE", reserveRejections, {
      maximumRawSpendAfterReserve: reserveApplies
        ? maximumSpendAfterReserve(availableBalance, candidate.constraints.minimumReserve.rawAmount)
        : availableBalance,
      postExecutionRawSellBalance: postExecutionBalance,
      reserveApplies,
    });
  }

  let quotedSellReferenceValue: bigint | undefined;
  let proposedBuyReferenceValue: bigint | undefined;

  if (!financialPrerequisitesValid || !exposurePolicyValid) {
    addCheck("EXPOSURE", [], {}, true);
  } else {
    quotedSellReferenceValue = candidate.executionReferenceValuation.quotedSellReferenceValue;
    proposedBuyReferenceValue = candidate.executionReferenceValuation.proposedBuyReferenceValue;
    const canSubtractSellValue =
      candidate.portfolioSnapshot.totalReferenceValue >= quotedSellReferenceValue;

    if (!canSubtractSellValue) {
      addCheck("EXPOSURE", [rejection("EXPOSURE", "INVALID_PORTFOLIO", "totalReferenceValue")]);
    } else {
      const currentBuyExposure =
        candidate.portfolioSnapshot.valuedPositions.find((position) =>
          sameAddress(position.asset.tokenAddress, candidate.buyAsset.tokenAddress),
        )?.referenceValue ?? 0n;
      const postTradeTotal =
        candidate.portfolioSnapshot.totalReferenceValue -
        quotedSellReferenceValue +
        proposedBuyReferenceValue;
      const postTradeBuyExposure = currentBuyExposure + proposedBuyReferenceValue;
      const maximumBuyExposure = maximumExposureValue(
        postTradeTotal,
        candidate.constraints.maximumSingleAssetExposureBps,
      );
      const exposureRejections =
        postTradeBuyExposure > maximumBuyExposure
          ? [rejection("EXPOSURE", "EXPOSURE_LIMIT", "maximumSingleAssetExposureBps")]
          : [];
      addCheck("EXPOSURE", exposureRejections, {
        currentBuyReferenceExposure: currentBuyExposure,
        maximumBuyReferenceExposure: maximumBuyExposure,
        postTradeBuyReferenceExposure: postTradeBuyExposure,
        postTradeTotalReferenceValue: postTradeTotal,
        proposedBuyReferenceExposure: proposedBuyReferenceValue,
        quotedSellReferenceValue,
      });
    }
  }

  if (!validTrigger) {
    addCheck("TRIGGER", [], {}, true);
  } else {
    const trigger = candidate.trigger;
    const currentReferencePrice = candidate.currentBuyAssetReferencePrice;
    const triggerMet =
      trigger === undefined ||
      (trigger.type === "PRICE_BELOW"
        ? currentReferencePrice!.price <= trigger.value
        : currentReferencePrice!.price >= trigger.value);
    addCheck("TRIGGER", triggerMet ? [] : [rejection("TRIGGER", "TRIGGER_NOT_MET", "trigger")], {
      configured: trigger !== undefined,
      met: triggerMet,
    });
  }

  if (!deadlineValid) {
    addCheck("DEADLINE", [], {}, true);
  } else {
    const expired = candidate.currentTimestamp > candidate.deadline;
    addCheck("DEADLINE", expired ? [rejection("DEADLINE", "INTENT_EXPIRED", "deadline")] : [], {
      currentTimestamp: candidate.currentTimestamp,
      deadline: candidate.deadline,
    });
  }

  addCheck("QUOTE", quoteValid ? [] : [rejection("QUOTE", "QUOTE_INVALID", "executionQuote")]);

  const quoteSlippageValid = isValidBps(candidate.executionQuote.slippageBps);
  if (!quoteSlippageValid) {
    addCheck("SLIPPAGE", [rejection("SLIPPAGE", "QUOTE_INVALID", "executionQuote.slippageBps")]);
  } else if (!slippagePolicyValid) {
    addCheck("SLIPPAGE", [], {}, true);
  } else {
    const slippageRejections =
      candidate.executionQuote.slippageBps > candidate.constraints.maximumSlippageBps
        ? [rejection("SLIPPAGE", "SLIPPAGE_TOO_HIGH", "maximumSlippageBps")]
        : [];
    addCheck("SLIPPAGE", slippageRejections, {
      maximumSlippageBps: candidate.constraints.maximumSlippageBps,
      quoteSlippageBps: candidate.executionQuote.slippageBps,
    });
  }

  if (
    !deviationPolicyValid ||
    quotedSellReferenceValue === undefined ||
    proposedBuyReferenceValue === undefined
  ) {
    addCheck("POLICY", [], {}, true);
  } else if (candidate.constraints.maximumPriceDeviationBps === undefined) {
    addCheck("POLICY", [], { priceDeviationConfigured: false });
  } else if (proposedBuyReferenceValue === 0n) {
    addCheck("POLICY", [rejection("POLICY", "PRICE_DEVIATION", "maximumPriceDeviationBps")], {
      proposedBuyReferenceValue,
    });
  } else {
    const quoteDeviationBps = deviationBps(quotedSellReferenceValue, proposedBuyReferenceValue);
    const deviationRejections =
      quoteDeviationBps > BigInt(candidate.constraints.maximumPriceDeviationBps)
        ? [rejection("POLICY", "PRICE_DEVIATION", "maximumPriceDeviationBps")]
        : [];
    addCheck("POLICY", deviationRejections, {
      maximumPriceDeviationBps: candidate.constraints.maximumPriceDeviationBps,
      quoteReferenceValueDeviationBps: quoteDeviationBps,
    });
  }

  if (checks.some((check, index) => check.stage !== RISK_VALIDATION_ORDER[index])) {
    throw new Error("Risk validation order invariant violated.");
  }

  const frozenChecks = Object.freeze(checks);
  const frozenRejections = Object.freeze(allRejections);

  return frozenRejections.length === 0
    ? Object.freeze({
        checks: frozenChecks,
        nextState: "READY_FOR_AUTHORIZATION",
        rejections: frozenRejections,
        status: "ACCEPTED",
      })
    : Object.freeze({
        checks: frozenChecks,
        nextState: null,
        rejections: frozenRejections,
        status: "REJECTED",
      });
}

import type { EvmAddress, VectorAsset } from "@vector/shared";

export const RISK_VALIDATION_ORDER = [
  "SCHEMA",
  "ASSET",
  "ACCOUNT",
  "BALANCE",
  "RESERVE",
  "EXPOSURE",
  "TRIGGER",
  "DEADLINE",
  "QUOTE",
  "SLIPPAGE",
  "POLICY",
] as const;

export type RiskValidationStage = (typeof RISK_VALIDATION_ORDER)[number];

export type RiskRejectionCode =
  | "ACCOUNT_MISMATCH"
  | "ASSET_UNSUPPORTED"
  | "EXPOSURE_LIMIT"
  | "INSUFFICIENT_BALANCE"
  | "INTENT_EXPIRED"
  | "INVALID_DEADLINE"
  | "INVALID_PORTFOLIO"
  | "INVALID_REFERENCE_PRICE"
  | "INVALID_TRIGGER"
  | "INVALID_AMOUNT"
  | "POLICY_REJECTED"
  | "PRICE_DEVIATION"
  | "QUOTE_INVALID"
  | "RESERVE_VIOLATION"
  | "SLIPPAGE_TOO_HIGH"
  | "TRIGGER_NOT_MET"
  | "WRONG_CHAIN";

export interface RiskRejection {
  readonly code: RiskRejectionCode;
  readonly field?: string;
  readonly stage: RiskValidationStage;
}

export type RiskCheckStatus = "FAILED" | "PASSED" | "SKIPPED";

export type RiskMetricValue = bigint | boolean | number | string;

export interface RiskCheck {
  readonly metrics: Readonly<Record<string, RiskMetricValue>>;
  readonly rejectionCodes: readonly RiskRejectionCode[];
  readonly stage: RiskValidationStage;
  readonly status: RiskCheckStatus;
}

export interface MinimumReserveConstraint {
  readonly rawAmount: bigint;
  readonly token: VectorAsset;
}

export interface RiskPolicy {
  readonly maximumPriceDeviationBps?: number;
  readonly maximumSingleAssetExposureBps: number;
  readonly maximumSlippageBps: number;
  readonly minimumReserve: MinimumReserveConstraint;
}

export interface RiskPortfolioPosition {
  readonly asset: VectorAsset;
  readonly rawBalance: bigint;
}

export interface RiskValuedPosition {
  readonly asset: VectorAsset;
  readonly referenceValue: bigint;
}

export interface RiskPortfolioSnapshot {
  readonly account: EvmAddress;
  readonly positions: readonly RiskPortfolioPosition[];
  readonly referenceValueDecimals: number;
  readonly totalReferenceValue: bigint;
  readonly valuedPositions: readonly RiskValuedPosition[];
}

export interface RiskReferencePrice {
  readonly asset: VectorAsset;
  readonly kind: "REFERENCE_PRICE";
  readonly price: bigint;
  readonly priceDecimals: number;
  readonly source: string;
}

export type PriceTrigger =
  | {
      readonly priceDecimals: number;
      readonly type: "PRICE_BELOW";
      readonly value: bigint;
    }
  | {
      readonly priceDecimals: number;
      readonly type: "PRICE_ABOVE";
      readonly value: bigint;
    };

/** A projection of external quote fields required by pure risk validation. */
export interface RiskExecutionQuote {
  readonly buyAsset: VectorAsset;
  readonly chainId: number;
  readonly issues: {
    readonly balance: object | null;
    readonly invalidSourcesPassed: readonly string[];
    readonly simulationIncomplete: boolean;
  };
  readonly quotedB20EconomicBuyAmount?: bigint;
  readonly quotedRawBuyAmount: bigint;
  readonly quotedRawSellAmount: bigint;
  readonly requestedRawSellAmount: bigint;
  readonly sellAsset: VectorAsset;
  readonly slippageBps: number;
  readonly source: string;
}

export interface ExecutionReferenceValuation {
  readonly kind: "REFERENCE_VALUATION";
  readonly proposedBuyReferenceValue: bigint;
  readonly quotedSellReferenceValue: bigint;
  readonly referenceValueDecimals: number;
}

export interface ExecutionCandidate {
  readonly buyAsset: VectorAsset;
  readonly chainId: number;
  readonly constraints: RiskPolicy;
  readonly currentBuyAssetReferencePrice?: RiskReferencePrice;
  readonly currentTimestamp: bigint;
  readonly deadline: bigint;
  readonly executionQuote: RiskExecutionQuote;
  readonly executionReferenceValuation: ExecutionReferenceValuation;
  readonly owner: EvmAddress;
  readonly portfolioSnapshot: RiskPortfolioSnapshot;
  readonly requestedRawSellAmount: bigint;
  readonly sellAsset: VectorAsset;
  readonly trigger?: PriceTrigger;
}

interface RiskValidationResultBase {
  readonly checks: readonly RiskCheck[];
  readonly rejections: readonly RiskRejection[];
}

export interface AcceptedRiskValidationResult extends RiskValidationResultBase {
  readonly nextState: "READY_FOR_AUTHORIZATION";
  readonly status: "ACCEPTED";
}

export interface RejectedRiskValidationResult extends RiskValidationResultBase {
  readonly nextState: null;
  readonly status: "REJECTED";
}

export type RiskValidationResult = AcceptedRiskValidationResult | RejectedRiskValidationResult;

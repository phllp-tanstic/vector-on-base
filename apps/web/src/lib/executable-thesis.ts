export const DEFAULT_DEMO_THESIS =
  "Buy NVDA if it falls below $170. Use up to 10% of my portfolio, keep at least $1,000 USDC, maximum 1% slippage, and expire this thesis on Friday.";

export const TESTNET_EXECUTION_DISCLOSURE = "BASE SEPOLIA LIVE DEMO · TEST ASSETS · NO REAL STOCKS";

export const THESIS_STATUSES = [
  "DRAFT",
  "INTERPRETED",
  "RISK_CHECKED",
  "ADJUSTED",
  "BLOCKED",
  "READY_FOR_AUTHORIZATION",
  "AUTHORIZING",
  "EXECUTED",
  "EXPIRED",
  "FAILED",
] as const;

export type ThesisStatus = (typeof THESIS_STATUSES)[number];
export type RiskPanelState = "PASSED" | "ADJUSTED" | "BLOCKED";

export interface UserThesisIntent {
  readonly asset: "NVDA";
  readonly rationale: string;
  readonly sourceText: string;
}

export interface DeterministicThesisParameters {
  readonly entryPriceUsd: number;
  readonly expiryIso: string;
  readonly maxExposurePercent: number;
  readonly maxSlippagePercent: number;
  readonly requestedSizeUsd: number;
  readonly reserveUsd: number;
}

export interface ExecutableThesis {
  readonly id: string;
  readonly intent: UserThesisIntent;
  readonly parameters: DeterministicThesisParameters;
  readonly planRevision: number;
  readonly status: ThesisStatus;
}

export interface DemoPortfolioSnapshot {
  readonly availableUsdcUsd: number;
  readonly currentAssetExposureUsd: number;
  readonly currentReferencePriceUsd: number;
  readonly portfolioValueUsd: number;
  readonly quotedSlippagePercent: number;
}

export interface ThesisRiskResult {
  readonly executableSizeUsd: number;
  readonly expiryValid: boolean;
  readonly maximumAssetExposureUsd: number;
  readonly postTradeExposureUsd: number;
  readonly reasons: readonly (RiskRejectionCode | "RESERVE_ADJUSTMENT")[];
  readonly state: RiskPanelState;
  readonly triggerSatisfied: boolean;
}

export interface PreparedThesisExecution {
  readonly preparedRevision: number;
  readonly thesisId: string;
}

export const DEMO_PORTFOLIO = Object.freeze({
  availableUsdcUsd: 1_320,
  currentAssetExposureUsd: 0,
  currentReferencePriceUsd: 168.4,
  portfolioValueUsd: 5_000,
  quotedSlippagePercent: 0.75,
}) satisfies DemoPortfolioSnapshot;

export const PRODUCTION_READINESS = Object.freeze([
  { label: "Base Smart Account authorization", state: "READY" },
  { label: "VectorExecutor architecture", state: "READY" },
  { label: "B20 asset validation", state: "READY" },
  { label: "Deterministic risk engine", state: "READY" },
  { label: "0x BStocks routing", state: "ACCESS PENDING" },
  { label: "Chainlink equity reference data", state: "ACCESS PENDING" },
  { label: "Base Mainnet deployment", state: "NOT DEPLOYED" },
] as const);

function nextFridayAtFive(now: Date): Date {
  const result = new Date(now);
  const days = (5 - result.getDay() + 7) % 7 || 7;
  result.setDate(result.getDate() + days);
  result.setHours(17, 0, 0, 0);
  return result;
}

function numberFrom(text: string, pattern: RegExp, fallback: number): number {
  const match = pattern.exec(text);
  return match?.[1] ? Number(match[1].replaceAll(",", "")) : fallback;
}

/** Deterministic demo grammar. This is deliberately not represented as a production AI parser. */
export function interpretDemoThesis(sourceText: string, now = new Date()): ExecutableThesis {
  const normalized = sourceText.trim();
  if (!normalized) throw new Error("A thesis is required.");
  const ticker = /\bNVDA(?:c)?\b/i.test(normalized) ? "NVDA" : undefined;
  if (!ticker) throw new Error("Demo intent interpreter currently supports NVDA only.");

  const entryPriceUsd = numberFrom(normalized, /(?:below|under|falls? below)\s*\$?([\d,.]+)/i, 170);
  const maxExposurePercent = numberFrom(normalized, /(?:up to|no more than)\s*([\d.]+)%/i, 10);
  const reserveUsd = numberFrom(normalized, /(?:keep|reserve)[^$]*\$([\d,.]+)/i, 1_000);
  const maxSlippagePercent = numberFrom(normalized, /(?:maximum|max)\s*([\d.]+)%\s*slippage/i, 1);

  return Object.freeze({
    id: `nvda-${now.getTime()}`,
    intent: Object.freeze({
      asset: ticker,
      rationale: `Acquire NVDA exposure only when its reference price is at or below $${entryPriceUsd}.`,
      sourceText: normalized,
    }),
    parameters: Object.freeze({
      entryPriceUsd,
      expiryIso: nextFridayAtFive(now).toISOString(),
      maxExposurePercent,
      maxSlippagePercent,
      requestedSizeUsd: 500,
      reserveUsd,
    }),
    planRevision: 0,
    status: "INTERPRETED",
  });
}

export function editThesisParameters(
  thesis: ExecutableThesis,
  changes: Partial<DeterministicThesisParameters>,
): ExecutableThesis {
  return Object.freeze({
    ...thesis,
    parameters: Object.freeze({ ...thesis.parameters, ...changes }),
    planRevision: thesis.planRevision + 1,
    status: "INTERPRETED",
  });
}

export function evaluateThesisRisk(
  thesis: ExecutableThesis,
  portfolio: DemoPortfolioSnapshot,
  now = new Date(),
): ThesisRiskResult {
  const parameters = thesis.parameters;
  const parametersValid =
    Number.isFinite(parameters.entryPriceUsd) &&
    parameters.entryPriceUsd > 0 &&
    Number.isFinite(parameters.maxExposurePercent) &&
    parameters.maxExposurePercent > 0 &&
    parameters.maxExposurePercent <= 100 &&
    Number.isFinite(parameters.maxSlippagePercent) &&
    parameters.maxSlippagePercent >= 0 &&
    parameters.maxSlippagePercent <= 100 &&
    Number.isFinite(parameters.requestedSizeUsd) &&
    parameters.requestedSizeUsd > 0 &&
    Number.isFinite(parameters.reserveUsd) &&
    parameters.reserveUsd >= 0;
  const expiryValid = Date.parse(parameters.expiryIso) > now.getTime();
  const triggerSatisfied = portfolio.currentReferencePriceUsd <= parameters.entryPriceUsd;
  const toCents = (value: number) => BigInt(Math.round(value * 100));
  const maximumAssetExposureCents = parametersValid
    ? maximumExposureValue(
        toCents(portfolio.portfolioValueUsd),
        Math.round(parameters.maxExposurePercent * 100),
      )
    : 0n;
  const maximumAssetExposureUsd = Number(maximumAssetExposureCents) / 100;
  const remainingExposureCapacity = Math.max(
    0,
    Number(maximumAssetExposureCents - toCents(portfolio.currentAssetExposureUsd)) / 100,
  );
  const reserveCapacity =
    Number(
      maximumSpendAfterReserve(
        toCents(portfolio.availableUsdcUsd),
        parametersValid ? toCents(parameters.reserveUsd) : 0n,
      ),
    ) / 100;
  const executableSizeUsd = Math.max(
    0,
    Math.min(parameters.requestedSizeUsd, remainingExposureCapacity, reserveCapacity),
  );
  const reasons: (RiskRejectionCode | "RESERVE_ADJUSTMENT")[] = [];

  if (!parametersValid) reasons.push("POLICY_REJECTED");
  if (!expiryValid) reasons.push("INTENT_EXPIRED");
  if (!triggerSatisfied) reasons.push("TRIGGER_NOT_MET");
  if (portfolio.quotedSlippagePercent > parameters.maxSlippagePercent) {
    reasons.push("SLIPPAGE_TOO_HIGH");
  }
  if (remainingExposureCapacity <= 0 || executableSizeUsd <= 0) reasons.push("EXPOSURE_LIMIT");
  if (reserveCapacity < parameters.requestedSizeUsd && reserveCapacity > 0) {
    reasons.push("RESERVE_ADJUSTMENT");
  }

  const blocked = reasons.some((reason) => reason !== "RESERVE_ADJUSTMENT");
  return Object.freeze({
    executableSizeUsd: parametersValid ? executableSizeUsd : 0,
    expiryValid,
    maximumAssetExposureUsd,
    postTradeExposureUsd:
      portfolio.currentAssetExposureUsd + (parametersValid ? executableSizeUsd : 0),
    reasons: Object.freeze(reasons),
    state: blocked
      ? "BLOCKED"
      : executableSizeUsd < parameters.requestedSizeUsd
        ? "ADJUSTED"
        : "PASSED",
    triggerSatisfied,
  });
}

export function acceptRiskResult(
  thesis: ExecutableThesis,
  risk: ThesisRiskResult,
): ExecutableThesis {
  return Object.freeze({
    ...thesis,
    status:
      risk.state === "BLOCKED"
        ? risk.expiryValid
          ? "BLOCKED"
          : "EXPIRED"
        : "READY_FOR_AUTHORIZATION",
  });
}

export function prepareThesisExecution(
  thesis: ExecutableThesis,
  explicitUserAction: boolean,
): PreparedThesisExecution | null {
  if (!explicitUserAction || thesis.status !== "READY_FOR_AUTHORIZATION") return null;
  return Object.freeze({ preparedRevision: thesis.planRevision, thesisId: thesis.id });
}

export function canAuthorizeThesis(
  thesis: ExecutableThesis,
  prepared: PreparedThesisExecution | null,
): boolean {
  return Boolean(
    thesis.status === "READY_FOR_AUTHORIZATION" &&
    prepared &&
    prepared.thesisId === thesis.id &&
    prepared.preparedRevision === thesis.planRevision,
  );
}

export function isDemoAssetAllowedInProduction(symbol: string): boolean {
  return !["mUSDC", "NOTB20"].includes(symbol);
}

export function readinessCanDisplayReady(state: string): boolean {
  return state === "READY";
}
import {
  maximumExposureValue,
  maximumSpendAfterReserve,
  type RiskRejectionCode,
} from "@vector/risk";

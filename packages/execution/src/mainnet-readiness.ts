import {
  BASE_MAINNET_ASSET_REGISTRY,
  BASE_MAINNET_TOKENIZED_STOCKS,
  BASE_MAINNET_USDC,
  findSnapshotPrice,
  ZeroXError,
  type B20AssetVerificationResult,
  type ChainlinkReferencePriceSnapshot,
  type Erc20Metadata,
  type ZeroXExactSellRequest,
} from "@vector/integrations";
import {
  USD_REFERENCE_VALUE_DECIMALS,
  USD_REFERENCE_VALUE_SCALE,
  type AssetPrice,
} from "@vector/portfolio";
import {
  validateExecutionCandidate,
  type ExecutionCandidate,
  type RiskValidationResult,
} from "@vector/risk";
import { VECTOR_CHAIN_ID, type B20VectorAsset, type EvmAddress } from "@vector/shared";
import { getAddress, isAddress, zeroAddress, type Hex } from "viem";

import { ExecutionQuoteValidationError, type VectorExecutionQuote } from "./external-quote.ts";
import {
  buildVectorExecutionPlan,
  ExecutionPlanValidationError,
  type VectorExecutionPlan,
} from "./execution-plan.ts";
import {
  validateZeroXAllowanceHolderTargets,
  ZeroXTargetValidationError,
} from "./zerox-target-policy.ts";

export const MAINNET_READINESS_STATES = [
  "READY",
  "ACCESS_RESTRICTED",
  "QUOTE_UNAVAILABLE",
  "INSUFFICIENT_BALANCE",
  "EXECUTOR_NOT_CONFIGURED",
  "ASSET_NOT_SUPPORTED",
  "B20_VALIDATION_FAILED",
  "RISK_REJECTED",
  "INVALID_QUOTE",
  "REFERENCE_PRICE_PROVIDER_MISSING",
  "REFERENCE_PRICE_PROVIDER_FAILURE",
  "CONFIGURATION_ERROR",
] as const;

export type MainnetReadinessState = (typeof MAINNET_READINESS_STATES)[number];
export type MainnetReadinessCheckStatus = "FAILED" | "PASSED" | "SKIPPED";

export interface MainnetReadinessCheck {
  readonly name: string;
  readonly status: MainnetReadinessCheckStatus;
  readonly detail: string;
}

export type MainnetAccessRestriction =
  "LEGAL_TOKEN_TRADE_RESTRICTION" | "TOKENIZED_EQUITY_ACCOUNT_ACCESS_REQUIRED";

export interface MainnetReadinessReport {
  readonly state: MainnetReadinessState;
  readonly message: string;
  readonly checks: readonly MainnetReadinessCheck[];
  readonly accessRestriction?: MainnetAccessRestriction;
  readonly executorAddress?: EvmAddress;
  readonly executorOwner?: EvmAddress;
  readonly exactApprovalAmount?: bigint;
  readonly plan?: VectorExecutionPlan;
  readonly quote?: VectorExecutionQuote;
  readonly referencePrice?: AssetPrice;
  readonly referenceSnapshotId?: Hex;
  readonly riskResult?: RiskValidationResult;
  readonly selectedAsset?: B20VectorAsset;
  readonly smartAccountUsdcBalance?: bigint;
}

export interface MainnetReadinessRiskContext {
  readonly candidate: ExecutionCandidate & { readonly executionQuote: VectorExecutionQuote };
  readonly deadline: bigint;
  readonly nonce: bigint;
  readonly referenceSnapshotId?: Hex;
}

export interface MainnetReadinessInput {
  readonly chainId: number;
  readonly executorAddress?: string;
  readonly nowSeconds: bigint;
  readonly riskContext?: MainnetReadinessRiskContext;
  readonly sellAmount: bigint;
  readonly slippageBps: number;
  readonly smartAccountAddress?: string;
  readonly stockSymbol: string;
  readonly stockTokenAddress?: string;
}

/** Read-only capability surface. Transaction/signing methods cannot be injected here. */
export interface MainnetReadinessDependencies {
  getChainId(): Promise<number>;
  getCode(address: EvmAddress): Promise<Hex | undefined>;
  getExecutionQuote(request: ZeroXExactSellRequest): Promise<VectorExecutionQuote>;
  readonly getReferencePrice?: (asset: B20VectorAsset) => Promise<AssetPrice>;
  readonly getReferencePriceSnapshot?: () => Promise<ChainlinkReferencePriceSnapshot>;
  readExecutorAllowanceTargetApproval(executor: EvmAddress, target: EvmAddress): Promise<boolean>;
  readExecutorAssetSupport(executor: EvmAddress, asset: EvmAddress): Promise<boolean>;
  readExecutorExecutionTargetApproval(executor: EvmAddress, target: EvmAddress): Promise<boolean>;
  readExecutorOwner(executor: EvmAddress): Promise<EvmAddress>;
  readTokenBalance(token: EvmAddress, account: EvmAddress): Promise<bigint>;
  readTokenMetadata(token: EvmAddress): Promise<Erc20Metadata>;
  verifyB20Asset(asset: B20VectorAsset): Promise<B20AssetVerificationResult>;
}

export type ZeroXReadinessClassification =
  | {
      readonly state: "ACCESS_RESTRICTED";
      readonly restriction: MainnetAccessRestriction;
    }
  | { readonly state: "ASSET_NOT_SUPPORTED" }
  | { readonly state: "CONFIGURATION_ERROR" }
  | { readonly state: "INVALID_QUOTE" }
  | { readonly state: "QUOTE_UNAVAILABLE" };

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function passed(name: string, detail: string): MainnetReadinessCheck {
  return Object.freeze({ detail, name, status: "PASSED" });
}

function failed(name: string, detail: string): MainnetReadinessCheck {
  return Object.freeze({ detail, name, status: "FAILED" });
}

function skipped(name: string, detail: string): MainnetReadinessCheck {
  return Object.freeze({ detail, name, status: "SKIPPED" });
}

function report(
  state: MainnetReadinessState,
  message: string,
  checks: readonly MainnetReadinessCheck[],
  details: Omit<MainnetReadinessReport, "checks" | "message" | "state"> = {},
): MainnetReadinessReport {
  return Object.freeze({ ...details, checks: Object.freeze([...checks]), message, state });
}

function resolveAddress(value: string | undefined): EvmAddress | undefined {
  if (!value || !isAddress(value, { strict: false }) || sameAddress(value, zeroAddress)) {
    return undefined;
  }
  return getAddress(value) as EvmAddress;
}

function resolveStock(symbol: string): B20VectorAsset | undefined {
  const asset = BASE_MAINNET_ASSET_REGISTRY.getBySymbol(symbol);
  if (!asset || !asset.enabled || asset.assetStandard !== "B20") return undefined;
  return BASE_MAINNET_TOKENIZED_STOCKS.some((stock) =>
    sameAddress(stock.tokenAddress, asset.tokenAddress),
  )
    ? asset
    : undefined;
}

export function classifyZeroXReadinessError(error: ZeroXError): ZeroXReadinessClassification {
  if (error.httpStatus === 422 && error.remote.code === "BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE") {
    return Object.freeze({
      restriction: "LEGAL_TOKEN_TRADE_RESTRICTION",
      state: "ACCESS_RESTRICTED",
    });
  }
  if (
    error.code === "TOKENIZED_EQUITY_ACCESS_REQUIRED" &&
    error.httpStatus === 403 &&
    error.remote.code === "XSTOCKS_NOT_AUTHORIZED"
  ) {
    return Object.freeze({
      restriction: "TOKENIZED_EQUITY_ACCOUNT_ACCESS_REQUIRED",
      state: "ACCESS_RESTRICTED",
    });
  }
  if (error.code === "NO_LIQUIDITY") return Object.freeze({ state: "QUOTE_UNAVAILABLE" });
  if (error.code === "TOKEN_NOT_SUPPORTED") return Object.freeze({ state: "ASSET_NOT_SUPPORTED" });
  if (error.code === "INVALID_ZEROX_RESPONSE" || error.code === "QUOTE_VALIDATION_ERROR") {
    return Object.freeze({ state: "INVALID_QUOTE" });
  }
  return Object.freeze({ state: "CONFIGURATION_ERROR" });
}

function quoteIsCanonical(
  quote: VectorExecutionQuote,
  request: ZeroXExactSellRequest,
  executor: EvmAddress,
): string | undefined {
  if (
    quote.chainId !== VECTOR_CHAIN_ID ||
    !sameAddress(quote.sellAsset.tokenAddress, request.sellAsset.tokenAddress) ||
    !sameAddress(quote.buyAsset.tokenAddress, request.buyAsset.tokenAddress) ||
    !sameAddress(quote.taker, executor)
  ) {
    return "Quote chain, pair, or taker does not match the canonical request.";
  }
  if (
    quote.quotedRawSellAmount <= 0n ||
    quote.quotedRawBuyAmount <= 0n ||
    quote.minBuyAmount <= 0n ||
    quote.minBuyAmount > quote.quotedRawBuyAmount ||
    quote.quotedRawSellAmount !== request.sellAmount ||
    quote.requestedRawSellAmount !== request.sellAmount ||
    quote.slippageBps !== request.slippageBps
  ) {
    return "Quote amounts, minimum, or request bounds are inconsistent.";
  }
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(quote.transaction.data)) {
    return "Quote calldata is empty or malformed.";
  }
  if (quote.transaction.value !== 0n) return "USDC AllowanceHolder quote value must be zero.";
  if (!Number.isFinite(Date.parse(quote.quoteTimestamp))) return "Quote timestamp is invalid.";
  return undefined;
}

function fixedPointReferenceValue(
  economicAmount: bigint,
  tokenDecimals: number,
  price: bigint,
  priceDecimals: number,
): bigint {
  return (
    (economicAmount * price * USD_REFERENCE_VALUE_SCALE) /
    (10n ** BigInt(tokenDecimals) * 10n ** BigInt(priceDecimals))
  );
}

export async function checkBaseMainnetExecutionReadiness(
  input: MainnetReadinessInput,
  dependencies: MainnetReadinessDependencies,
): Promise<MainnetReadinessReport> {
  const checks: MainnetReadinessCheck[] = [];

  if (input.chainId !== VECTOR_CHAIN_ID) {
    checks.push(
      failed("requested-chain", `Expected ${VECTOR_CHAIN_ID}, received ${input.chainId}.`),
    );
    return report("CONFIGURATION_ERROR", "Readiness is restricted to Base Mainnet.", checks);
  }
  if (
    input.sellAmount <= 0n ||
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 10_000
  ) {
    checks.push(failed("request", "Sell amount or slippage bound is invalid."));
    return report("CONFIGURATION_ERROR", "Readiness request is invalid.", checks);
  }
  const rpcChainId = await dependencies.getChainId().catch(() => undefined);
  if (rpcChainId !== VECTOR_CHAIN_ID) {
    checks.push(
      failed("rpc-chain", `Expected ${VECTOR_CHAIN_ID}, received ${rpcChainId ?? "error"}.`),
    );
    return report("CONFIGURATION_ERROR", "Configured RPC is not verified Base Mainnet.", checks);
  }
  checks.push(passed("chain", `Requested and RPC chain IDs are ${VECTOR_CHAIN_ID}.`));

  const executor = resolveAddress(input.executorAddress);
  if (!executor) {
    checks.push(failed("executor", "VECTOR_EXECUTOR_ADDRESS is missing or invalid."));
    return report("EXECUTOR_NOT_CONFIGURED", "No production VectorExecutor is configured.", checks);
  }
  const executorCode = await dependencies.getCode(executor).catch(() => undefined);
  if (!executorCode || executorCode === "0x") {
    checks.push(failed("executor-bytecode", "Configured executor has no readable bytecode."));
    return report(
      "EXECUTOR_NOT_CONFIGURED",
      "Configured VectorExecutor is not deployed at the requested address.",
      checks,
      { executorAddress: executor },
    );
  }
  checks.push(passed("executor-bytecode", "Configured executor has deployed bytecode."));

  const rawExecutorOwner = await dependencies.readExecutorOwner(executor).catch(() => undefined);
  const executorOwner = resolveAddress(rawExecutorOwner);
  if (!executorOwner) {
    checks.push(
      failed("executor-owner", "Executor owner could not be read as a non-zero address."),
    );
    return report("CONFIGURATION_ERROR", "VectorExecutor ownership is unreadable.", checks, {
      executorAddress: executor,
    });
  }
  checks.push(passed("executor-owner", `Executor owner is ${executorOwner}.`));

  if (!sameAddress(BASE_MAINNET_USDC.tokenAddress, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")) {
    checks.push(failed("canonical-usdc", "Registry sell token is not canonical Base USDC."));
    return report("CONFIGURATION_ERROR", "Canonical Base USDC configuration is invalid.", checks);
  }
  checks.push(passed("canonical-usdc", `Sell token is ${BASE_MAINNET_USDC.tokenAddress}.`));

  const selectedAsset = resolveStock(input.stockSymbol);
  if (!selectedAsset) {
    checks.push(failed("verified-stock", `${input.stockSymbol} is not an enabled verified stock.`));
    return report(
      "ASSET_NOT_SUPPORTED",
      "Selected stock is outside the verified registry.",
      checks,
      {
        executorAddress: executor,
        executorOwner,
      },
    );
  }
  if (
    input.stockTokenAddress !== undefined &&
    (!resolveAddress(input.stockTokenAddress) ||
      !sameAddress(input.stockTokenAddress, selectedAsset.tokenAddress))
  ) {
    checks.push(
      failed("verified-stock-address", "Configured stock token does not match its symbol."),
    );
    return report(
      "ASSET_NOT_SUPPORTED",
      "Selected stock token is outside the verified registry.",
      checks,
      {
        executorAddress: executor,
        executorOwner,
        selectedAsset,
      },
    );
  }
  checks.push(passed("verified-stock", `${selectedAsset.symbol} is in the verified registry.`));

  let smartAccount: EvmAddress | undefined;
  if (input.smartAccountAddress !== undefined) {
    smartAccount = resolveAddress(input.smartAccountAddress);
    if (!smartAccount) {
      checks.push(failed("smart-account", "Configured Smart Account address is invalid."));
      return report("CONFIGURATION_ERROR", "Smart Account configuration is invalid.", checks, {
        executorAddress: executor,
        executorOwner,
        selectedAsset,
      });
    }
    checks.push(passed("smart-account", `Smart Account is ${smartAccount}.`));
  } else {
    checks.push(skipped("smart-account", "Optional Smart Account was not configured."));
  }

  try {
    const [usdcMetadata, buyMetadata, b20Verification] = await Promise.all([
      dependencies.readTokenMetadata(BASE_MAINNET_USDC.tokenAddress),
      dependencies.readTokenMetadata(selectedAsset.tokenAddress),
      dependencies.verifyB20Asset(selectedAsset),
    ]);
    if (
      usdcMetadata.decimals !== BASE_MAINNET_USDC.decimals ||
      usdcMetadata.symbol !== BASE_MAINNET_USDC.symbol ||
      buyMetadata.decimals !== selectedAsset.decimals ||
      buyMetadata.symbol !== selectedAsset.symbol ||
      b20Verification.decimals !== selectedAsset.decimals ||
      b20Verification.symbol !== selectedAsset.symbol
    ) {
      checks.push(failed("token-metadata", "Onchain token metadata does not match the registry."));
      return report("B20_VALIDATION_FAILED", "Token identity validation failed.", checks, {
        executorAddress: executor,
        executorOwner,
        selectedAsset,
      });
    }
    checks.push(passed("token-metadata", "USDC and selected-stock decimals/symbols are readable."));
    checks.push(passed("b20-validation", "Existing B20 capability verification passed."));
  } catch (error) {
    checks.push(
      failed("b20-validation", error instanceof Error ? error.message : "B20 read failed."),
    );
    return report(
      "B20_VALIDATION_FAILED",
      "B20 capability or token metadata validation failed.",
      checks,
      { executorAddress: executor, executorOwner, selectedAsset },
    );
  }

  let smartAccountUsdcBalance: bigint | undefined;
  if (smartAccount) {
    try {
      smartAccountUsdcBalance = await dependencies.readTokenBalance(
        BASE_MAINNET_USDC.tokenAddress,
        smartAccount,
      );
    } catch (error) {
      checks.push(
        failed("usdc-balance", error instanceof Error ? error.message : "Balance read failed."),
      );
      return report("CONFIGURATION_ERROR", "Smart Account USDC balance is unreadable.", checks, {
        executorAddress: executor,
        executorOwner,
        selectedAsset,
      });
    }
    if (smartAccountUsdcBalance < input.sellAmount) {
      checks.push(
        failed("usdc-balance", "Smart Account balance is below the requested sell amount."),
      );
      return report("INSUFFICIENT_BALANCE", "Smart Account has insufficient Base USDC.", checks, {
        executorAddress: executor,
        executorOwner,
        selectedAsset,
        ...(smartAccountUsdcBalance === undefined ? {} : { smartAccountUsdcBalance }),
      });
    }
    checks.push(passed("usdc-balance", "Smart Account Base USDC balance is sufficient."));
  } else {
    checks.push(
      skipped("usdc-balance", "No Smart Account was supplied for the optional balance read."),
    );
  }

  const [sellSupported, buySupported] = await Promise.all([
    dependencies.readExecutorAssetSupport(executor, BASE_MAINNET_USDC.tokenAddress),
    dependencies.readExecutorAssetSupport(executor, selectedAsset.tokenAddress),
  ]).catch(() => [undefined, undefined] as const);
  if (sellSupported !== true || buySupported !== true) {
    checks.push(failed("executor-assets", "Executor does not support both requested assets."));
    return report("ASSET_NOT_SUPPORTED", "Executor asset configuration is incomplete.", checks, {
      executorAddress: executor,
      executorOwner,
      selectedAsset,
      ...(smartAccountUsdcBalance === undefined ? {} : { smartAccountUsdcBalance }),
    });
  }
  checks.push(passed("executor-assets", "Executor supports Base USDC and the selected stock."));

  const request = Object.freeze({
    buyAsset: selectedAsset,
    chainId: VECTOR_CHAIN_ID,
    sellAmount: input.sellAmount,
    sellAsset: BASE_MAINNET_USDC,
    slippageBps: input.slippageBps,
    taker: executor,
  }) satisfies ZeroXExactSellRequest;

  let quote: VectorExecutionQuote;
  try {
    quote = await dependencies.getExecutionQuote(request);
  } catch (error) {
    if (error instanceof ZeroXError) {
      const classification = classifyZeroXReadinessError(error);
      checks.push(failed("zero-x-quote", error.message));
      return report(classification.state, "0x did not provide a usable BStocks quote.", checks, {
        ...(classification.state === "ACCESS_RESTRICTED"
          ? { accessRestriction: classification.restriction }
          : {}),
        executorAddress: executor,
        executorOwner,
        selectedAsset,
        ...(smartAccountUsdcBalance === undefined ? {} : { smartAccountUsdcBalance }),
      });
    }
    if (error instanceof ZeroXTargetValidationError) {
      checks.push(failed("quote-target-validation", `${error.code}: ${error.message}`));
      checks.push(
        error.code === "UNKNOWN_ALLOWANCE_HOLDER" || error.code === "SETTLER_AS_ALLOWANCE_TARGET"
          ? failed("allowance-holder-recognition", error.message)
          : skipped("allowance-holder-recognition", "Target relationship validation failed first."),
      );
      return report("INVALID_QUOTE", "0x quote target is not trusted for execution.", checks, {
        executorAddress: executor,
        executorOwner,
        selectedAsset,
      });
    }
    if (error instanceof ExecutionQuoteValidationError) {
      checks.push(failed("zero-x-quote", error.message));
      return report("INVALID_QUOTE", "0x quote normalization failed.", checks, {
        executorAddress: executor,
        executorOwner,
        selectedAsset,
      });
    }
    checks.push(failed("zero-x-quote", error instanceof Error ? error.message : "Quote failed."));
    return report("CONFIGURATION_ERROR", "0x quote acquisition failed.", checks, {
      executorAddress: executor,
      executorOwner,
      selectedAsset,
    });
  }

  const quoteProblem = quoteIsCanonical(quote, request, executor);
  if (quoteProblem) {
    checks.push(failed("quote-validation", quoteProblem));
    return report("INVALID_QUOTE", "0x quote failed canonical validation.", checks, {
      executorAddress: executor,
      executorOwner,
      quote,
      selectedAsset,
    });
  }
  checks.push(passed("quote-validation", "Quote pair, taker, amounts, and payload are canonical."));
  try {
    const targets = validateZeroXAllowanceHolderTargets(quote);
    checks.push(
      passed(
        "quote-target-validation",
        "transaction.to, allowanceTarget, and allowance issue spender satisfy ERC-20 AllowanceHolder semantics.",
      ),
    );
    checks.push(
      passed(
        "allowance-holder-recognition",
        `${targets.allowanceHolder} is recognized by ${targets.manifestVersion}.`,
      ),
    );
  } catch (error) {
    const detail =
      error instanceof ZeroXTargetValidationError
        ? `${error.code}: ${error.message}`
        : "0x target validation failed.";
    checks.push(failed("quote-target-validation", detail));
    checks.push(
      error instanceof ZeroXTargetValidationError &&
        (error.code === "UNKNOWN_ALLOWANCE_HOLDER" || error.code === "SETTLER_AS_ALLOWANCE_TARGET")
        ? failed("allowance-holder-recognition", detail)
        : skipped("allowance-holder-recognition", "Target relationship validation failed first."),
    );
    return report("INVALID_QUOTE", "0x quote target is not trusted for execution.", checks, {
      executorAddress: executor,
      executorOwner,
      quote,
      selectedAsset,
    });
  }
  checks.push(
    skipped(
      "quote-expiry",
      "0x response exposes no explicit expiry; plan deadline is checked separately.",
    ),
  );

  const allowanceTarget = quote.allowanceTarget!;
  const [executionApproved, allowanceApproved] = await Promise.all([
    dependencies.readExecutorExecutionTargetApproval(executor, quote.transaction.target),
    dependencies.readExecutorAllowanceTargetApproval(executor, allowanceTarget),
  ]).catch(() => [undefined, undefined] as const);
  if (executionApproved !== true || allowanceApproved !== true) {
    checks.push(
      failed(
        "executor-allowlist-compatibility",
        "Recognized AllowanceHolder is not enabled in both executor target mappings.",
      ),
    );
    return report("CONFIGURATION_ERROR", "Executor target configuration is incomplete.", checks, {
      executorAddress: executor,
      executorOwner,
      quote,
      selectedAsset,
    });
  }
  checks.push(
    passed(
      "executor-allowlist-compatibility",
      "Recognized AllowanceHolder is separately approved for execution and allowance roles.",
    ),
  );
  checks.push(passed("exact-approval", `Exact approval amount is ${quote.quotedRawSellAmount}.`));

  if (!dependencies.getReferencePrice && !dependencies.getReferencePriceSnapshot) {
    checks.push(
      failed("reference-price", "No verified production reference-price provider is configured."),
    );
    return report(
      "REFERENCE_PRICE_PROVIDER_MISSING",
      "A verified reference-price provider is required before production risk acceptance.",
      checks,
      {
        exactApprovalAmount: quote.quotedRawSellAmount,
        executorAddress: executor,
        executorOwner,
        quote,
        selectedAsset,
      },
    );
  }

  let referencePrice: AssetPrice;
  let referenceSnapshotId: Hex | undefined;
  try {
    if (dependencies.getReferencePriceSnapshot) {
      const snapshot = await dependencies.getReferencePriceSnapshot();
      const snapshotPrice = findSnapshotPrice(snapshot, selectedAsset.symbol);
      if (!snapshotPrice) throw new Error("Reference snapshot is missing the selected stock.");
      referencePrice = snapshotPrice;
      referenceSnapshotId = snapshot.snapshotId;
    } else {
      referencePrice = await dependencies.getReferencePrice!(selectedAsset);
    }
    if (
      referencePrice.asset.tokenAddress.toLowerCase() !==
        selectedAsset.tokenAddress.toLowerCase() ||
      referencePrice.asset.symbol !== selectedAsset.symbol ||
      referencePrice.price <= 0n
    ) {
      throw new Error("Reference price does not match the selected verified stock.");
    }
    checks.push(
      passed(
        "reference-price",
        `${referencePrice.source} returned a validated ${referencePrice.priceDecimals}-decimal reference.`,
      ),
    );
  } catch (error) {
    checks.push(
      failed("reference-price", error instanceof Error ? error.message : "Reference read failed."),
    );
    return report(
      "REFERENCE_PRICE_PROVIDER_FAILURE",
      "The configured production reference-price provider failed closed.",
      checks,
      {
        exactApprovalAmount: quote.quotedRawSellAmount,
        executorAddress: executor,
        executorOwner,
        quote,
        selectedAsset,
      },
    );
  }

  if (!input.riskContext) {
    checks.push(failed("risk-context", "No risk snapshot is configured for the reference price."));
    return report(
      "REFERENCE_PRICE_PROVIDER_MISSING",
      "A provider-backed portfolio and risk snapshot is required before production acceptance.",
      checks,
      {
        exactApprovalAmount: quote.quotedRawSellAmount,
        executorAddress: executor,
        executorOwner,
        quote,
        referencePrice,
        ...(referenceSnapshotId === undefined ? {} : { referenceSnapshotId }),
        selectedAsset,
      },
    );
  }

  const candidate = input.riskContext.candidate;
  if (candidate.executionQuote !== quote || !smartAccount || candidate.owner !== smartAccount) {
    checks.push(failed("risk-context", "Risk context does not bind this quote and Smart Account."));
    return report("CONFIGURATION_ERROR", "Risk context is not canonical for this check.", checks, {
      executorAddress: executor,
      executorOwner,
      quote,
      selectedAsset,
    });
  }

  if (
    referenceSnapshotId !== undefined &&
    input.riskContext.referenceSnapshotId !== referenceSnapshotId
  ) {
    checks.push(
      failed("risk-snapshot-binding", "Risk context does not bind the captured snapshot ID."),
    );
    return report(
      "CONFIGURATION_ERROR",
      "Risk context is not bound to the immutable provider snapshot.",
      checks,
      {
        executorAddress: executor,
        executorOwner,
        quote,
        referencePrice,
        referenceSnapshotId,
        selectedAsset,
      },
    );
  }
  if (referenceSnapshotId !== undefined) {
    checks.push(
      passed("risk-snapshot-binding", `Risk context binds snapshot ${referenceSnapshotId}.`),
    );
  }

  if (
    !candidate.currentBuyAssetReferencePrice ||
    candidate.currentBuyAssetReferencePrice.asset.tokenAddress.toLowerCase() !==
      referencePrice.asset.tokenAddress.toLowerCase() ||
    candidate.currentBuyAssetReferencePrice.price !== referencePrice.price ||
    candidate.currentBuyAssetReferencePrice.priceDecimals !== referencePrice.priceDecimals ||
    candidate.currentBuyAssetReferencePrice.source !== referencePrice.source
  ) {
    checks.push(
      failed("risk-reference-binding", "Risk trigger price is not the provider snapshot."),
    );
    return report(
      "CONFIGURATION_ERROR",
      "Risk context is not bound to the verified reference-price snapshot.",
      checks,
      {
        executorAddress: executor,
        executorOwner,
        quote,
        referencePrice,
        ...(referenceSnapshotId === undefined ? {} : { referenceSnapshotId }),
        selectedAsset,
      },
    );
  }
  checks.push(
    passed("risk-reference-binding", "Risk trigger price is bound to the provider snapshot."),
  );
  const economicBuyAmount = quote.quotedB20EconomicBuyAmount;
  const expectedQuotedSellReferenceValue = fixedPointReferenceValue(
    quote.quotedRawSellAmount,
    BASE_MAINNET_USDC.decimals,
    USD_REFERENCE_VALUE_SCALE,
    USD_REFERENCE_VALUE_DECIMALS,
  );
  const expectedProposedBuyReferenceValue =
    economicBuyAmount === undefined
      ? undefined
      : fixedPointReferenceValue(
          economicBuyAmount,
          selectedAsset.decimals,
          referencePrice.price,
          referencePrice.priceDecimals,
        );
  if (
    expectedProposedBuyReferenceValue === undefined ||
    candidate.executionReferenceValuation.referenceValueDecimals !== USD_REFERENCE_VALUE_DECIMALS ||
    candidate.executionReferenceValuation.quotedSellReferenceValue !==
      expectedQuotedSellReferenceValue ||
    candidate.executionReferenceValuation.proposedBuyReferenceValue !==
      expectedProposedBuyReferenceValue
  ) {
    checks.push(
      failed(
        "risk-reference-valuation",
        "Exposure valuation is not derived from the provider price and B20 economic amount.",
      ),
    );
    return report(
      "CONFIGURATION_ERROR",
      "Risk exposure values are not bound to the verified reference-price snapshot.",
      checks,
      {
        executorAddress: executor,
        executorOwner,
        quote,
        referencePrice,
        ...(referenceSnapshotId === undefined ? {} : { referenceSnapshotId }),
        selectedAsset,
      },
    );
  }
  checks.push(
    passed(
      "risk-reference-valuation",
      "Exposure valuation uses provider price, B20 economic amount, and canonical USDC reference.",
    ),
  );

  const riskResult = validateExecutionCandidate(candidate, BASE_MAINNET_ASSET_REGISTRY);
  if (riskResult.status !== "ACCEPTED") {
    checks.push(
      failed(
        "risk",
        `Risk engine rejected: ${riskResult.rejections.map((item) => item.code).join(",")}.`,
      ),
    );
    return report(
      "RISK_REJECTED",
      "Independent deterministic risk validation rejected the candidate.",
      checks,
      {
        executorAddress: executor,
        executorOwner,
        quote,
        referencePrice,
        ...(referenceSnapshotId === undefined ? {} : { referenceSnapshotId }),
        riskResult,
        selectedAsset,
      },
    );
  }
  checks.push(passed("risk", "Independent deterministic risk validation accepted the candidate."));

  try {
    const plan = buildVectorExecutionPlan({
      assetRegistry: BASE_MAINNET_ASSET_REGISTRY,
      candidate,
      currentTimestamp: input.nowSeconds,
      deadline: input.riskContext.deadline,
      nonce: input.riskContext.nonce,
      recipient: smartAccount,
      riskResult,
      smartAccountAddress: smartAccount,
      trustedConfig: {
        approvedAllowanceTargets: [allowanceTarget],
        approvedExecutionTargets: [quote.transaction.target],
        executorAddress: executor,
      },
    });
    if (
      plan.calls[0].amount !== quote.quotedRawSellAmount ||
      !sameAddress(plan.calls[0].spender, executor)
    ) {
      throw new ExecutionPlanValidationError("QUOTE_INVALID", "Exact executor approval mismatch.");
    }
    checks.push(
      passed("canonical-plan", "Canonical intent and exact two-call plan are constructible."),
    );
    return report(
      "READY",
      "The deterministic execution package is constructible and all pre-authorization checks pass.",
      checks,
      {
        exactApprovalAmount: quote.quotedRawSellAmount,
        executorAddress: executor,
        executorOwner,
        plan,
        quote,
        referencePrice,
        ...(referenceSnapshotId === undefined ? {} : { referenceSnapshotId }),
        riskResult,
        selectedAsset,
        ...(smartAccountUsdcBalance === undefined ? {} : { smartAccountUsdcBalance }),
      },
    );
  } catch (error) {
    checks.push(
      failed(
        "canonical-plan",
        error instanceof Error ? error.message : "Plan construction failed.",
      ),
    );
    return report(
      "INVALID_QUOTE",
      "Canonical intent or execution-plan construction failed.",
      checks,
      {
        executorAddress: executor,
        executorOwner,
        quote,
        referencePrice,
        ...(referenceSnapshotId === undefined ? {} : { referenceSnapshotId }),
        riskResult,
        selectedAsset,
      },
    );
  }
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  BASE_MAINNET_TOKENIZED_STOCKS,
  BASE_MAINNET_USDC,
  ZeroXError,
  type B20AssetVerificationResult,
} from "@vector/integrations";
import { createAssetPrice } from "@vector/portfolio";

import {
  AUTHORIZATION_FIXTURE,
  createAuthorizationFixtureCandidate,
  createAuthorizationFixtureQuote,
} from "./authorization-fixture.ts";
import {
  checkBaseMainnetExecutionReadiness,
  classifyZeroXReadinessError,
  type MainnetReadinessDependencies,
  type MainnetReadinessInput,
} from "./mainnet-readiness.ts";

function createFixture() {
  const quote = createAuthorizationFixtureQuote();
  const candidate = createAuthorizationFixtureCandidate(quote);
  const input = {
    chainId: 8453,
    executorAddress: AUTHORIZATION_FIXTURE.executor,
    nowSeconds: AUTHORIZATION_FIXTURE.currentTimestamp,
    riskContext: {
      candidate,
      deadline: candidate.deadline,
      nonce: AUTHORIZATION_FIXTURE.nonce,
    },
    sellAmount: quote.requestedRawSellAmount,
    slippageBps: quote.slippageBps,
    smartAccountAddress: AUTHORIZATION_FIXTURE.owner,
    stockSymbol: BASE_MAINNET_TOKENIZED_STOCKS[0].symbol,
  } as const satisfies MainnetReadinessInput;
  const dependencies: MainnetReadinessDependencies = {
    getChainId: async () => 8453,
    getCode: async () => "0x01",
    getExecutionQuote: async () => quote,
    getReferencePrice: async (asset) =>
      createAssetPrice({
        asset,
        observedAt: input.nowSeconds,
        price: candidate.currentBuyAssetReferencePrice!.price,
        priceDecimals: candidate.currentBuyAssetReferencePrice!.priceDecimals,
        source: candidate.currentBuyAssetReferencePrice!.source,
      }),
    readExecutorAllowanceTargetApproval: async () => true,
    readExecutorAssetSupport: async () => true,
    readExecutorExecutionTargetApproval: async () => true,
    readExecutorOwner: async () => AUTHORIZATION_FIXTURE.owner,
    readTokenBalance: async () => 2_000_000_000n,
    readTokenMetadata: async (token) =>
      token.toLowerCase() === BASE_MAINNET_USDC.tokenAddress.toLowerCase()
        ? { decimals: BASE_MAINNET_USDC.decimals, symbol: BASE_MAINNET_USDC.symbol }
        : {
            decimals: BASE_MAINNET_TOKENIZED_STOCKS[0].decimals,
            symbol: BASE_MAINNET_TOKENIZED_STOCKS[0].symbol,
          },
    verifyB20Asset: async (asset) =>
      ({ decimals: asset.decimals, symbol: asset.symbol }) as B20AssetVerificationResult,
  };

  return { candidate, dependencies, input, quote };
}

describe("Base Mainnet execution readiness", () => {
  it("returns READY only after building the canonical exact-approval plan", async () => {
    const { dependencies, input, quote } = createFixture();
    const result = await checkBaseMainnetExecutionReadiness(input, dependencies);

    assert.equal(result.state, "READY");
    assert.equal(result.exactApprovalAmount, quote.quotedRawSellAmount);
    assert.equal(result.plan?.calls.length, 2);
    assert.equal(result.plan?.calls[0].to, BASE_MAINNET_USDC.tokenAddress);
    assert.equal(result.plan?.calls[0].spender, AUTHORIZATION_FIXTURE.executor);
    assert.equal(result.plan?.calls[0].amount, quote.quotedRawSellAmount);
    assert.equal(result.plan?.calls[1].to, AUTHORIZATION_FIXTURE.executor);
    assert.equal(result.plan?.intent.executionTarget, quote.transaction.target);
    assert.equal(result.plan?.intent.allowanceTarget, quote.allowanceTarget);
    assert.equal(
      result.checks.find((check) => check.name === "quote-target-validation")?.status,
      "PASSED",
    );
    assert.equal(
      result.checks.find((check) => check.name === "allowance-holder-recognition")?.status,
      "PASSED",
    );
    assert.equal(
      result.checks.find((check) => check.name === "executor-allowlist-compatibility")?.status,
      "PASSED",
    );
  });

  it("reports an absent executor without requesting a quote", async () => {
    const { dependencies, input } = createFixture();
    const { executorAddress: _executorAddress, ...inputWithoutExecutor } = input;
    void _executorAddress;
    let quoteRequested = false;
    const result = await checkBaseMainnetExecutionReadiness(inputWithoutExecutor, {
      ...dependencies,
      getExecutionQuote: async () => {
        quoteRequested = true;
        throw new Error("unexpected");
      },
    });

    assert.equal(result.state, "EXECUTOR_NOT_CONFIGURED");
    assert.equal(quoteRequested, false);
  });

  it("rejects the wrong chain and stocks outside the verified registry", async () => {
    const { dependencies, input } = createFixture();
    const wrongChain = await checkBaseMainnetExecutionReadiness(
      { ...input, chainId: 84532 },
      dependencies,
    );
    const unknownStock = await checkBaseMainnetExecutionReadiness(
      { ...input, stockSymbol: "TSLAc" },
      dependencies,
    );
    const mismatchedRegistryPin = await checkBaseMainnetExecutionReadiness(
      {
        ...input,
        stockTokenAddress: BASE_MAINNET_TOKENIZED_STOCKS[1].tokenAddress,
      },
      dependencies,
    );

    assert.equal(wrongChain.state, "CONFIGURATION_ERROR");
    assert.equal(unknownStock.state, "ASSET_NOT_SUPPORTED");
    assert.equal(mismatchedRegistryPin.state, "ASSET_NOT_SUPPORTED");
  });

  it("reports insufficient optional Smart Account USDC balance", async () => {
    const { dependencies, input } = createFixture();
    const result = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      readTokenBalance: async () => input.sellAmount - 1n,
    });

    assert.equal(result.state, "INSUFFICIENT_BALANCE");
  });

  it("requires executor approval for quote-derived targets independently", async () => {
    const { dependencies, input } = createFixture();
    const executionResult = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      readExecutorExecutionTargetApproval: async () => false,
    });
    const allowanceResult = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      readExecutorAllowanceTargetApproval: async () => false,
    });

    assert.equal(executionResult.state, "CONFIGURATION_ERROR");
    assert.equal(allowanceResult.state, "CONFIGURATION_ERROR");
  });

  it("reports missing executor asset support", async () => {
    const { dependencies, input } = createFixture();
    const result = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      readExecutorAssetSupport: async (_executor, asset) =>
        asset.toLowerCase() === BASE_MAINNET_USDC.tokenAddress.toLowerCase(),
    });

    assert.equal(result.state, "ASSET_NOT_SUPPORTED");
  });

  it("does not treat a quote as a production reference price", async () => {
    const { dependencies, input } = createFixture();
    const { riskContext: _riskContext, ...inputWithoutRiskContext } = input;
    void _riskContext;
    const result = await checkBaseMainnetExecutionReadiness(inputWithoutRiskContext, dependencies);

    assert.equal(result.state, "REFERENCE_PRICE_PROVIDER_MISSING");
    assert.ok(result.quote);
    assert.equal(result.checks.find((check) => check.name === "reference-price")?.status, "PASSED");
  });

  it("fails readiness when the provider is missing or unavailable", async () => {
    const { dependencies, input } = createFixture();
    const { getReferencePrice: _getReferencePrice, ...withoutProvider } = dependencies;
    void _getReferencePrice;
    const missing = await checkBaseMainnetExecutionReadiness(input, withoutProvider);
    const unavailable = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      getReferencePrice: async () => Promise.reject(new Error("provider unavailable")),
    });

    assert.equal(missing.state, "REFERENCE_PRICE_PROVIDER_MISSING");
    assert.equal(unavailable.state, "REFERENCE_PRICE_PROVIDER_FAILURE");
  });

  it("requires risk triggers to use the provider reference rather than the execution quote", async () => {
    const { dependencies, input, quote } = createFixture();
    const result = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      getReferencePrice: async (asset) =>
        createAssetPrice({
          asset,
          observedAt: input.nowSeconds,
          price: quote.quotedRawBuyAmount,
          priceDecimals: 8,
          source: "0x",
        }),
    });

    assert.equal(result.state, "CONFIGURATION_ERROR");
    assert.equal(
      result.checks.find((check) => check.name === "risk-reference-binding")?.status,
      "FAILED",
    );
  });

  it("requires exposure values to be derived from the provider reference", async () => {
    const { candidate, dependencies, input } = createFixture();
    const result = await checkBaseMainnetExecutionReadiness(
      {
        ...input,
        riskContext: {
          ...input.riskContext,
          candidate: {
            ...candidate,
            executionReferenceValuation: {
              ...candidate.executionReferenceValuation,
              proposedBuyReferenceValue:
                candidate.executionReferenceValuation.proposedBuyReferenceValue + 1n,
            },
          },
        },
      },
      dependencies,
    );

    assert.equal(result.state, "CONFIGURATION_ERROR");
    assert.equal(
      result.checks.find((check) => check.name === "risk-reference-valuation")?.status,
      "FAILED",
    );
  });

  it("keeps the CLI free of transaction and signing capabilities", () => {
    const source = readFileSync(
      new URL("../../../services/api/verify-mainnet-readiness.ts", import.meta.url),
      "utf8",
    );

    for (const forbidden of [
      "createWalletClient",
      "sendTransaction",
      "writeContract",
      "sendUserOperation",
      "wallet_sendCalls",
      "eth_sendTransaction",
      "@coinbase/cdp",
    ]) {
      assert.equal(source.includes(forbidden), false, `CLI must not contain ${forbidden}`);
    }
    assert.match(source, /MAINNET_READINESS_COMMAND_CAPABILITY = "READ_ONLY"/);
  });

  it("returns B20 validation and deterministic risk failures distinctly", async () => {
    const { candidate, dependencies, input } = createFixture();
    const b20Result = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      verifyB20Asset: async () => {
        throw new Error("marker mismatch");
      },
    });
    const riskResult = await checkBaseMainnetExecutionReadiness(
      {
        ...input,
        riskContext: {
          ...input.riskContext,
          candidate: {
            ...candidate,
            constraints: { ...candidate.constraints, maximumSlippageBps: 0 },
          },
        },
      },
      dependencies,
    );

    assert.equal(b20Result.state, "B20_VALIDATION_FAILED");
    assert.equal(riskResult.state, "RISK_REJECTED");
  });

  it("rejects an ERC-20 quote whose execution target differs from AllowanceHolder", async () => {
    const { dependencies, input, quote } = createFixture();
    const result = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      getExecutionQuote: async () => ({
        ...quote,
        transaction: { ...quote.transaction, target: "0x0000000000000000000000000000000000000020" },
      }),
    });

    assert.equal(result.state, "INVALID_QUOTE");
    assert.match(
      result.checks.find((check) => check.name === "quote-target-validation")?.detail ?? "",
      /EXECUTION_TARGET_MISMATCH/,
    );
  });

  it("rejects invalid execution and allowance targets", async () => {
    const { dependencies, input, quote } = createFixture();
    const invalidExecutionTarget = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      getExecutionQuote: async () => ({
        ...quote,
        transaction: { ...quote.transaction, target: "0x0000000000000000000000000000000000000000" },
      }),
    });
    const invalidAllowanceTarget = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      getExecutionQuote: async () => ({
        ...quote,
        allowanceTarget: "0x0000000000000000000000000000000000000000",
      }),
    });

    assert.equal(invalidExecutionTarget.state, "INVALID_QUOTE");
    assert.equal(invalidAllowanceTarget.state, "INVALID_QUOTE");
  });

  it("rejects pair mismatches and zero quote amounts", async () => {
    const { dependencies, input, quote } = createFixture();
    const pairMismatch = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      getExecutionQuote: async () => ({ ...quote, sellAsset: quote.buyAsset }),
    });
    const zeroAmount = await checkBaseMainnetExecutionReadiness(input, {
      ...dependencies,
      getExecutionQuote: async () => ({ ...quote, quotedRawBuyAmount: 0n }),
    });

    assert.equal(pairMismatch.state, "INVALID_QUOTE");
    assert.equal(zeroAmount.state, "INVALID_QUOTE");
  });

  it("rejects an expired canonical plan deadline and marks quote expiry unavailable", async () => {
    const { dependencies, input } = createFixture();
    const result = await checkBaseMainnetExecutionReadiness(
      {
        ...input,
        riskContext: { ...input.riskContext, deadline: input.nowSeconds - 1n },
      },
      dependencies,
    );

    assert.equal(result.state, "INVALID_QUOTE");
    assert.equal(result.checks.find((check) => check.name === "quote-expiry")?.status, "SKIPPED");
  });
});

describe("0x readiness classification", () => {
  it("preserves the known 422 BStocks legal restriction", () => {
    const result = classifyZeroXReadinessError(
      new ZeroXError("TOKEN_NOT_SUPPORTED", "restricted", {
        httpStatus: 422,
        remote: { code: "BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE" },
      }),
    );

    assert.deepEqual(result, {
      restriction: "LEGAL_TOKEN_TRADE_RESTRICTION",
      state: "ACCESS_RESTRICTED",
    });
  });

  it("keeps the 403 account-access restriction distinct", () => {
    const result = classifyZeroXReadinessError(
      new ZeroXError("TOKENIZED_EQUITY_ACCESS_REQUIRED", "access required", {
        httpStatus: 403,
        remote: { code: "XSTOCKS_NOT_AUTHORIZED" },
      }),
    );

    assert.deepEqual(result, {
      restriction: "TOKENIZED_EQUITY_ACCOUNT_ACCESS_REQUIRED",
      state: "ACCESS_RESTRICTED",
    });
  });

  it("does not collapse restrictions into liquidity or generic asset failures", () => {
    assert.deepEqual(classifyZeroXReadinessError(new ZeroXError("NO_LIQUIDITY", "none")), {
      state: "QUOTE_UNAVAILABLE",
    });
    assert.deepEqual(
      classifyZeroXReadinessError(new ZeroXError("TOKEN_NOT_SUPPORTED", "unsupported")),
      { state: "ASSET_NOT_SUPPORTED" },
    );
  });
});

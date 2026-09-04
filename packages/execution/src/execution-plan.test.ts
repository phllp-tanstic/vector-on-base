import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BASE_MAINNET_TOKENIZED_STOCKS, BASE_MAINNET_USDC } from "@vector/integrations";
import { decodeFunctionData, erc20Abi, maxUint256, toFunctionSelector } from "viem";

import {
  AUTHORIZATION_FIXTURE,
  createAuthorizationFixtureCandidate,
  createAuthorizationFixtureInput,
  createAuthorizationFixtureQuote,
} from "./authorization-fixture.ts";
import {
  buildVectorExecutionPlan,
  buildVectorExecutionIntent,
  decodeVectorExecutionIntent,
  ExecutionPlanValidationError,
  hashVectorExecutionIntent,
  VECTOR_EXECUTION_INTENT_VERSION,
  VECTOR_EXECUTOR_EXECUTE_SELECTOR,
} from "./execution-plan.ts";

function hasCode(code: ExecutionPlanValidationError["code"]) {
  return (error: unknown): boolean =>
    error instanceof ExecutionPlanValidationError && error.code === code;
}

describe("Vector execution authorization plan", () => {
  it("builds the exact ordered bounded calls from an accepted candidate", () => {
    const plan = buildVectorExecutionPlan(createAuthorizationFixtureInput());

    assert.equal(plan.chainId, 8453);
    assert.equal(plan.authorizationMode, "EXPLICIT_SMART_ACCOUNT");
    assert.equal(plan.owner, plan.smartAccountAddress);
    assert.equal(plan.calls.length, 2);
    assert.equal(plan.calls[0].type, "ERC20_APPROVAL");
    assert.equal(plan.calls[0].to, BASE_MAINNET_USDC.tokenAddress);
    assert.equal(plan.calls[0].spender, AUTHORIZATION_FIXTURE.executor);
    assert.equal(plan.calls[0].amount, plan.sellAmount);
    assert.equal(plan.calls[0].value, 0n);
    assert.equal(plan.calls[1].type, "VECTOR_EXECUTION");
    assert.equal(plan.calls[1].to, AUTHORIZATION_FIXTURE.executor);
    assert.equal(plan.calls[1].value, 7n);
  });

  it("encodes exact approval and round-trips every Solidity intent field", () => {
    const plan = buildVectorExecutionPlan(createAuthorizationFixtureInput());
    const approval = decodeFunctionData({ abi: erc20Abi, data: plan.calls[0].data });
    const intent = decodeVectorExecutionIntent(plan.calls[1].data);

    assert.equal(approval.functionName, "approve");
    assert.deepEqual(approval.args, [AUTHORIZATION_FIXTURE.executor, plan.sellAmount]);
    assert.deepEqual(intent, plan.calls[1].intent);
    assert.deepEqual(intent, plan.intent);
    assert.equal(intent.version, VECTOR_EXECUTION_INTENT_VERSION);
    assert.equal(intent.chainId, 8453);
    assert.equal(intent.owner, AUTHORIZATION_FIXTURE.owner);
    assert.equal(intent.sellToken, BASE_MAINNET_USDC.tokenAddress);
    assert.equal(intent.buyToken, BASE_MAINNET_TOKENIZED_STOCKS[0].tokenAddress);
    assert.equal(intent.sellAmount, 100_000_000n);
    assert.equal(intent.minBuyAmount, 99_000_000n);
    assert.equal(intent.recipient, AUTHORIZATION_FIXTURE.recipient);
    assert.equal(intent.executionTarget, AUTHORIZATION_FIXTURE.executionTarget);
    assert.equal(intent.allowanceTarget, AUTHORIZATION_FIXTURE.allowanceTarget);
    assert.equal(intent.executionValue, 7n);
    assert.equal(intent.deadline, 1_800_000_300n);
    assert.equal(intent.nonce, 42n);
    assert.equal(intent.executionData, "0x12345678");
  });

  it("preserves explicit deadlines and nonces and hashes different nonces differently", () => {
    const input = createAuthorizationFixtureInput();
    const first = buildVectorExecutionIntent({
      ...input,
      deadline: input.deadline - 1n,
      nonce: 7n,
    });
    const second = buildVectorExecutionIntent({
      ...input,
      deadline: input.deadline - 1n,
      nonce: 8n,
    });

    assert.equal(first.deadline, input.deadline - 1n);
    assert.equal(first.nonce, 7n);
    assert.equal(second.nonce, 8n);
    assert.notEqual(
      hashVectorExecutionIntent(first, AUTHORIZATION_FIXTURE.executor),
      hashVectorExecutionIntent(second, AUTHORIZATION_FIXTURE.executor),
    );
    assert.throws(
      () => buildVectorExecutionIntent({ ...input, deadline: input.candidate.deadline + 1n }),
      hasCode("DEADLINE_INVALID"),
    );
  });

  it("uses the firm quote raw minimum exactly without applying slippage twice", () => {
    const input = createAuthorizationFixtureInput();
    const exactQuote = {
      ...createAuthorizationFixtureQuote(),
      minBuyAmount: createAuthorizationFixtureQuote().quotedRawBuyAmount,
    };
    const boundaryInput = {
      ...input,
      candidate: createAuthorizationFixtureCandidate(exactQuote),
    };

    assert.equal(buildVectorExecutionIntent(boundaryInput).minBuyAmount, exactQuote.minBuyAmount);
    assert.throws(
      () =>
        buildVectorExecutionIntent({
          ...input,
          candidate: createAuthorizationFixtureCandidate({
            ...exactQuote,
            minBuyAmount: exactQuote.quotedRawBuyAmount + 1n,
          }),
        }),
      hasCode("QUOTE_INVALID"),
    );
  });

  it("uses the selector asserted independently by the Solidity suite", () => {
    assert.equal(planSelector(), VECTOR_EXECUTOR_EXECUTE_SELECTOR);
    assert.equal(
      toFunctionSelector(
        "execute((address,address,address,uint256,uint256,address,address,address,uint256,uint256,uint256,bytes))",
      ),
      VECTOR_EXECUTOR_EXECUTE_SELECTOR,
    );
  });

  it("requires accepted risk and the owner Smart Account itself", () => {
    const input = createAuthorizationFixtureInput();
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          riskResult: { checks: [], nextState: null, rejections: [], status: "REJECTED" },
        }),
      hasCode("RISK_NOT_ACCEPTED"),
    );
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          smartAccountAddress: "0x0000000000000000000000000000000000000003",
        }),
      hasCode("OWNER_MISMATCH"),
    );
  });

  it("rejects unsupported chains and missing or zero executor configuration", () => {
    const input = createAuthorizationFixtureInput();
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          candidate: { ...input.candidate, chainId: 1 },
        }),
      hasCode("WRONG_CHAIN"),
    );
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          trustedConfig: { ...input.trustedConfig, executorAddress: undefined },
        }),
      hasCode("EXECUTOR_MISSING"),
    );
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          trustedConfig: {
            ...input.trustedConfig,
            executorAddress: "0x0000000000000000000000000000000000000000",
          },
        }),
      hasCode("ADDRESS_INVALID"),
    );
  });

  it("rejects unsupported sell and buy assets", () => {
    const input = createAuthorizationFixtureInput();
    const fakeUsdc = {
      ...BASE_MAINNET_USDC,
      tokenAddress: "0x0000000000000000000000000000000000000040",
    } as const;
    const fakeBuy = {
      ...BASE_MAINNET_TOKENIZED_STOCKS[0],
      tokenAddress: "0xb20000000000000000000078ee7ce2fE4908108D",
    } as const;

    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          candidate: {
            ...input.candidate,
            executionQuote: { ...input.candidate.executionQuote, sellAsset: fakeUsdc },
            sellAsset: fakeUsdc,
          },
        }),
      hasCode("ASSET_UNSUPPORTED"),
    );
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          candidate: {
            ...input.candidate,
            buyAsset: fakeBuy,
            executionQuote: { ...input.candidate.executionQuote, buyAsset: fakeBuy },
          },
        }),
      hasCode("ASSET_UNSUPPORTED"),
    );
  });

  it("requires separately approved execution and allowance targets", () => {
    const input = createAuthorizationFixtureInput();
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          trustedConfig: { ...input.trustedConfig, approvedExecutionTargets: [] },
        }),
      hasCode("EXECUTION_TARGET_UNAPPROVED"),
    );
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          trustedConfig: { ...input.trustedConfig, approvedAllowanceTargets: [] },
        }),
      hasCode("ALLOWANCE_TARGET_UNAPPROVED"),
    );
  });

  it("rejects expiry, malformed calldata, zero bounds, and excessive quote sell amount", () => {
    const input = createAuthorizationFixtureInput();
    assert.throws(
      () => buildVectorExecutionPlan({ ...input, currentTimestamp: input.candidate.deadline + 1n }),
      hasCode("CANDIDATE_EXPIRED"),
    );
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          candidate: {
            ...input.candidate,
            executionQuote: {
              ...input.candidate.executionQuote,
              transaction: { ...input.candidate.executionQuote.transaction, data: "0x123" },
            },
          },
        }),
      hasCode("INVALID_CALLDATA"),
    );
    for (const quote of [
      { ...createAuthorizationFixtureQuote(), quotedRawSellAmount: 0n },
      { ...createAuthorizationFixtureQuote(), minBuyAmount: 0n },
    ]) {
      assert.throws(
        () =>
          buildVectorExecutionPlan({
            ...input,
            candidate: createAuthorizationFixtureCandidate(quote),
          }),
        hasCode("INVALID_AMOUNT"),
      );
    }
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          candidate: createAuthorizationFixtureCandidate({
            ...createAuthorizationFixtureQuote(),
            quotedRawSellAmount: 100_000_001n,
          }),
        }),
      hasCode("QUOTE_INVALID"),
    );
  });

  it("rejects quote/candidate token mismatches", () => {
    const input = createAuthorizationFixtureInput();
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          candidate: {
            ...input.candidate,
            executionQuote: {
              ...input.candidate.executionQuote,
              buyAsset: BASE_MAINNET_TOKENIZED_STOCKS[1],
            },
          },
        }),
      hasCode("QUOTE_INVALID"),
    );
    assert.throws(
      () =>
        buildVectorExecutionPlan({
          ...input,
          candidate: {
            ...input.candidate,
            executionQuote: {
              ...input.candidate.executionQuote,
              taker: "0x0000000000000000000000000000000000000003",
            },
          },
        }),
      hasCode("QUOTE_INVALID"),
    );
  });

  it("cannot produce unlimited approval, a 0x approval spender, reversed order, or a third call", () => {
    const plan = buildVectorExecutionPlan(createAuthorizationFixtureInput());

    assert.notEqual(plan.calls[0].amount, maxUint256);
    assert.equal(plan.calls[0].spender, plan.executor);
    assert.notEqual(plan.calls[0].spender.toLowerCase(), plan.allowanceTarget.toLowerCase());
    assert.deepEqual(
      plan.calls.map((call) => call.type),
      ["ERC20_APPROVAL", "VECTOR_EXECUTION"],
    );
    assert.throws(() =>
      (plan.calls as unknown as Array<unknown>).push({ to: plan.executor, data: "0x", value: 0n }),
    );
    assert.throws(() => (plan.calls as unknown as Array<unknown>).reverse());
  });
});

function planSelector(): string {
  return buildVectorExecutionPlan(createAuthorizationFixtureInput()).calls[1].data.slice(0, 10);
}

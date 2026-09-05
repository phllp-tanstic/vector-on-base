import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";

import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_NETWORK } from "./authorization.ts";
import {
  BASE_SEPOLIA_TEST_FIXTURES,
  TEST_SWAP_DEADLINE_SECONDS,
  TEST_SWAP_MIN_BUY_AMOUNT,
  TEST_SWAP_SELL_AMOUNT,
  buildBaseSepoliaTestSwapRequest,
  canSubmitBaseSepoliaTestSwap,
  decodeTestSwapCalls,
  prepareBaseSepoliaTestSwap,
  testSwapErrorMessage,
} from "./base-sepolia-test-swap.ts";

const SMART_ACCOUNT = "0x3fd51cbaee627ba30b0b45ec3a522885c3c956bf" as const;

function prepare(nowSeconds = 2_000_000_000n, nonce = 42n) {
  const plan = prepareBaseSepoliaTestSwap({
    explicitUserAction: true,
    smartAccountAddress: SMART_ACCOUNT,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    nowSeconds,
    createNonce: () => nonce,
  });
  assert.ok(plan);
  return plan;
}

describe("Base Sepolia browser test-swap fixture", () => {
  it("pins each fixture role to its authoritative deployed address", () => {
    assert.deepEqual(BASE_SEPOLIA_TEST_FIXTURES, {
      executor: "0x6F638384B3d750F902CE74Fd98a8536C3D8b8EdE",
      mockUsdc: "0x1e3AEfb7A9220a50ff2655f6d912cEa70993B3a9",
      mockB20LikeToken: "0x7d8D51976eB74A7949116732521e48B08d0c92Fd",
      router: "0x6Bb43afccc1fd9d8864Db2604A9b27117716EcAB",
    });
    assert.notEqual(
      BASE_SEPOLIA_TEST_FIXTURES.mockUsdc,
      BASE_SEPOLIA_TEST_FIXTURES.mockB20LikeToken,
    );
  });

  it("matches the deployed router sellToken and buyToken roles", () => {
    const plan = prepare();
    assert.equal(
      plan.intent.sellToken,
      "0x1e3AEfb7A9220a50ff2655f6d912cEa70993B3a9",
    );
    assert.equal(
      plan.intent.buyToken,
      "0x7d8D51976eB74A7949116732521e48B08d0c92Fd",
    );
  });

  it("constructs nothing until an explicit prepare action", () => {
    assert.equal(
      prepareBaseSepoliaTestSwap({
        explicitUserAction: false,
        smartAccountAddress: SMART_ACCOUNT,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        createNonce: () => {
          assert.fail("nonce generation must not run without user action");
        },
      }),
      null,
    );
  });

  it("is restricted to the Base Sepolia chain and CDP network", () => {
    assert.throws(
      () =>
        prepareBaseSepoliaTestSwap({
          explicitUserAction: true,
          smartAccountAddress: SMART_ACCOUNT,
          chainId: 8_453,
        }),
      /restricted to Base Sepolia \(84532\)/,
    );
    const plan = prepare();
    assert.equal(plan.chainId, 84_532);
    assert.equal(plan.network, "base-sepolia");
    assert.equal(BASE_SEPOLIA_NETWORK, "base-sepolia");
  });

  it("encodes the exact ordered approval and executor calls", () => {
    const plan = prepare();
    const decoded = decodeTestSwapCalls(plan);

    assert.equal(plan.calls.length, 2);
    assert.deepEqual(
      plan.calls.map((call) => call.to),
      [BASE_SEPOLIA_TEST_FIXTURES.mockUsdc, BASE_SEPOLIA_TEST_FIXTURES.executor],
    );
    assert.deepEqual(
      plan.calls.map((call) => call.value),
      [0n, 0n],
    );
    assert.equal(decoded.approval.functionName, "approve");
    assert.deepEqual(decoded.approval.args, [
      BASE_SEPOLIA_TEST_FIXTURES.executor,
      TEST_SWAP_SELL_AMOUNT,
    ]);
    assert.equal(decoded.execution.functionName, "execute");
  });

  it("encodes every ExecutionIntent field and executor-first router settlement", () => {
    const plan = prepare(2_000_000_000n, 777n);
    const decoded = decodeTestSwapCalls(plan);
    const intent = decoded.execution.args[0];
    assert.equal(plan.intent.owner, SMART_ACCOUNT);
    assert.equal(plan.intent.recipient, SMART_ACCOUNT);

    assert.deepEqual(intent, {
      owner: getAddress(SMART_ACCOUNT),
      sellToken: BASE_SEPOLIA_TEST_FIXTURES.mockUsdc,
      buyToken: BASE_SEPOLIA_TEST_FIXTURES.mockB20LikeToken,
      sellAmount: TEST_SWAP_SELL_AMOUNT,
      minBuyAmount: TEST_SWAP_MIN_BUY_AMOUNT,
      recipient: getAddress(SMART_ACCOUNT),
      executionTarget: BASE_SEPOLIA_TEST_FIXTURES.router,
      allowanceTarget: BASE_SEPOLIA_TEST_FIXTURES.router,
      callValue: 0n,
      deadline: 2_000_000_000n + TEST_SWAP_DEADLINE_SECONDS,
      nonce: 777n,
      executionData: plan.intent.executionData,
    });
    assert.equal(decoded.router.functionName, "executeSwap");
    assert.deepEqual(decoded.router.args, [
      BASE_SEPOLIA_TEST_FIXTURES.executor,
      BASE_SEPOLIA_TEST_FIXTURES.executor,
      TEST_SWAP_SELL_AMOUNT,
    ]);
  });

  it("creates a fresh nonce and deadline each time the user prepares", () => {
    let nextNonce = 10n;
    const first = prepareBaseSepoliaTestSwap({
      explicitUserAction: true,
      smartAccountAddress: SMART_ACCOUNT,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      nowSeconds: 100n,
      createNonce: () => nextNonce++,
    });
    const second = prepareBaseSepoliaTestSwap({
      explicitUserAction: true,
      smartAccountAddress: SMART_ACCOUNT,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      nowSeconds: 101n,
      createNonce: () => nextNonce++,
    });
    assert.ok(first && second);
    assert.notEqual(first.intent.nonce, second.intent.nonce);
    assert.equal(first.intent.deadline, 100n + TEST_SWAP_DEADLINE_SECONDS);
    assert.equal(second.intent.deadline, 101n + TEST_SWAP_DEADLINE_SECONDS);
  });

  it("constructs the atomic CDP request only from a second explicit action", () => {
    const plan = prepare();
    const resolvedCoinbaseSmartAccount = {
      address: SMART_ACCOUNT,
      ownerAddresses: ["0x0000000000000000000000000000000000000001"],
      createdAt: "2026-09-05T00:00:00.000Z",
    };
    assert.equal(buildBaseSepoliaTestSwapRequest(false, resolvedCoinbaseSmartAccount, plan), null);
    assert.deepEqual(buildBaseSepoliaTestSwapRequest(true, resolvedCoinbaseSmartAccount, plan), {
      evmSmartAccount: SMART_ACCOUNT,
      network: "base-sepolia",
      calls: [...plan.calls],
    });
    assert.throws(
      () =>
        buildBaseSepoliaTestSwapRequest(
          true,
          {
            ...resolvedCoinbaseSmartAccount,
            address: "0x1234567890abcdef1234567890abcdef12345678",
          },
          plan,
        ),
      /owner no longer matches/,
    );
  });

  it("disables submission without an account, while pending, when expired, or underfunded", () => {
    const plan = prepare(1_000n);
    assert.equal(canSubmitBaseSepoliaTestSwap(undefined, false, plan, 1_001n, 10_000_000n), false);
    assert.equal(
      canSubmitBaseSepoliaTestSwap(SMART_ACCOUNT, true, plan, 1_001n, 10_000_000n),
      false,
    );
    assert.equal(
      canSubmitBaseSepoliaTestSwap(SMART_ACCOUNT, false, plan, plan.intent.deadline, 10_000_000n),
      false,
    );
    assert.equal(
      canSubmitBaseSepoliaTestSwap(SMART_ACCOUNT, false, plan, 1_001n, TEST_SWAP_SELL_AMOUNT - 1n),
      false,
    );
    assert.equal(
      canSubmitBaseSepoliaTestSwap(SMART_ACCOUNT, false, plan, 1_001n, TEST_SWAP_SELL_AMOUNT),
      true,
    );
  });

  it("distinguishes wallet rejection from simulation or submission failures", () => {
    assert.equal(
      testSwapErrorMessage(new Error("User rejected request (4001)")),
      "Authorization was rejected in the wallet. Nothing was submitted.",
    );
    assert.equal(
      testSwapErrorMessage(new Error("simulation reverted")),
      "Test swap simulation or submission failed: simulation reverted",
    );
  });
});

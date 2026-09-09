import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VECTOR_BUILDER_DATA_SUFFIX } from "@vector/shared";
import { decodeFunctionData } from "viem";

import { BASE_SEPOLIA_CHAIN_ID } from "./authorization.ts";
import {
  BASE_SEPOLIA_DEMO_FAUCET_ABI,
  CONFIRMED_DEMO_CLAIM_EFFECTS,
  DEMO_FAUCET_ADDRESS_ENV_VAR,
  DEMO_FAUCET_CLAIM_AMOUNT,
  DEMO_FAUCET_MINIMUM_EXECUTION_BALANCE,
  buildDemoFaucetClaimRequest,
  deriveDemoFaucetEligibility,
  formatDemoFaucetCooldown,
  loadDemoFaucetConfig,
  prepareDemoFaucetClaim,
  shouldPromoteDemoFaucet,
} from "./base-sepolia-demo-faucet.ts";
import { BASE_SEPOLIA_TEST_FIXTURES } from "./base-sepolia-test-swap.ts";

const SMART_ACCOUNT = "0x3fd51cbaee627ba30b0b45ec3a522885c3c956bf" as const;
const FAUCET = "0x1234567890abcdef1234567890abcdef12345678" as const;

function eligibility(overrides: Partial<Parameters<typeof deriveDemoFaucetEligibility>[0]> = {}) {
  return deriveDemoFaucetEligibility({
    authenticated: true,
    smartAccountAddress: SMART_ACCOUNT,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    faucetAddress: FAUCET,
    bytecodeValid: true,
    inventory: DEMO_FAUCET_CLAIM_AMOUNT,
    lastClaimAt: 0n,
    nowSeconds: 2_000_000_000n,
    ...overrides,
  });
}

describe("Base Sepolia demo faucet browser boundary", () => {
  it("parses only an optional browser-safe non-zero address", () => {
    assert.deepEqual(loadDemoFaucetConfig({}), { faucetAddress: undefined });
    assert.equal(
      loadDemoFaucetConfig({ [DEMO_FAUCET_ADDRESS_ENV_VAR]: FAUCET }).faucetAddress,
      "0x1234567890AbcdEF1234567890aBcdef12345678",
    );
    assert.throws(
      () =>
        loadDemoFaucetConfig({
          [DEMO_FAUCET_ADDRESS_ENV_VAR]: "0x0000000000000000000000000000000000000000",
        }),
      /valid non-zero Base Sepolia contract address/,
    );
    assert.match(DEMO_FAUCET_ADDRESS_ENV_VAR, /^NEXT_PUBLIC_/);
    assert.doesNotMatch(DEMO_FAUCET_ADDRESS_ENV_VAR, /KEY|SECRET|SIGNER|KEYSTORE/);
  });

  it("promotes the CTA below 1 mUSDC without blocking funded execution", () => {
    assert.equal(shouldPromoteDemoFaucet(0n), true);
    assert.equal(shouldPromoteDemoFaucet(DEMO_FAUCET_MINIMUM_EXECUTION_BALANCE - 1n), true);
    assert.equal(shouldPromoteDemoFaucet(DEMO_FAUCET_MINIMUM_EXECUTION_BALANCE), false);
    assert.equal(shouldPromoteDemoFaucet(10_000_000n), false);
  });

  it("disables claims when unauthenticated, on the wrong chain, or missing config", () => {
    assert.deepEqual(eligibility({ authenticated: false }), { state: "IDLE", canClaim: false });
    assert.deepEqual(eligibility({ chainId: 8_453 }), { state: "FAILED", canClaim: false });
    assert.deepEqual(eligibility({ faucetAddress: undefined }), {
      state: "FAILED",
      canClaim: false,
    });
  });

  it("represents checking, invalid bytecode, cooldown, empty, and eligible states", () => {
    assert.equal(eligibility({ checking: true }).state, "CHECKING");
    assert.equal(eligibility({ bytecodeValid: false }).state, "FAILED");
    assert.equal(eligibility({ inventory: DEMO_FAUCET_CLAIM_AMOUNT - 1n }).state, "EMPTY");
    assert.deepEqual(eligibility({ lastClaimAt: 1_999_999_000n }), {
      state: "COOLDOWN",
      canClaim: false,
      availableAt: 2_000_085_400n,
    });
    assert.deepEqual(eligibility(), { state: "ELIGIBLE", canClaim: true });
    assert.equal(formatDemoFaucetCooldown(61n, 0n), "0h 2m");
    assert.equal(formatDemoFaucetCooldown(61n * 60n, 0n), "1h 1m");
  });

  it("constructs no claim without a click and otherwise encodes one zero-value claim() call", () => {
    assert.equal(
      prepareDemoFaucetClaim({
        explicitUserAction: false,
        authenticated: true,
        smartAccountAddress: SMART_ACCOUNT,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        faucetAddress: FAUCET,
        eligible: true,
      }),
      null,
    );
    const plan = prepareDemoFaucetClaim({
      explicitUserAction: true,
      authenticated: true,
      smartAccountAddress: SMART_ACCOUNT,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      faucetAddress: FAUCET,
      eligible: true,
    });
    assert.ok(plan);
    assert.equal(plan.calls.length, 1);
    assert.equal(plan.calls[0].to, FAUCET);
    assert.equal(plan.calls[0].value, 0n);
    const decoded = decodeFunctionData({
      abi: BASE_SEPOLIA_DEMO_FAUCET_ABI,
      data: plan.calls[0].data,
    });
    assert.equal(decoded.functionName, "claim");
    assert.equal(decoded.args, undefined);
  });

  it("submits from the same Coinbase Smart Account as a separate explicit request", () => {
    const plan = prepareDemoFaucetClaim({
      explicitUserAction: true,
      authenticated: true,
      smartAccountAddress: SMART_ACCOUNT,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      faucetAddress: FAUCET,
      eligible: true,
    });
    assert.ok(plan);
    assert.equal(buildDemoFaucetClaimRequest(false, { address: SMART_ACCOUNT }, plan), null);
    assert.deepEqual(buildDemoFaucetClaimRequest(true, { address: SMART_ACCOUNT }, plan), {
      evmSmartAccount: SMART_ACCOUNT,
      network: "base-sepolia",
      calls: [...plan.calls],
      dataSuffix: VECTOR_BUILDER_DATA_SUFFIX,
    });
  });

  it("refreshes balance after confirmation but never prepares execution", () => {
    assert.deepEqual(CONFIRMED_DEMO_CLAIM_EFFECTS, {
      refreshMusdcBalance: true,
      prepareExecution: false,
    });
  });

  it("keeps the faucet outside the pinned execution fixtures and production config", () => {
    assert.equal("faucet" in BASE_SEPOLIA_TEST_FIXTURES, false);
    assert.equal("demoFaucet" in BASE_SEPOLIA_TEST_FIXTURES, false);
    assert.equal(DEMO_FAUCET_CLAIM_AMOUNT, 10_000_000n);
  });
});

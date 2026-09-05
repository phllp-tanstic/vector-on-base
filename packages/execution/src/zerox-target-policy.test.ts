import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BASE_MAINNET_ZEROX_CONTRACTS,
  ZEROX_CONTRACT_MANIFEST_VERSION,
  type ZeroXContractManifest,
} from "@vector/integrations";

import { createAuthorizationFixtureQuote } from "./authorization-fixture.ts";
import {
  validateZeroXAllowanceHolderTargets,
  ZeroXTargetValidationError,
  type ZeroXTargetRejectionReason,
} from "./zerox-target-policy.ts";

function hasCode(code: ZeroXTargetRejectionReason) {
  return (error: unknown) => error instanceof ZeroXTargetValidationError && error.code === code;
}

describe("0x AllowanceHolder target policy", () => {
  it("recognizes the reviewed Base AllowanceHolder for both semantic roles", () => {
    const quote = createAuthorizationFixtureQuote();
    const result = validateZeroXAllowanceHolderTargets(quote);

    assert.equal(result.allowanceHolder, quote.allowanceTarget);
    assert.equal(result.executionTarget, quote.transaction.target);
    assert.equal(result.manifestVersion, ZEROX_CONTRACT_MANIFEST_VERSION);
  });

  it("returns typed reasons for unknown, zero, and malformed quote targets", () => {
    const quote = createAuthorizationFixtureQuote();
    assert.throws(
      () =>
        validateZeroXAllowanceHolderTargets({
          ...quote,
          allowanceTarget: "0x0000000000000000000000000000000000000020",
        }),
      hasCode("UNKNOWN_ALLOWANCE_HOLDER"),
    );
    assert.throws(
      () =>
        validateZeroXAllowanceHolderTargets({
          ...quote,
          allowanceTarget: "0x0000000000000000000000000000000000000000",
        }),
      hasCode("ZERO_TARGET"),
    );
    assert.throws(
      () =>
        validateZeroXAllowanceHolderTargets({
          ...quote,
          transaction: { ...quote.transaction, target: "not-an-address" as `0x${string}` },
        }),
      hasCode("UNSAFE_QUOTE_TARGET"),
    );
  });

  it("rejects mismatched allowance and execution fields independently", () => {
    const quote = createAuthorizationFixtureQuote();
    assert.throws(
      () =>
        validateZeroXAllowanceHolderTargets({
          ...quote,
          issues: {
            ...quote.issues,
            allowance: { actual: 0n, spender: "0x0000000000000000000000000000000000000020" },
          },
        }),
      hasCode("ALLOWANCE_TARGET_MISMATCH"),
    );
    assert.throws(
      () =>
        validateZeroXAllowanceHolderTargets({
          ...quote,
          transaction: {
            ...quote.transaction,
            target: "0x0000000000000000000000000000000000000020",
          },
        }),
      hasCode("EXECUTION_TARGET_MISMATCH"),
    );
  });

  it("never permits a configured Settler in the allowance role", () => {
    const quote = createAuthorizationFixtureQuote();
    const settlerAddress = "0x0000000000000000000000000000000000000020" as const;
    const manifest = {
      chainId: BASE_MAINNET_ZEROX_CONTRACTS.chainId,
      contracts: [
        {
          address: settlerAddress,
          deployment: "TEST_ONLY",
          provenance: "fixture",
          role: "SETTLER",
        },
      ],
      version: ZEROX_CONTRACT_MANIFEST_VERSION,
    } as const satisfies ZeroXContractManifest;

    assert.throws(
      () =>
        validateZeroXAllowanceHolderTargets(
          {
            ...quote,
            allowanceTarget: settlerAddress,
            issues: { ...quote.issues, allowance: { actual: 0n, spender: settlerAddress } },
            transaction: { ...quote.transaction, target: settlerAddress },
          },
          manifest,
        ),
      hasCode("SETTLER_AS_ALLOWANCE_TARGET"),
    );
  });
});

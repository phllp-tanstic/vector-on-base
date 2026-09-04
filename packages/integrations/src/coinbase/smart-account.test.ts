import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildVectorExecutionPlan, type VectorExecutionPlan } from "@vector/execution";

import { createAuthorizationFixtureInput } from "../../../execution/src/authorization-fixture.ts";
import {
  buildSmartAccountCalls,
  CDP_BASE_MAINNET_NETWORK,
  sendSmartAccountExecution,
  SmartAccountAuthorizationError,
  type CdpUserOperationRequest,
} from "./smart-account.ts";

function plan(): VectorExecutionPlan {
  return buildVectorExecutionPlan(createAuthorizationFixtureInput());
}

describe("Coinbase user-controlled Smart Account boundary", () => {
  it("builds the documented ordered EncodedCall array", () => {
    const executionPlan = plan();
    const calls = buildSmartAccountCalls(executionPlan);

    assert.equal(CDP_BASE_MAINNET_NETWORK, "base");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], {
      data: executionPlan.calls[0].data,
      to: executionPlan.sellAsset.tokenAddress,
      value: 0n,
    });
    assert.deepEqual(calls[1], {
      data: executionPlan.calls[1].data,
      to: executionPlan.executor,
      value: executionPlan.executionValue,
    });
  });

  it("passes exactly Base, the plan owner, and two calls to an injected CDP hook boundary", async () => {
    const requests: CdpUserOperationRequest[] = [];
    const executionPlan = plan();
    const result = await sendSmartAccountExecution(
      executionPlan,
      {
        async sendUserOperation(request) {
          requests.push(request);
          return { userOperationHash: `0x${"ab".repeat(32)}` };
        },
      },
      { submissionEnabled: true },
    );

    assert.equal(result.userOperationHash, `0x${"ab".repeat(32)}`);
    assert.deepEqual(requests, [
      {
        calls: buildSmartAccountCalls(executionPlan),
        evmSmartAccount: executionPlan.owner,
        network: "base",
      },
    ]);
  });

  it("does not submit by default and does not add automatic sponsorship", async () => {
    let called = false;
    await assert.rejects(
      sendSmartAccountExecution(plan(), {
        async sendUserOperation() {
          called = true;
          return { userOperationHash: "0x00" };
        },
      }),
      (error: unknown) =>
        error instanceof SmartAccountAuthorizationError && error.code === "SUBMISSION_DISABLED",
    );
    assert.equal(called, false);
  });

  it("rejects owner replacement, reversed calls, and injected third calls", () => {
    const executionPlan = plan();
    const replacedOwner = {
      ...executionPlan,
      smartAccountAddress: "0x0000000000000000000000000000000000000003",
    } as const;
    assert.throws(
      () => buildSmartAccountCalls(replacedOwner),
      (error: unknown) =>
        error instanceof SmartAccountAuthorizationError && error.code === "OWNER_MISMATCH",
    );

    const reversed = {
      ...executionPlan,
      calls: [executionPlan.calls[1], executionPlan.calls[0]],
    } as unknown as VectorExecutionPlan;
    assert.throws(() => buildSmartAccountCalls(reversed));

    const injected = {
      ...executionPlan,
      calls: [...executionPlan.calls, executionPlan.calls[1]],
    } as unknown as VectorExecutionPlan;
    assert.throws(() => buildSmartAccountCalls(injected));
  });
});

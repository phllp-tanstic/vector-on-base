import assert from "node:assert/strict";

import { buildVectorExecutionPlan } from "@vector/execution";
import { buildSmartAccountCalls } from "@vector/integrations";

import {
  AUTHORIZATION_FIXTURE,
  createAuthorizationFixtureInput,
} from "../../packages/execution/src/authorization-fixture.ts";

const plan = buildVectorExecutionPlan(createAuthorizationFixtureInput());
const cdpCalls = buildSmartAccountCalls(plan);

assert.equal(plan.chainId, 8453);
assert.equal(plan.owner, plan.smartAccountAddress);
assert.equal(plan.calls.length, 2);
assert.equal(cdpCalls.length, 2);
assert.equal(plan.calls[0].type, "ERC20_APPROVAL");
assert.equal(plan.calls[0].spender, plan.executor);
assert.equal(plan.calls[0].amount, plan.sellAmount);
assert.equal(plan.calls[1].type, "VECTOR_EXECUTION");
assert.equal(plan.calls[1].to, plan.executor);

console.log("Vector authorization-plan verification passed");
console.log("fixtureAddresses=true");
console.log(`chainId=${plan.chainId}`);
console.log(`owner=${plan.owner} (FIXTURE Smart Account)`);
console.log(`executor=${AUTHORIZATION_FIXTURE.executor} (FIXTURE VectorExecutor)`);
console.log(`authorizationMode=${plan.authorizationMode}`);
console.log(`calls=${plan.calls.length}`);
console.log("");
console.log(`call[0].type=${plan.calls[0].type}`);
console.log(`call[0].token=${plan.sellAsset.symbol}`);
console.log(`call[0].spender=${plan.calls[0].spender}`);
console.log(`call[0].amount=${plan.calls[0].amount}`);
console.log("");
console.log(`call[1].type=${plan.calls[1].type}`);
console.log(`call[1].target=${plan.calls[1].to}`);
console.log(`call[1].nonce=${plan.nonce}`);
console.log(`call[1].deadline=${plan.deadline}`);
console.log(`call[1].sellAmount=${plan.sellAmount}`);
console.log(`call[1].minBuyAmount=${plan.minBuyAmount}`);
console.log("");
console.log("readyForAuthorization=true");
console.log("transactionSubmitted=false");

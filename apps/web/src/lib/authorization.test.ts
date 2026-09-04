import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_NETWORK,
  SAFE_AUTHORIZATION_CALL,
  asEvmAddress,
  buildSafeAuthorizationRequest,
  canTestAuthorization,
  formatSmartAccountAddress,
  readPublicCdpConfig,
} from "./authorization.ts";

const SMART_ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";

describe("browser authorization logic", () => {
  it("selects Base Sepolia", () => {
    assert.equal(BASE_SEPOLIA_NETWORK, "base-sepolia");
    assert.equal(BASE_SEPOLIA_CHAIN_ID, 84_532);
  });

  it("rejects missing public CDP configuration", () => {
    assert.deepEqual(readPublicCdpConfig(undefined), {
      ok: false,
      error: "NEXT_PUBLIC_CDP_PROJECT_ID is missing.",
    });
    assert.equal(readPublicCdpConfig("  ").ok, false);
  });

  it("normalizes valid public CDP configuration", () => {
    assert.deepEqual(readPublicCdpConfig(" project-id "), {
      ok: true,
      projectId: "project-id",
    });
  });

  it("formats the Smart Account address without changing its identity", () => {
    assert.equal(formatSmartAccountAddress(SMART_ACCOUNT), "0x123456…345678");
    assert.equal(formatSmartAccountAddress(undefined), "Not created");
  });

  it("accepts only a complete EVM address for account operations", () => {
    assert.equal(asEvmAddress(SMART_ACCOUNT), SMART_ACCOUNT);
    assert.equal(asEvmAddress("0x1234"), undefined);
  });

  it("keeps authorization disabled before authentication and account retrieval", () => {
    assert.equal(canTestAuthorization(false, SMART_ACCOUNT, "idle"), false);
    assert.equal(canTestAuthorization(true, undefined, "idle"), false);
    assert.equal(canTestAuthorization(true, SMART_ACCOUNT, "pending"), false);
    assert.equal(canTestAuthorization(true, SMART_ACCOUNT, "idle"), true);
  });

  it("defines only a harmless zero-value call and never submits it automatically", () => {
    assert.deepEqual(SAFE_AUTHORIZATION_CALL, {
      to: "0x0000000000000000000000000000000000000000",
      value: 0n,
      data: "0x",
    });
    assert.equal(Object.keys(SAFE_AUTHORIZATION_CALL).includes("execute"), false);
    assert.equal(buildSafeAuthorizationRequest(false, SMART_ACCOUNT), null);
    assert.deepEqual(buildSafeAuthorizationRequest(true, SMART_ACCOUNT), {
      evmSmartAccount: SMART_ACCOUNT,
      network: "base-sepolia",
      calls: [SAFE_AUTHORIZATION_CALL],
    });
  });
});

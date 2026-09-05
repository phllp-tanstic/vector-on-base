import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_DEMO_THESIS,
  DEMO_PORTFOLIO,
  PRODUCTION_READINESS,
  TESTNET_EXECUTION_DISCLOSURE,
  acceptRiskResult,
  canAuthorizeThesis,
  editThesisParameters,
  evaluateThesisRisk,
  interpretDemoThesis,
  isDemoAssetAllowedInProduction,
  prepareThesisExecution,
  readinessCanDisplayReady,
} from "./executable-thesis.ts";

const NOW = new Date("2026-09-02T12:00:00.000Z");

describe("Executable Thesis demo flow", () => {
  it("maps thesis input into a structured, typed thesis", () => {
    const thesis = interpretDemoThesis(DEFAULT_DEMO_THESIS, NOW);
    assert.equal(thesis.intent.asset, "NVDA");
    assert.equal(thesis.parameters.entryPriceUsd, 170);
    assert.equal(thesis.parameters.maxExposurePercent, 10);
    assert.equal(thesis.parameters.reserveUsd, 1_000);
    assert.equal(thesis.parameters.maxSlippagePercent, 1);
    assert.equal(thesis.status, "INTERPRETED");
  });

  it("invalidates a prepared execution whenever a deterministic field changes", () => {
    const accepted = acceptRiskResult(
      interpretDemoThesis(DEFAULT_DEMO_THESIS, NOW),
      evaluateThesisRisk(interpretDemoThesis(DEFAULT_DEMO_THESIS, NOW), DEMO_PORTFOLIO, NOW),
    );
    const plan = prepareThesisExecution(accepted, true);
    assert.ok(plan);
    const edited = editThesisParameters(accepted, { maxSlippagePercent: 0.5 });
    assert.equal(canAuthorizeThesis(edited, plan), false);
    assert.equal(edited.status, "INTERPRETED");
  });

  it("adjusts requested size to preserve the deterministic USDC reserve", () => {
    const result = evaluateThesisRisk(
      interpretDemoThesis(DEFAULT_DEMO_THESIS, NOW),
      DEMO_PORTFOLIO,
      NOW,
    );
    assert.equal(result.state, "ADJUSTED");
    assert.equal(result.executableSizeUsd, 320);
    assert.deepEqual(result.reasons, ["RESERVE_ADJUSTMENT"]);
  });

  it("rejects exposure, expiry, and slippage breaches deterministically", () => {
    const thesis = interpretDemoThesis(DEFAULT_DEMO_THESIS, NOW);
    const exposure = evaluateThesisRisk(
      thesis,
      { ...DEMO_PORTFOLIO, currentAssetExposureUsd: 500 },
      NOW,
    );
    const expired = evaluateThesisRisk(
      editThesisParameters(thesis, { expiryIso: "2026-09-01T17:00:00.000Z" }),
      DEMO_PORTFOLIO,
      NOW,
    );
    const slippage = evaluateThesisRisk(
      editThesisParameters(thesis, { maxSlippagePercent: 0.5 }),
      DEMO_PORTFOLIO,
      NOW,
    );
    assert.ok(exposure.reasons.includes("EXPOSURE_LIMIT"));
    assert.ok(expired.reasons.includes("INTENT_EXPIRED"));
    assert.ok(slippage.reasons.includes("SLIPPAGE_TOO_HIGH"));
    assert.equal(exposure.state, "BLOCKED");
  });

  it("reaches READY_FOR_AUTHORIZATION only after accepted risk and explicit preparation", () => {
    const thesis = interpretDemoThesis(DEFAULT_DEMO_THESIS, NOW);
    assert.equal(prepareThesisExecution(thesis, true), null);
    const accepted = acceptRiskResult(thesis, evaluateThesisRisk(thesis, DEMO_PORTFOLIO, NOW));
    assert.equal(accepted.status, "READY_FOR_AUTHORIZATION");
    assert.equal(canAuthorizeThesis(accepted, null), false);
    assert.equal(prepareThesisExecution(accepted, false), null);
    const prepared = prepareThesisExecution(accepted, true);
    assert.ok(prepared);
    assert.equal(canAuthorizeThesis(accepted, prepared), true);
  });

  it("isolates demo assets and labels blocked production dependencies honestly", () => {
    assert.equal(isDemoAssetAllowedInProduction("mUSDC"), false);
    assert.equal(isDemoAssetAllowedInProduction("NOTB20"), false);
    for (const item of PRODUCTION_READINESS) {
      assert.equal(readinessCanDisplayReady(item.state), item.state === "READY");
    }
    assert.match(TESTNET_EXECUTION_DISCLOSURE, /BASE SEPOLIA LIVE DEMO/);
    assert.match(TESTNET_EXECUTION_DISCLOSURE, /NO REAL STOCKS/);
  });
});

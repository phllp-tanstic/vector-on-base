import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requestAiThesisInterpretation } from "./ai-intent.ts";

const INTERPRETATION = {
  asset: "NVDA",
  rationale: "Acquire NVDA at the user's requested threshold.",
  entryPriceUsd: 170,
  requestedSizeUsd: 500,
  maxExposurePercent: 10,
  reserveUsd: 1_000,
  maxSlippagePercent: 1,
  expiryIso: "2026-09-11T17:00:00.000Z",
};

describe("browser AI intent client", () => {
  it("posts the thesis and accepts only a validated interpretation", async () => {
    const result = await requestAiThesisInterpretation(
      "Buy NVDA below $170",
      async (input, init) => {
        assert.equal(input, "/api/interpret");
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), { sourceText: "Buy NVDA below $170" });
        return new Response(JSON.stringify({ interpretation: INTERPRETATION }), { status: 200 });
      },
    );
    assert.deepEqual(result, INTERPRETATION);
  });

  it("surfaces safe server errors and rejects malformed success output", async () => {
    await assert.rejects(
      () =>
        requestAiThesisInterpretation(
          "Buy NVDA",
          async () =>
            new Response(JSON.stringify({ error: "Groq rate limit reached. Try again shortly." }), {
              status: 429,
            }),
        ),
      /rate limit/u,
    );
    await assert.rejects(
      () =>
        requestAiThesisInterpretation(
          "Buy NVDA",
          async () => new Response(JSON.stringify({ interpretation: {} }), { status: 200 }),
        ),
      /invalid thesis structure/u,
    );
  });
});

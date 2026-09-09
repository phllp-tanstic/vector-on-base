import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_GROQ_MODEL,
  GROQ_CHAT_COMPLETIONS_URL,
  GroqIntentError,
  interpretMarketThesisWithGroq,
  parseInterpretedMarketThesis,
  type IntentFetch,
} from "./index.ts";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const OUTPUT = {
  asset: "NVDA",
  rationale: "Acquire NVDA only at or below the user's entry price.",
  entryPriceUsd: 170,
  requestedSizeUsd: 500,
  maxExposurePercent: 10,
  reserveUsd: 1_000,
  maxSlippagePercent: 1,
  expiryIso: "2026-09-11T17:00:00.000Z",
} as const;

function successfulFetch(
  onRequest?: (input: string, body: Record<string, unknown>) => void,
): IntentFetch {
  return async (input, init) => {
    onRequest?.(input, JSON.parse(init.body) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(OUTPUT) } }] };
      },
    };
  };
}

describe("Groq intent interpreter", () => {
  it("requests strict structured output and validates the returned thesis", async () => {
    let requestModel: unknown;
    let responseFormat: unknown;
    const result = await interpretMarketThesisWithGroq("Buy NVDA below $170", {
      apiKey: "test-key",
      now: NOW,
      fetchImpl: successfulFetch((input, body) => {
        assert.equal(input, GROQ_CHAT_COMPLETIONS_URL);
        requestModel = body.model;
        responseFormat = body.response_format;
      }),
    });
    assert.equal(requestModel, DEFAULT_GROQ_MODEL);
    assert.equal((responseFormat as { json_schema: { strict: boolean } }).json_schema.strict, true);
    assert.deepEqual(result, OUTPUT);
  });

  it("rejects unsupported assets before contacting Groq", async () => {
    let called = false;
    await assert.rejects(
      () =>
        interpretMarketThesisWithGroq("Buy AAPL below $200", {
          apiKey: "test-key",
          fetchImpl: async () => {
            called = true;
            throw new Error("must not run");
          },
        }),
      (error: unknown) => error instanceof GroqIntentError && error.code === "UNSUPPORTED_ASSET",
    );
    assert.equal(called, false);
  });

  it("classifies missing configuration, rate limits, and malformed model output", async () => {
    await assert.rejects(
      () => interpretMarketThesisWithGroq("Buy NVDA", { apiKey: "" }),
      (error: unknown) => error instanceof GroqIntentError && error.code === "CONFIGURATION_ERROR",
    );
    await assert.rejects(
      () =>
        interpretMarketThesisWithGroq("Buy NVDA", {
          apiKey: "test-key",
          fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
        }),
      (error: unknown) => error instanceof GroqIntentError && error.code === "RATE_LIMITED",
    );
    await assert.rejects(
      () =>
        interpretMarketThesisWithGroq("Buy NVDA", {
          apiKey: "test-key",
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: "{}" } }] }),
          }),
        }),
      (error: unknown) => error instanceof GroqIntentError && error.code === "INVALID_RESPONSE",
    );
  });

  it("normalizes valid ISO dates and rejects unknown output fields", () => {
    assert.equal(parseInterpretedMarketThesis(OUTPUT).expiryIso, OUTPUT.expiryIso);
    assert.throws(
      () => parseInterpretedMarketThesis({ ...OUTPUT, authorization: true }),
      (error: unknown) => error instanceof GroqIntentError && error.code === "INVALID_RESPONSE",
    );
  });
});

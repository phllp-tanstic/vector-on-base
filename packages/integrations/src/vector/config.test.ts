import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadVectorExecutorConfig,
  VectorExecutorConfigurationError,
  VECTOR_EXECUTOR_ADDRESS_ENV_VAR,
} from "./config.ts";

describe("VectorExecutor trusted configuration", () => {
  it("loads a configured non-zero address", () => {
    assert.equal(
      loadVectorExecutorConfig({
        [VECTOR_EXECUTOR_ADDRESS_ENV_VAR]: "0x0000000000000000000000000000000000000010",
      }).executorAddress,
      "0x0000000000000000000000000000000000000010",
    );
  });

  it("rejects missing, malformed, and zero addresses", () => {
    for (const value of [
      undefined,
      "not-an-address",
      "0x0000000000000000000000000000000000000000",
    ]) {
      assert.throws(
        () => loadVectorExecutorConfig({ [VECTOR_EXECUTOR_ADDRESS_ENV_VAR]: value }),
        (error: unknown) => error instanceof VectorExecutorConfigurationError,
      );
    }
  });
});

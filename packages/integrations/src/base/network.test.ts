import assert from "node:assert/strict";
import { it } from "node:test";

import { BaseRpcConfigurationError } from "./config.ts";
import { verifyBaseNetwork } from "./network.ts";

it("rejects an RPC connected to the wrong chain before reading a block", async () => {
  let blockRead = false;

  await assert.rejects(
    verifyBaseNetwork({
      async getBlockNumber() {
        blockRead = true;
        return 1n;
      },
      async getChainId() {
        return 84_532;
      },
    }),
    (error: unknown) => error instanceof BaseRpcConfigurationError && error.code === "WRONG_CHAIN",
  );

  assert.equal(blockRead, false);
});

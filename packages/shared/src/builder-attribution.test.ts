import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Attribution } from "ox/erc8021";

import { VECTOR_BUILDER_CODE, VECTOR_BUILDER_DATA_SUFFIX } from "./builder-attribution.ts";

describe("Vector Base Builder Code attribution", () => {
  it("encodes the registered code as a canonical Schema 0 ERC-8021 suffix", () => {
    assert.equal(VECTOR_BUILDER_CODE, "bc_wm9pyn6y");
    assert.equal(
      VECTOR_BUILDER_DATA_SUFFIX,
      "0x62635f776d3970796e36790b0080218021802180218021802180218021",
    );
    assert.deepEqual(Attribution.fromData(VECTOR_BUILDER_DATA_SUFFIX), {
      codes: [VECTOR_BUILDER_CODE],
      id: 0,
    });
  });
});

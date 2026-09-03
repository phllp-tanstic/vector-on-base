import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  B20_ASSET_VARIANT,
  B20_STABLECOIN_VARIANT,
  getB20Variant,
  isB20AssetAddress,
} from "./address.ts";

describe("B20 address validation", () => {
  it("recognizes the documented B20 prefix and Asset variant", () => {
    const address = "0xb20000000000000000000078ee7ce2fE4908108C";

    assert.equal(getB20Variant(address), B20_ASSET_VARIANT);
    assert.equal(isB20AssetAddress(address), true);
  });

  it("distinguishes the Stablecoin variant", () => {
    const address = "0xb200000000000000000001000000000000000001";

    assert.equal(getB20Variant(address), B20_STABLECOIN_VARIANT);
    assert.equal(isB20AssetAddress(address), false);
  });

  it("rejects addresses without the B20 prefix", () => {
    assert.equal(isB20AssetAddress("0xa20000000000000000000078ee7ce2fE4908108C"), false);
  });

  it("rejects unsupported variant bytes", () => {
    assert.equal(getB20Variant("0xb200000000000000000002000000000000000001"), undefined);
  });

  it("rejects malformed addresses", () => {
    assert.equal(isB20AssetAddress("0xb200"), false);
  });
});

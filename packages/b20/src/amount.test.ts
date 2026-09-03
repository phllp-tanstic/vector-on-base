import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  B20AmountError,
  B20_WAD_PRECISION,
  b20Multiplier,
  b20RawAmount,
  b20UIAmount,
  rawToUIAmount,
  type B20Multiplier,
  uiToRawAmount,
} from "./amount.ts";

describe("B20 amount conversion", () => {
  it("uses the WAD multiplier as an identity conversion", () => {
    const rawAmount = b20RawAmount(123_456_789n);
    const multiplier = b20Multiplier(B20_WAD_PRECISION);

    assert.equal(rawToUIAmount(rawAmount, multiplier), rawAmount);
    assert.equal(uiToRawAmount(b20UIAmount(rawAmount), multiplier), rawAmount);
  });

  it("increases UI exposure when the multiplier is above one WAD", () => {
    assert.equal(rawToUIAmount(b20RawAmount(7n), b20Multiplier(2n * B20_WAD_PRECISION)), 14n);
  });

  it("reduces UI exposure when the multiplier is below one WAD", () => {
    assert.equal(rawToUIAmount(b20RawAmount(8n), b20Multiplier(B20_WAD_PRECISION / 2n)), 4n);
  });

  it("rounds raw-to-UI conversion down", () => {
    const multiplier = b20Multiplier((3n * B20_WAD_PRECISION) / 2n);

    assert.equal(rawToUIAmount(b20RawAmount(5n), multiplier), 7n);
  });

  it("rounds UI-to-raw conversion down", () => {
    const multiplier = b20Multiplier((3n * B20_WAD_PRECISION) / 2n);

    assert.equal(uiToRawAmount(b20UIAmount(8n), multiplier), 5n);
  });

  it("makes the expected last-unit loss explicit for a flooring round trip", () => {
    const rawAmount = b20RawAmount(1n);
    const multiplier = b20Multiplier((3n * B20_WAD_PRECISION) / 2n);
    const uiAmount = rawToUIAmount(rawAmount, multiplier);
    const roundTripRaw = uiToRawAmount(uiAmount, multiplier);

    assert.equal(uiAmount, 1n);
    assert.equal(roundTripRaw, 0n);
    assert.equal(rawAmount - roundTripRaw, 1n);
    assert.ok(rawAmount - roundTripRaw <= (B20_WAD_PRECISION + multiplier - 1n) / multiplier);
  });

  it("rejects a zero multiplier", () => {
    const zeroMultiplier = 0n as B20Multiplier;

    assert.throws(
      () => b20Multiplier(0n),
      (error: unknown) => error instanceof B20AmountError && error.code === "INVALID_MULTIPLIER",
    );
    assert.throws(
      () => rawToUIAmount(b20RawAmount(1n), zeroMultiplier),
      (error: unknown) => error instanceof B20AmountError && error.code === "INVALID_MULTIPLIER",
    );
    assert.throws(
      () => uiToRawAmount(b20UIAmount(1n), zeroMultiplier),
      (error: unknown) => error instanceof B20AmountError && error.code === "INVALID_MULTIPLIER",
    );
  });

  it("uses bigint arithmetic without fixed-width overflow", () => {
    const rawAmount = b20RawAmount((1n << 256n) - 1n);
    const multiplier = b20Multiplier(B20_WAD_PRECISION);
    const uiAmount = rawToUIAmount(rawAmount, multiplier);

    assert.equal(uiAmount, rawAmount);
    assert.equal(uiToRawAmount(uiAmount, multiplier), rawAmount);
  });
});

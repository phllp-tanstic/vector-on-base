declare const rawAmountBrand: unique symbol;
declare const uiAmountBrand: unique symbol;
declare const multiplierBrand: unique symbol;

/** Canonical token units used by B20 balances and transfers. */
export type B20RawAmount = bigint & { readonly [rawAmountBrand]: "B20RawAmount" };

/** Multiplier-adjusted UI/economic exposure units. */
export type B20UIAmount = bigint & { readonly [uiAmountBrand]: "B20UIAmount" };

/** Positive WAD-precision multiplier returned by a B20 Asset. */
export type B20Multiplier = bigint & { readonly [multiplierBrand]: "B20Multiplier" };

export const B20_WAD_PRECISION = 1_000_000_000_000_000_000n;

export type B20AmountErrorCode = "INVALID_MULTIPLIER" | "INVALID_RAW_AMOUNT" | "INVALID_UI_AMOUNT";

export class B20AmountError extends Error {
  readonly code: B20AmountErrorCode;

  constructor(code: B20AmountErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function b20RawAmount(value: bigint): B20RawAmount {
  if (value < 0n) {
    throw new B20AmountError("INVALID_RAW_AMOUNT", "B20 raw amount must not be negative.");
  }

  return value as B20RawAmount;
}

export function b20UIAmount(value: bigint): B20UIAmount {
  if (value < 0n) {
    throw new B20AmountError("INVALID_UI_AMOUNT", "B20 UI amount must not be negative.");
  }

  return value as B20UIAmount;
}

export function b20Multiplier(value: bigint): B20Multiplier {
  if (value <= 0n) {
    throw new B20AmountError("INVALID_MULTIPLIER", "B20 multiplier must be greater than zero.");
  }

  return value as B20Multiplier;
}

/** Converts canonical raw token units to UI/economic units, rounding down. */
export function rawToUIAmount(rawAmount: B20RawAmount, multiplier: B20Multiplier): B20UIAmount {
  const validMultiplier = b20Multiplier(multiplier);
  return b20UIAmount((b20RawAmount(rawAmount) * validMultiplier) / B20_WAD_PRECISION);
}

/** Converts UI/economic units to canonical raw token units, rounding down. */
export function uiToRawAmount(uiAmount: B20UIAmount, multiplier: B20Multiplier): B20RawAmount {
  const validMultiplier = b20Multiplier(multiplier);
  return b20RawAmount((b20UIAmount(uiAmount) * B20_WAD_PRECISION) / validMultiplier);
}

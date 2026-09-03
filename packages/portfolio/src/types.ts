import type { B20VectorAsset, Erc20VectorAsset, EvmAddress, VectorAsset } from "@vector/shared";

declare const rawBalanceBrand: unique symbol;
declare const economicBalanceBrand: unique symbol;
declare const referencePriceBrand: unique symbol;
declare const referenceValueBrand: unique symbol;
declare const referencePriceSourceBrand: unique symbol;

export type PortfolioRawBalance = bigint & {
  readonly [rawBalanceBrand]: "PortfolioRawBalance";
};

export type PortfolioEconomicBalance = bigint & {
  readonly [economicBalanceBrand]: "PortfolioEconomicBalance";
};

export type ReferencePriceAmount = bigint & {
  readonly [referencePriceBrand]: "ReferencePriceAmount";
};

export type USDReferenceValue = bigint & {
  readonly [referenceValueBrand]: "USDReferenceValue";
};

export type ReferencePriceSource = string & {
  readonly [referencePriceSourceBrand]: "ReferencePriceSource";
};

export const USD_REFERENCE_VALUE_DECIMALS = 8 as const;
export const USD_REFERENCE_VALUE_SCALE = 100_000_000n;

export interface Erc20PortfolioPosition {
  readonly asset: Erc20VectorAsset;
  readonly rawBalance: PortfolioRawBalance;
  readonly tokenDecimals: number;
}

export interface B20PortfolioPosition {
  readonly asset: B20VectorAsset;
  readonly economicBalance: PortfolioEconomicBalance;
  readonly multiplier: bigint;
  readonly rawBalance: PortfolioRawBalance;
  readonly tokenDecimals: number;
}

export type PortfolioPosition = Erc20PortfolioPosition | B20PortfolioPosition;

export interface PortfolioSnapshot {
  readonly account: EvmAddress;
  readonly blockNumber: bigint;
  readonly blockTimestamp: bigint;
  readonly positions: readonly PortfolioPosition[];
}

export interface AssetPrice {
  readonly asset: VectorAsset;
  readonly observedAt: bigint;
  readonly price: ReferencePriceAmount;
  readonly priceDecimals: number;
  readonly source: ReferencePriceSource;
}

export interface ValuedPosition {
  readonly economicAmount: PortfolioEconomicBalance;
  readonly position: PortfolioPosition;
  readonly referencePrice: AssetPrice;
  readonly referenceValue: USDReferenceValue;
}

export interface ValuedPortfolioSnapshot {
  readonly positions: readonly ValuedPosition[];
  readonly referenceValueDecimals: typeof USD_REFERENCE_VALUE_DECIMALS;
  readonly snapshot: PortfolioSnapshot;
  readonly totalReferenceValue: USDReferenceValue;
}

export type PortfolioDomainErrorCode =
  | "DUPLICATE_POSITION"
  | "INVALID_ACCOUNT"
  | "INVALID_BALANCE"
  | "INVALID_BLOCK"
  | "INVALID_MULTIPLIER"
  | "INVALID_PRICE"
  | "INVALID_PRICE_PRECISION"
  | "INVALID_PRICE_SOURCE"
  | "INVALID_PRICE_TIMESTAMP"
  | "INVALID_TOKEN_DECIMALS"
  | "UNSUPPORTED_ASSET";

export class PortfolioDomainError extends Error {
  readonly code: PortfolioDomainErrorCode;

  constructor(code: PortfolioDomainErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function assertNonNegative(value: bigint, label: string): void {
  if (value < 0n) {
    throw new PortfolioDomainError("INVALID_BALANCE", `${label} must not be negative.`);
  }
}

function assertTokenDecimals(decimals: number, asset: VectorAsset): void {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    decimals !== asset.decimals
  ) {
    throw new PortfolioDomainError(
      "INVALID_TOKEN_DECIMALS",
      `${asset.symbol} token decimals do not match its asset definition.`,
    );
  }
}

export function portfolioRawBalance(value: bigint): PortfolioRawBalance {
  assertNonNegative(value, "Portfolio raw balance");
  return value as PortfolioRawBalance;
}

export function portfolioEconomicBalance(value: bigint): PortfolioEconomicBalance {
  assertNonNegative(value, "Portfolio economic balance");
  return value as PortfolioEconomicBalance;
}

export function referencePriceAmount(value: bigint): ReferencePriceAmount {
  if (value < 0n) {
    throw new PortfolioDomainError("INVALID_PRICE", "Reference price must not be negative.");
  }

  return value as ReferencePriceAmount;
}

export function usdReferenceValue(value: bigint): USDReferenceValue {
  if (value < 0n) {
    throw new PortfolioDomainError("INVALID_BALANCE", "USD reference value must not be negative.");
  }

  return value as USDReferenceValue;
}

export function referencePriceSource(value: string): ReferencePriceSource {
  if (value.trim().length === 0) {
    throw new PortfolioDomainError(
      "INVALID_PRICE_SOURCE",
      "Reference price source must not be empty.",
    );
  }

  return value as ReferencePriceSource;
}

export function createErc20PortfolioPosition(
  asset: Erc20VectorAsset,
  rawBalance: bigint,
  tokenDecimals: number = asset.decimals,
): Erc20PortfolioPosition {
  assertTokenDecimals(tokenDecimals, asset);

  return Object.freeze({
    asset,
    rawBalance: portfolioRawBalance(rawBalance),
    tokenDecimals,
  });
}

export function createB20PortfolioPosition(
  asset: B20VectorAsset,
  rawBalance: bigint,
  economicBalance: bigint,
  multiplier: bigint,
  tokenDecimals: number = asset.decimals,
): B20PortfolioPosition {
  assertTokenDecimals(tokenDecimals, asset);

  if (multiplier <= 0n) {
    throw new PortfolioDomainError(
      "INVALID_MULTIPLIER",
      `${asset.symbol} multiplier must be greater than zero.`,
    );
  }

  return Object.freeze({
    asset,
    economicBalance: portfolioEconomicBalance(economicBalance),
    multiplier,
    rawBalance: portfolioRawBalance(rawBalance),
    tokenDecimals,
  });
}

export function createPortfolioSnapshot(input: {
  readonly account: EvmAddress;
  readonly blockNumber: bigint;
  readonly blockTimestamp: bigint;
  readonly positions: readonly PortfolioPosition[];
}): PortfolioSnapshot {
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.account)) {
    throw new PortfolioDomainError("INVALID_ACCOUNT", `Invalid account address: ${input.account}`);
  }

  if (input.blockNumber < 0n || input.blockTimestamp < 0n) {
    throw new PortfolioDomainError(
      "INVALID_BLOCK",
      "Snapshot block number and timestamp must not be negative.",
    );
  }

  const seenAddresses = new Set<string>();

  for (const position of input.positions) {
    if (position.asset.assetStandard !== "ERC20" && position.asset.assetStandard !== "B20") {
      throw new PortfolioDomainError("UNSUPPORTED_ASSET", "Unsupported portfolio asset standard.");
    }

    const addressKey = position.asset.tokenAddress.toLowerCase();

    if (seenAddresses.has(addressKey)) {
      throw new PortfolioDomainError(
        "DUPLICATE_POSITION",
        `Duplicate portfolio position: ${position.asset.symbol}`,
      );
    }

    seenAddresses.add(addressKey);
  }

  return Object.freeze({
    account: input.account,
    blockNumber: input.blockNumber,
    blockTimestamp: input.blockTimestamp,
    positions: Object.freeze([...input.positions]),
  });
}

export function createAssetPrice(input: {
  readonly asset: VectorAsset;
  readonly observedAt: bigint;
  readonly price: bigint;
  readonly priceDecimals: number;
  readonly source: string;
}): AssetPrice {
  if (
    !Number.isInteger(input.priceDecimals) ||
    input.priceDecimals < 0 ||
    input.priceDecimals > 255
  ) {
    throw new PortfolioDomainError(
      "INVALID_PRICE_PRECISION",
      "Reference price decimals must be an integer from 0 through 255.",
    );
  }

  if (input.observedAt < 0n) {
    throw new PortfolioDomainError(
      "INVALID_PRICE_TIMESTAMP",
      "Reference price timestamp must not be negative.",
    );
  }

  return Object.freeze({
    asset: input.asset,
    observedAt: input.observedAt,
    price: referencePriceAmount(input.price),
    priceDecimals: input.priceDecimals,
    source: referencePriceSource(input.source),
  });
}

export type EvmAddress = `0x${string}`;

interface VectorAssetBase {
  readonly symbol: string;
  readonly name: string;
  readonly tokenAddress: EvmAddress;
  readonly decimals: number;
  readonly enabled: boolean;
}

export interface Erc20VectorAsset extends VectorAssetBase {
  readonly assetStandard: "ERC20";
  readonly underlyingTicker?: never;
}

export interface B20VectorAsset extends VectorAssetBase {
  readonly assetStandard: "B20";
  readonly underlyingTicker: string;
}

export type VectorAsset = Erc20VectorAsset | B20VectorAsset;

export class InvalidVectorAssetError extends Error {
  readonly code = "INVALID_VECTOR_ASSET";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isEvmAddress(value: unknown): value is EvmAddress {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function parseVectorAsset(value: unknown): VectorAsset {
  if (!isRecord(value)) {
    throw new InvalidVectorAssetError("Asset must be an object.");
  }

  const { assetStandard, decimals, enabled, name, symbol, tokenAddress, underlyingTicker } = value;

  if (!isNonEmptyString(symbol)) {
    throw new InvalidVectorAssetError("Asset symbol must be a non-empty string.");
  }

  if (!isNonEmptyString(name)) {
    throw new InvalidVectorAssetError("Asset name must be a non-empty string.");
  }

  if (!isEvmAddress(tokenAddress)) {
    throw new InvalidVectorAssetError("Asset tokenAddress must be a valid EVM address.");
  }

  if (
    !Number.isInteger(decimals) ||
    typeof decimals !== "number" ||
    decimals < 0 ||
    decimals > 255
  ) {
    throw new InvalidVectorAssetError("Asset decimals must be an integer from 0 through 255.");
  }

  if (typeof enabled !== "boolean") {
    throw new InvalidVectorAssetError("Asset enabled state must be a boolean.");
  }

  if (assetStandard === "ERC20") {
    if (underlyingTicker !== undefined) {
      throw new InvalidVectorAssetError("ERC20 assets must not define an underlying ticker.");
    }

    return Object.freeze({ assetStandard, decimals, enabled, name, symbol, tokenAddress });
  }

  if (assetStandard === "B20") {
    if (!isNonEmptyString(underlyingTicker)) {
      throw new InvalidVectorAssetError("B20 assets must define an underlying ticker.");
    }

    return Object.freeze({
      assetStandard,
      decimals,
      enabled,
      name,
      symbol,
      tokenAddress,
      underlyingTicker,
    });
  }

  throw new InvalidVectorAssetError('Asset standard must be either "ERC20" or "B20".');
}

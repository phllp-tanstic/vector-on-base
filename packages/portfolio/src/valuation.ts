import type { VectorAsset } from "@vector/shared";

import type { ReferencePriceProvider } from "./price-provider.ts";
import {
  type AssetPrice,
  createAssetPrice,
  type PortfolioPosition,
  type PortfolioSnapshot,
  PortfolioDomainError,
  portfolioEconomicBalance,
  type ValuedPortfolioSnapshot,
  type ValuedPosition,
  USD_REFERENCE_VALUE_DECIMALS,
  USD_REFERENCE_VALUE_SCALE,
  usdReferenceValue,
} from "./types.ts";

export type PortfolioValuationErrorCode =
  "DUPLICATE_PRICE" | "MISSING_PRICE" | "PRICE_ASSET_MISMATCH" | "UNSUPPORTED_PRICE_ASSET";

export class PortfolioValuationError extends Error {
  readonly code: PortfolioValuationErrorCode;

  constructor(code: PortfolioValuationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function powerOfTen(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new PortfolioDomainError(
      "INVALID_PRICE_PRECISION",
      "Fixed-point decimals must be an integer from 0 through 255.",
    );
  }

  return 10n ** BigInt(decimals);
}

function positionEconomicAmount(position: PortfolioPosition): bigint {
  return "economicBalance" in position ? position.economicBalance : position.rawBalance;
}

function assetIdentityMatches(left: VectorAsset, right: VectorAsset): boolean {
  return (
    left.tokenAddress.toLowerCase() === right.tokenAddress.toLowerCase() &&
    left.symbol === right.symbol &&
    left.assetStandard === right.assetStandard
  );
}

/**
 * Returns 1e8 USD/reference-value units, rounding down exactly once:
 * economicAmount * price * 1e8 / (10^tokenDecimals * 10^priceDecimals).
 */
export function valuePosition(
  position: PortfolioPosition,
  referencePrice: AssetPrice,
): ValuedPosition {
  const validatedPrice = createAssetPrice({
    asset: referencePrice.asset,
    observedAt: referencePrice.observedAt,
    price: referencePrice.price,
    priceDecimals: referencePrice.priceDecimals,
    source: referencePrice.source,
  });

  if (!assetIdentityMatches(position.asset, validatedPrice.asset)) {
    throw new PortfolioValuationError(
      "PRICE_ASSET_MISMATCH",
      `Reference price identity does not match ${position.asset.symbol}.`,
    );
  }

  const economicAmount = portfolioEconomicBalance(positionEconomicAmount(position));
  const numerator = economicAmount * validatedPrice.price * USD_REFERENCE_VALUE_SCALE;
  const denominator = powerOfTen(position.tokenDecimals) * powerOfTen(validatedPrice.priceDecimals);
  const referenceValue = usdReferenceValue(numerator / denominator);

  return Object.freeze({
    economicAmount,
    position,
    referencePrice: validatedPrice,
    referenceValue,
  });
}

export function valuePortfolio(
  snapshot: PortfolioSnapshot,
  referencePrices: readonly AssetPrice[],
): ValuedPortfolioSnapshot {
  const positionAddresses = new Set(
    snapshot.positions.map((position) => position.asset.tokenAddress.toLowerCase()),
  );
  const pricesByAddress = new Map<string, AssetPrice>();
  const priceSymbols = new Set<string>();

  for (const price of referencePrices) {
    const addressKey = price.asset.tokenAddress.toLowerCase();
    const symbolKey = price.asset.symbol.toLocaleUpperCase("en-US");

    if (pricesByAddress.has(addressKey) || priceSymbols.has(symbolKey)) {
      throw new PortfolioValuationError(
        "DUPLICATE_PRICE",
        `Duplicate reference price: ${price.asset.symbol}`,
      );
    }

    if (!positionAddresses.has(addressKey)) {
      throw new PortfolioValuationError(
        "UNSUPPORTED_PRICE_ASSET",
        `Reference price asset is not in the snapshot: ${price.asset.symbol}`,
      );
    }

    pricesByAddress.set(addressKey, price);
    priceSymbols.add(symbolKey);
  }

  const positions = snapshot.positions.map((position) => {
    const price = pricesByAddress.get(position.asset.tokenAddress.toLowerCase());

    if (price === undefined) {
      throw new PortfolioValuationError(
        "MISSING_PRICE",
        `Missing reference price for ${position.asset.symbol}.`,
      );
    }

    return valuePosition(position, price);
  });
  const totalReferenceValue = usdReferenceValue(
    positions.reduce((total, position) => total + position.referenceValue, 0n),
  );

  return Object.freeze({
    positions: Object.freeze(positions),
    referenceValueDecimals: USD_REFERENCE_VALUE_DECIMALS,
    snapshot,
    totalReferenceValue,
  });
}

export async function valuePortfolioWithProvider(
  snapshot: PortfolioSnapshot,
  provider: ReferencePriceProvider,
): Promise<ValuedPortfolioSnapshot> {
  const prices = await Promise.all(
    snapshot.positions.map((position) => provider.getPrice(position.asset)),
  );

  return valuePortfolio(snapshot, prices);
}

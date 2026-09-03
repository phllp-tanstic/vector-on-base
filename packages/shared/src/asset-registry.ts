import { parseVectorAsset, type EvmAddress, type VectorAsset } from "./asset.ts";

export type AssetRegistryErrorCode = "DUPLICATE_ASSET_ADDRESS" | "DUPLICATE_ASSET_SYMBOL";

export class AssetRegistryError extends Error {
  readonly code: AssetRegistryErrorCode;

  constructor(code: AssetRegistryErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class AssetRegistry {
  readonly #byAddress = new Map<string, VectorAsset>();
  readonly #bySymbol = new Map<string, VectorAsset>();

  constructor(assets: Iterable<unknown> = []) {
    for (const asset of assets) {
      this.register(asset);
    }
  }

  register(value: unknown): VectorAsset {
    const asset = parseVectorAsset(value);
    const symbolKey = asset.symbol.toLocaleUpperCase("en-US");
    const addressKey = asset.tokenAddress.toLowerCase();

    if (this.#bySymbol.has(symbolKey)) {
      throw new AssetRegistryError(
        "DUPLICATE_ASSET_SYMBOL",
        `Asset symbol is already registered: ${asset.symbol}`,
      );
    }

    if (this.#byAddress.has(addressKey)) {
      throw new AssetRegistryError(
        "DUPLICATE_ASSET_ADDRESS",
        `Asset address is already registered: ${asset.tokenAddress}`,
      );
    }

    this.#bySymbol.set(symbolKey, asset);
    this.#byAddress.set(addressKey, asset);

    return asset;
  }

  getBySymbol(symbol: string): VectorAsset | undefined {
    return this.#bySymbol.get(symbol.toLocaleUpperCase("en-US"));
  }

  getByAddress(address: EvmAddress): VectorAsset | undefined {
    return this.#byAddress.get(address.toLowerCase());
  }

  list(): readonly VectorAsset[] {
    return Object.freeze([...this.#bySymbol.values()]);
  }
}

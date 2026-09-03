import type { VectorAsset } from "@vector/shared";

import type { AssetPrice } from "./types.ts";

/** Supplies non-executable reference prices for portfolio and trigger state. */
export interface ReferencePriceProvider {
  getPrice(asset: VectorAsset): Promise<AssetPrice>;
}

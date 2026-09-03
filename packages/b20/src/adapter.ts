import type { B20VectorAsset, EvmAddress } from "@vector/shared";

import type { B20Multiplier, B20RawAmount, B20UIAmount } from "./amount.ts";

export interface B20ReadAdapter {
  rawBalanceOf(asset: B20VectorAsset, account: EvmAddress): Promise<B20RawAmount>;
  multiplier(asset: B20VectorAsset): Promise<B20Multiplier>;
  uiBalanceOf(asset: B20VectorAsset, account: EvmAddress): Promise<B20UIAmount>;
  toUIAmount(asset: B20VectorAsset, rawAmount: B20RawAmount): Promise<B20UIAmount>;
  fromUIAmount(asset: B20VectorAsset, uiAmount: B20UIAmount): Promise<B20RawAmount>;
}

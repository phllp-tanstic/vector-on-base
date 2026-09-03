import { AssetRegistry, type VectorAsset } from "@vector/shared";
import { getAddress } from "viem";

export const BASE_MAINNET_USDC = {
  assetStandard: "ERC20",
  decimals: 6,
  enabled: true,
  name: "USD Coin",
  symbol: "USDC",
  tokenAddress: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
} as const satisfies VectorAsset;

export const BASE_MAINNET_TOKENIZED_STOCKS = [
  {
    assetStandard: "B20",
    decimals: 8,
    enabled: true,
    name: "NVIDIA",
    symbol: "NVDAc",
    tokenAddress: getAddress("0xb20000000000000000000078ee7ce2fE4908108C"),
    underlyingTicker: "NVDA",
  },
  {
    assetStandard: "B20",
    decimals: 8,
    enabled: true,
    name: "Apple",
    symbol: "AAPLc",
    tokenAddress: getAddress("0xb200000000000000000000C2e324d24d7eEcd1fb"),
    underlyingTicker: "AAPL",
  },
  {
    assetStandard: "B20",
    decimals: 8,
    enabled: true,
    name: "Alphabet",
    symbol: "GOOGLc",
    tokenAddress: getAddress("0xb2000000000000000000002D0BA3164cc74f58B7"),
    underlyingTicker: "GOOGL",
  },
  {
    assetStandard: "B20",
    decimals: 8,
    enabled: true,
    name: "Meta",
    symbol: "METAc",
    tokenAddress: getAddress("0xb2000000000000000000008bC8786B856E61707C"),
    underlyingTicker: "META",
  },
] as const satisfies readonly VectorAsset[];

export const BASE_MAINNET_ASSET_REGISTRY = new AssetRegistry([
  BASE_MAINNET_USDC,
  ...BASE_MAINNET_TOKENIZED_STOCKS,
]);

export * from "./asset-registry.ts";
export * from "./asset.ts";
export * from "./builder-attribution.ts";

export const VECTOR_CHAIN_ID = 8453 as const;

export type VectorChainId = typeof VECTOR_CHAIN_ID;

import { BASE_MAINNET_TOKENIZED_STOCKS } from "../base/assets.ts";

export const CHAINLINK_REFERENCE_PRICE_MANIFEST_VERSION =
  "chainlink-data-streams-us-equities-v1-2026-09-05" as const;

export type ChainlinkEquityMarketPhase = "extended" | "overnight" | "regular";

export interface ChainlinkReferenceSource {
  readonly assetName: string;
  readonly feedIds: Readonly<Record<ChainlinkEquityMarketPhase, `0x${string}`>>;
  readonly provider: "CHAINLINK_DATA_STREAMS";
  readonly quoteCurrency: "USD";
  readonly schemaVersion: "V11";
  readonly underlyingTicker: "AAPL" | "GOOGL" | "META" | "NVDA";
}

const SOURCES_BY_SYMBOL = Object.freeze({
  AAPLc: Object.freeze({
    assetName: "Apple Inc",
    feedIds: Object.freeze({
      extended: "0x000b8b9394931d376dbfd988ab3e459b1954ca10880d6a2ec706cd2573910b5b",
      overnight: "0x000b313c8a4997a3bc871130415ffeb42cd37b79cf68c11478780650cc553c0b",
      regular: "0x000bbd87a23775b4c11092ae9a1fc7b3393636ae1dbb9f1ef460f845c0f4cff1",
    }),
    provider: "CHAINLINK_DATA_STREAMS",
    quoteCurrency: "USD",
    schemaVersion: "V11",
    underlyingTicker: "AAPL",
  }),
  GOOGLc: Object.freeze({
    assetName: "Alphabet Inc - A",
    feedIds: Object.freeze({
      extended: "0x000ba0be5e4c3746e3ebccec37362d9640ae6e9fee07bbb95ebdfd37d0220355",
      overnight: "0x000b2630095c8e9f31bde1f89f6b99106f7740649b7a9bde504ad6f8cf52cfbc",
      regular: "0x000b1a2aa24db17599e5003a09bcd5e2a15ef66f79c2dca4dde108ab923b1e97",
    }),
    provider: "CHAINLINK_DATA_STREAMS",
    quoteCurrency: "USD",
    schemaVersion: "V11",
    underlyingTicker: "GOOGL",
  }),
  METAc: Object.freeze({
    assetName: "Meta Platforms Inc",
    feedIds: Object.freeze({
      extended: "0x000b2f98113576782a2bb2cecbbfd034d7c949d8457ff81dfa68b6b2927dc2ee",
      overnight: "0x000bd63dc623dc102eeed0fe61ae7a3e13a28961df9a79912147f0234706f7ef",
      regular: "0x000bc63e601958daafb805b1eecc3972a0ad231e8c08c0432961b7b5c3251166",
    }),
    provider: "CHAINLINK_DATA_STREAMS",
    quoteCurrency: "USD",
    schemaVersion: "V11",
    underlyingTicker: "META",
  }),
  NVDAc: Object.freeze({
    assetName: "NVIDIA Corp",
    feedIds: Object.freeze({
      extended: "0x000bb043961643d051393c085a4dd0cded6f67b4b71e47e9dcec739b7b3e2145",
      overnight: "0x000b47988e89f3e63e1d679c84b774e6c38bb9929ad9de6e5e56d657a80388a9",
      regular: "0x000b6aa036224454037bab103184565f6aa9ea589c3b349f6d8471ee753524b9",
    }),
    provider: "CHAINLINK_DATA_STREAMS",
    quoteCurrency: "USD",
    schemaVersion: "V11",
    underlyingTicker: "NVDA",
  }),
} as const satisfies Readonly<Record<string, ChainlinkReferenceSource>>);

export const CHAINLINK_REFERENCE_PRICE_MANIFEST = Object.freeze({
  sourcesBySymbol: SOURCES_BY_SYMBOL,
  version: CHAINLINK_REFERENCE_PRICE_MANIFEST_VERSION,
});

export function getChainlinkReferenceSource(symbol: string): ChainlinkReferenceSource | undefined {
  return Object.hasOwn(SOURCES_BY_SYMBOL, symbol)
    ? SOURCES_BY_SYMBOL[symbol as keyof typeof SOURCES_BY_SYMBOL]
    : undefined;
}

for (const asset of BASE_MAINNET_TOKENIZED_STOCKS) {
  const source = getChainlinkReferenceSource(asset.symbol);
  if (!source || source.underlyingTicker !== asset.underlyingTicker) {
    throw new Error(`Reference source manifest is incomplete for ${asset.symbol}.`);
  }
}

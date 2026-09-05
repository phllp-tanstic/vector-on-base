import {
  BASE_MAINNET_TOKENIZED_STOCKS,
  captureChainlinkReferencePriceSnapshot,
  ChainlinkReferencePriceError,
  createBaseMainnetPortfolioBalanceReader,
  createChainlinkDataStreamsReferencePriceProvider,
  createChainlinkDataStreamsReportReader,
  loadChainlinkDataStreamsConfig,
} from "@vector/integrations";
import { createProviderBackedPortfolioRiskSnapshot } from "@vector/execution";
import type { EvmAddress } from "@vector/shared";
import { getAddress, isAddress, zeroAddress } from "viem";

export const REFERENCE_PRICE_VERIFY_COMMAND_CAPABILITY = "READ_ONLY" as const;

function configuredSmartAccount(value: string | undefined): EvmAddress | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!isAddress(trimmed, { strict: false }) || getAddress(trimmed) === zeroAddress) {
    throw new ChainlinkReferencePriceError(
      "MALFORMED_CONFIGURATION",
      "VECTOR_MAINNET_SMART_ACCOUNT must be a valid non-zero address.",
    );
  }
  return getAddress(trimmed) as EvmAddress;
}

async function main(): Promise<void> {
  const config = loadChainlinkDataStreamsConfig();
  const provider = createChainlinkDataStreamsReferencePriceProvider({
    reader: createChainlinkDataStreamsReportReader(config),
  });
  const snapshot = await captureChainlinkReferencePriceSnapshot({ provider });
  console.log(
    `snapshot=VALID snapshotId=${snapshot.snapshotId} createdAt=${snapshot.createdAt} ` +
      `manifestVersion=${snapshot.manifestVersion}`,
  );

  for (const asset of BASE_MAINNET_TOKENIZED_STOCKS) {
    const price = snapshot.prices.find((candidate) => candidate.asset === asset);
    if (!price) {
      throw new ChainlinkReferencePriceError(
        "MALFORMED_REPORT",
        `Captured snapshot is missing ${asset.symbol}.`,
      );
    }
    const age = snapshot.createdAt - price.observedAt;
    console.log(
      [
        `stock=${asset.symbol}`,
        `underlying=${asset.underlyingTicker}`,
        `provider=${price.source}`,
        `feedId=${price.sourceIdentifier}`,
        `marketStatus=${price.marketStatus}`,
        `feedRole=${price.selectedFeedRole}`,
        `price=${price.price}`,
        `decimals=${price.priceDecimals}`,
        `reportTimestamp=${price.observedAt}`,
        `ageSeconds=${age}`,
        "freshness=VALID",
      ].join(" "),
    );
  }

  const smartAccount = configuredSmartAccount(process.env.VECTOR_MAINNET_SMART_ACCOUNT);
  if (!smartAccount) {
    console.log("portfolio=SKIPPED reason=VECTOR_MAINNET_SMART_ACCOUNT_NOT_CONFIGURED");
    return;
  }
  const balanceRead = await createBaseMainnetPortfolioBalanceReader().read(smartAccount);
  const portfolioRiskSnapshot = createProviderBackedPortfolioRiskSnapshot({
    balanceRead,
    nowSeconds: BigInt(Math.floor(Date.now() / 1_000)),
    referenceSnapshot: snapshot,
  });
  console.log(
    `portfolio=VALID snapshotId=${portfolioRiskSnapshot.snapshotId} ` +
      `referenceSnapshotId=${snapshot.snapshotId} account=${smartAccount} ` +
      `blockNumber=${balanceRead.blockNumber} totalUsdFixedPoint=${portfolioRiskSnapshot.portfolio.totalReferenceValue} ` +
      `decimals=${portfolioRiskSnapshot.portfolio.referenceValueDecimals}`,
  );
  console.log("riskSnapshot=VALID source=PROVIDER_BACKED_REFERENCE_SNAPSHOT");
}

try {
  await main();
} catch (error) {
  const classified =
    error instanceof ChainlinkReferencePriceError
      ? error
      : new ChainlinkReferencePriceError(
          "PROVIDER_UNAVAILABLE",
          "Reference-price verification failed.",
        );
  console.log(`state=FAILED code=${classified.code} message=${classified.message}`);
  process.exitCode = 1;
}

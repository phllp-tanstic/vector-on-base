import {
  BASE_MAINNET_ASSET_REGISTRY,
  BASE_MAINNET_TOKENIZED_STOCKS,
  BASE_MAINNET_USDC,
  B20_INTERFACE_IDS,
  basePublicClient,
  createBaseMainnetB20Adapter,
  readErc20Metadata,
  verifyB20Assets,
  verifyBaseNetwork,
} from "@vector/integrations";
import { b20Multiplier, b20RawAmount, rawToUIAmount, uiToRawAmount } from "@vector/b20";
import { getAddress, zeroAddress } from "viem";

function formatOptionalMethod(result: { readonly status: "available" | "unavailable" }): string {
  return result.status;
}

async function main(): Promise<void> {
  const network = await verifyBaseNetwork();
  const registeredStocks = BASE_MAINNET_ASSET_REGISTRY.list().filter(
    (asset) => asset.assetStandard === "B20",
  );

  if (registeredStocks.length !== BASE_MAINNET_TOKENIZED_STOCKS.length) {
    throw new Error("Registered B20 asset count does not match the Base stock list.");
  }

  const usdcAddress = getAddress(BASE_MAINNET_USDC.tokenAddress);
  const usdcCode = await basePublicClient.getCode({ address: usdcAddress });

  if (usdcCode === undefined || usdcCode === "0x") {
    throw new Error(`No contract bytecode found for USDC at ${usdcAddress}.`);
  }

  const usdcMetadata = await readErc20Metadata(basePublicClient, BASE_MAINNET_USDC.tokenAddress);

  if (
    usdcMetadata.symbol !== BASE_MAINNET_USDC.symbol ||
    usdcMetadata.decimals !== BASE_MAINNET_USDC.decimals
  ) {
    throw new Error(
      `USDC metadata mismatch: received ${usdcMetadata.symbol}/${usdcMetadata.decimals}.`,
    );
  }

  console.log("Base Mainnet live verification passed");
  console.log(`chainId=${network.chainId}`);
  console.log(`latestBlockNumber=${network.latestBlockNumber}`);
  console.log(`USDC.symbol=${usdcMetadata.symbol}`);
  console.log(`USDC.decimals=${usdcMetadata.decimals}`);
  console.log(`USDC.address=${usdcAddress} codeBytes=${(usdcCode.length - 2) / 2}`);

  const stockResults = await verifyB20Assets(basePublicClient, registeredStocks);

  for (const result of stockResults) {
    const interfaces = [
      [B20_INTERFACE_IDS.ERC165, result.interfaces.erc165],
      [B20_INTERFACE_IDS.ERC8056_CORE, result.interfaces.erc8056Core],
      [B20_INTERFACE_IDS.ERC8056_PENDING, result.interfaces.erc8056Pending],
      [B20_INTERFACE_IDS.ERC8056_BALANCES, result.interfaces.erc8056Balances],
      [B20_INTERFACE_IDS.ERC8056_CONVERSION, result.interfaces.erc8056Conversion],
    ]
      .map(
        ([interfaceId, supported]) =>
          `${interfaceId}:${supported === null ? "unavailable" : supported}`,
      )
      .join(",");

    console.log(
      `${result.symbol}.address=${result.address} variant=ASSET marker=${result.code} ` +
        `factoryRecognized=${result.factoryRecognized} factoryInitialized=${result.factoryInitialized} ` +
        `decimals=${result.decimals} multiplier=${result.multiplier} ` +
        `uiMultiplier=${result.uiMultiplier ?? "unavailable"} interfaces=${interfaces}`,
    );
  }

  const nvdac = BASE_MAINNET_TOKENIZED_STOCKS.find((asset) => asset.symbol === "NVDAc");

  if (nvdac === undefined) {
    throw new Error("NVDAc is not registered.");
  }

  const adapter = createBaseMainnetB20Adapter();
  const nvdacVerification = stockResults.find((result) => result.symbol === nvdac.symbol);

  if (nvdacVerification === undefined) {
    throw new Error("NVDAc did not produce a B20 verification result.");
  }

  const sampleRawAmount = b20RawAmount(10n ** BigInt(nvdac.decimals));
  const verifiedMultiplier = b20Multiplier(nvdacVerification.multiplier);
  const sampleUIAmount = rawToUIAmount(sampleRawAmount, verifiedMultiplier);
  const optionalMethods = await adapter.inspectOptionalMethods(
    nvdac,
    zeroAddress,
    sampleRawAmount,
    sampleUIAmount,
  );
  const rawBalance = optionalMethods.canonicalRawBalance;
  const multiplier = optionalMethods.canonicalMultiplier;

  if (multiplier !== verifiedMultiplier) {
    throw new Error("NVDAc adapter multiplier does not match the B20 verification result.");
  }

  const uiBalance = rawToUIAmount(rawBalance, multiplier);
  const sampleRoundTripRawAmount = uiToRawAmount(sampleUIAmount, multiplier);

  console.log("NVDAc B20 raw/economic adapter verification passed");
  console.log(`NVDAc.adapter.address=${nvdac.tokenAddress}`);
  console.log(`NVDAc.adapter.account=${zeroAddress} purpose=ABI/read-verification-only`);
  console.log(`NVDAc.adapter.rawDecimals=${nvdac.decimals}`);
  console.log(`NVDAc.adapter.rawBalance=${rawBalance}`);
  console.log(`NVDAc.adapter.multiplier=${multiplier}`);
  console.log(`NVDAc.adapter.uiBalance=${uiBalance}`);
  console.log(`NVDAc.adapter.sampleRawAmount=${sampleRawAmount}`);
  console.log(`NVDAc.adapter.sampleUIAmount=${sampleUIAmount}`);
  console.log(`NVDAc.adapter.sampleRoundTripRawAmount=${sampleRoundTripRawAmount}`);
  console.log(
    "NVDAc.adapter.optionalMethods=" +
      [
        `balanceOfUI:${formatOptionalMethod(optionalMethods.balanceOfUI)}`,
        `scaledBalanceOf:${formatOptionalMethod(optionalMethods.scaledBalanceOf)}`,
        `toUIAmount:${formatOptionalMethod(optionalMethods.toUIAmount)}`,
        `toScaledBalance:${formatOptionalMethod(optionalMethods.toScaledBalance)}`,
        `fromUIAmount:${formatOptionalMethod(optionalMethods.fromUIAmount)}`,
        `toRawBalance:${formatOptionalMethod(optionalMethods.toRawBalance)}`,
      ].join(","),
  );
}

await main();

import {
  createBaseMainnetB20Adapter,
  createBasePublicClient,
  createConfiguredChainlinkReferencePriceProvider,
  createZeroXSwapClient,
  readErc20Metadata,
  verifyB20Asset,
} from "@vector/integrations";
import {
  checkBaseMainnetExecutionReadiness,
  createZeroXExecutionQuoteService,
  type MainnetReadinessDependencies,
  type MainnetReadinessReport,
} from "@vector/execution";
import { VECTOR_CHAIN_ID, type EvmAddress } from "@vector/shared";
import { getAddress, isAddress, zeroAddress } from "viem";

export const MAINNET_READINESS_COMMAND_CAPABILITY = "READ_ONLY" as const;

const DEFAULT_STOCK_SYMBOL = "NVDAc";
const DEFAULT_SELL_AMOUNT = 1_000_000n;
const DEFAULT_SLIPPAGE_BPS = 30;

const EXECUTOR_READ_ABI = [
  {
    inputs: [],
    name: "owner",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "asset", type: "address" }],
    name: "supportedAssets",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "target", type: "address" }],
    name: "approvedExecutionTargets",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "target", type: "address" }],
    name: "approvedAllowanceTargets",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ERC20_BALANCE_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function optionalAddress(value: string | undefined): EvmAddress | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!isAddress(trimmed, { strict: false }) || getAddress(trimmed) === zeroAddress) {
    throw new Error("Configured address must be a valid non-zero EVM address.");
  }
  return getAddress(trimmed) as EvmAddress;
}

function positiveRawAmount(value: string | undefined): bigint {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_SELL_AMOUNT;
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error("VECTOR_MAINNET_SELL_USDC must be a positive raw integer amount.");
  }
  return BigInt(trimmed);
}

function printReport(result: MainnetReadinessReport): void {
  console.log("Base Mainnet BStocks execution readiness");
  console.log(`state=${result.state}`);
  console.log(`message=${result.message}`);
  if (result.selectedAsset) console.log(`stock=${result.selectedAsset.symbol}`);
  if (result.executorAddress) console.log(`executor=${result.executorAddress}`);
  if (result.executorOwner) console.log(`executorOwner=${result.executorOwner}`);
  if (result.smartAccountUsdcBalance !== undefined) {
    console.log(`smartAccountUsdcBalance=${result.smartAccountUsdcBalance}`);
  }
  if (result.exactApprovalAmount !== undefined) {
    console.log(`exactApprovalAmount=${result.exactApprovalAmount}`);
  }
  if (result.accessRestriction) console.log(`accessRestriction=${result.accessRestriction}`);
  if (result.referencePrice) {
    console.log(`referencePriceProvider=${result.referencePrice.source}`);
    console.log(`referencePriceScale=1e${result.referencePrice.priceDecimals}`);
    console.log(`referencePriceTimestamp=${result.referencePrice.observedAt}`);
    if (result.referencePrice.marketStatus) {
      console.log(`referencePriceMarketStatus=${result.referencePrice.marketStatus}`);
    }
    if (result.referencePrice.sourceIdentifier) {
      console.log(`referencePriceSourceId=${result.referencePrice.sourceIdentifier}`);
    }
    console.log("referencePriceFreshness=valid");
  }
  if (result.quote) {
    console.log(`quoteTaker=${result.quote.taker}`);
    console.log(`quoteRawSellAmount=${result.quote.quotedRawSellAmount}`);
    console.log(`quoteMinimumRawBuyAmount=${result.quote.minBuyAmount}`);
    console.log(`executionTarget=${result.quote.transaction.target}`);
    console.log(`allowanceTarget=${result.quote.allowanceTarget ?? "missing"}`);
    console.log(
      `allowanceIssueSpender=${result.quote.issues.allowance?.spender ?? "not-returned"}`,
    );
  }
  for (const check of result.checks) {
    console.log(`check.${check.name}=${check.status}: ${check.detail}`);
  }
  console.log(`capability=${MAINNET_READINESS_COMMAND_CAPABILITY}`);
}

async function main(): Promise<void> {
  const client = createBasePublicClient();
  const executor = optionalAddress(process.env.VECTOR_EXECUTOR_ADDRESS);
  const smartAccount = optionalAddress(process.env.VECTOR_MAINNET_SMART_ACCOUNT);
  const referencePriceProvider = createConfiguredChainlinkReferencePriceProvider();
  const dependencies: MainnetReadinessDependencies = {
    getChainId: () => client.getChainId(),
    getCode: (address) => client.getCode({ address }),
    getExecutionQuote: (request) =>
      createZeroXExecutionQuoteService(
        createZeroXSwapClient(),
        createBaseMainnetB20Adapter(client),
      ).getQuote(request),
    ...(referencePriceProvider === undefined
      ? {}
      : { getReferencePrice: (asset) => referencePriceProvider.getPrice(asset) }),
    readExecutorAllowanceTargetApproval: (address, target) =>
      client.readContract({
        abi: EXECUTOR_READ_ABI,
        address,
        args: [target],
        functionName: "approvedAllowanceTargets",
      }),
    readExecutorAssetSupport: (address, asset) =>
      client.readContract({
        abi: EXECUTOR_READ_ABI,
        address,
        args: [asset],
        functionName: "supportedAssets",
      }),
    readExecutorExecutionTargetApproval: (address, target) =>
      client.readContract({
        abi: EXECUTOR_READ_ABI,
        address,
        args: [target],
        functionName: "approvedExecutionTargets",
      }),
    readExecutorOwner: (address) =>
      client.readContract({ abi: EXECUTOR_READ_ABI, address, functionName: "owner" }),
    readTokenBalance: (token, account) =>
      client.readContract({
        abi: ERC20_BALANCE_ABI,
        address: token,
        args: [account],
        functionName: "balanceOf",
      }),
    readTokenMetadata: (token) => readErc20Metadata(client, token),
    verifyB20Asset: (asset) => verifyB20Asset(client, asset),
  };
  const result = await checkBaseMainnetExecutionReadiness(
    {
      chainId: VECTOR_CHAIN_ID,
      ...(executor === undefined ? {} : { executorAddress: executor }),
      nowSeconds: BigInt(Math.floor(Date.now() / 1_000)),
      sellAmount: positiveRawAmount(process.env.VECTOR_MAINNET_SELL_USDC),
      slippageBps: DEFAULT_SLIPPAGE_BPS,
      ...(smartAccount === undefined ? {} : { smartAccountAddress: smartAccount }),
      stockSymbol: process.env.VECTOR_MAINNET_STOCK_SYMBOL?.trim() || DEFAULT_STOCK_SYMBOL,
      ...(process.env.VECTOR_MAINNET_STOCK_TOKEN_ADDRESS?.trim()
        ? { stockTokenAddress: process.env.VECTOR_MAINNET_STOCK_TOKEN_ADDRESS.trim() }
        : {}),
    },
    dependencies,
  );

  printReport(result);
  if (result.state !== "READY") process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  printReport({
    checks: [],
    message: error instanceof Error ? error.message : "Unknown configuration failure.",
    state: "CONFIGURATION_ERROR",
  });
  process.exitCode = 1;
}

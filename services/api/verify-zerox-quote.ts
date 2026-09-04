import {
  BASE_MAINNET_TOKENIZED_STOCKS,
  BASE_MAINNET_USDC,
  createZeroXSwapClient,
  ZeroXConfigurationError,
  ZeroXError,
  type ZeroXExactSellRequest,
} from "@vector/integrations";
import { createZeroXExecutionQuoteService } from "@vector/execution";
import { VECTOR_CHAIN_ID } from "@vector/shared";
import { getAddress, isAddress, zeroAddress } from "viem";

const DEFAULT_VERIFY_SELL_USDC = 1_000_000n;
const VERIFY_SLIPPAGE_BPS = 30;

function loadTaker(): `0x${string}` {
  const configured = process.env.VECTOR_VERIFY_TAKER?.trim();

  if (configured === undefined || !isAddress(configured, { strict: false })) {
    throw new Error("VECTOR_VERIFY_TAKER must be configured as a valid EVM address.");
  }

  const taker = getAddress(configured);

  if (taker === zeroAddress) {
    throw new Error("VECTOR_VERIFY_TAKER must not be the zero address.");
  }

  return taker;
}

function loadSellAmount(): bigint {
  const configured = process.env.VECTOR_VERIFY_SELL_USDC?.trim();

  if (configured === undefined || configured.length === 0) return DEFAULT_VERIFY_SELL_USDC;
  if (!/^(0|[1-9]\d*)$/.test(configured)) {
    throw new Error("VECTOR_VERIFY_SELL_USDC must be a raw non-negative integer amount.");
  }

  const amount = BigInt(configured);

  if (amount <= 0n) {
    throw new Error("VECTOR_VERIFY_SELL_USDC must be greater than zero.");
  }

  return amount;
}

function issueStatus(issue: object | null): "absent" | "present" {
  return issue === null ? "absent" : "present";
}

function printFailure(error: unknown): void {
  console.error("0x Base Mainnet live quote verification did not pass");

  if (error instanceof ZeroXError) {
    console.error(`classification=${error.code}`);
    console.error(
      `bstocksAccess=${error.code === "TOKENIZED_EQUITY_ACCESS_REQUIRED" ? "denied" : "unknown"}`,
    );
    if (error.httpStatus !== undefined) console.error(`httpStatus=${error.httpStatus}`);
    if (error.remote.code !== undefined) console.error(`remoteCode=${error.remote.code}`);
    if (error.remote.message !== undefined) console.error(`remoteMessage=${error.remote.message}`);
    if (error.remote.zid !== undefined) console.error(`remoteZid=${error.remote.zid}`);
    return;
  }

  if (error instanceof ZeroXConfigurationError) {
    console.error(`classification=${error.code}`);
    console.error(`message=${error.message}`);
    return;
  }

  console.error("classification=CONFIGURATION_ERROR");
  console.error(
    `message=${error instanceof Error ? error.message : "Unknown verification failure."}`,
  );
}

async function main(): Promise<void> {
  const nvdac = BASE_MAINNET_TOKENIZED_STOCKS.find((asset) => asset.symbol === "NVDAc");

  if (nvdac === undefined) throw new Error("NVDAc is not present in the verified registry.");

  const request = {
    buyAsset: nvdac,
    chainId: VECTOR_CHAIN_ID,
    sellAmount: loadSellAmount(),
    sellAsset: BASE_MAINNET_USDC,
    slippageBps: VERIFY_SLIPPAGE_BPS,
    taker: loadTaker(),
  } as const satisfies ZeroXExactSellRequest;
  const client = createZeroXSwapClient();
  const price = await client.getPrice(request);

  console.log("0x Base Mainnet sanitized indicative price");
  console.log(`pair=${request.sellAsset.symbol}->${request.buyAsset.symbol}`);
  console.log(`chainId=${request.chainId}`);
  console.log(`requestedRawSellAmount=${request.sellAmount}`);
  console.log(`requestedSlippageBps=${request.slippageBps}`);
  console.log(`priceRawBuyAmount=${price.buyAmount}`);
  console.log(`priceAllowanceIssue=${issueStatus(price.issues.allowance)}`);
  console.log(`priceBalanceIssue=${issueStatus(price.issues.balance)}`);
  console.log(`priceSimulationIncomplete=${price.issues.simulationIncomplete}`);
  console.log(`priceBlockNumber=${price.blockNumber}`);
  console.log(`priceRouteSources=${price.route.fills.map((fill) => fill.source).join(",")}`);

  const quote = await createZeroXExecutionQuoteService(client).getQuote(request);

  console.log("0x Base Mainnet sanitized firm execution quote");
  console.log("bstocksAccess=authorized");
  console.log(`pair=${quote.sellAsset.symbol}->${quote.buyAsset.symbol}`);
  console.log(`chainId=${quote.chainId}`);
  console.log(`requestedRawSellAmount=${quote.requestedRawSellAmount}`);
  console.log(`requestedSlippageBps=${quote.slippageBps}`);
  console.log(`quoteRawSellAmount=${quote.quotedRawSellAmount}`);
  console.log(`quoteRawBuyAmount=${quote.quotedRawBuyAmount}`);
  console.log(`quoteB20EconomicBuyAmount=${quote.quotedB20EconomicBuyAmount}`);
  console.log(`allowanceIssue=${issueStatus(quote.issues.allowance)}`);
  console.log(`balanceIssue=${issueStatus(quote.issues.balance)}`);
  console.log(`simulationIncomplete=${quote.issues.simulationIncomplete}`);
  console.log(`transactionTarget=${quote.transaction.target}`);
  console.log(`quoteBlockNumber=${quote.quoteBlockNumber}`);
  console.log(`routeSources=${quote.routeSourceNames.join(",")}`);
  console.log("transactionSubmitted=false");
  console.log("approvalCreated=false");
}

try {
  await main();
} catch (error) {
  printFailure(error);
  process.exitCode = 1;
}

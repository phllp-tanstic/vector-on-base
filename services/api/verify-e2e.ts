import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { b20UIAmount } from "@vector/b20";
import {
  buildVectorExecutionIntent,
  buildVectorExecutionPlan,
  encodeVectorExecutionIntent,
  ExecutionPlanValidationError,
  hashVectorExecutionIntent,
  VECTOR_EXECUTOR_EXECUTE_SELECTOR,
  type VectorExecutionIntent,
  type VectorExecutionQuote,
} from "@vector/execution";
import { buildSmartAccountCalls } from "@vector/integrations";
import { validateExecutionCandidate, type ExecutionCandidate } from "@vector/risk";
import {
  AssetRegistry,
  VECTOR_CHAIN_ID,
  type B20VectorAsset,
  type Erc20VectorAsset,
  type EvmAddress,
} from "@vector/shared";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  parseEther,
  type Abi,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONTRACTS = path.join(ROOT, "contracts");
const LOCAL_MNEMONIC = "test test test test test test test test test test test junk";
const SELL_BOUND = parseEther("100");
const ACTUAL_SELL = parseEther("80");
const QUOTED_BUY = parseEther("120");
const MIN_BUY = parseEther("110");
const STARTING_SELL = parseEther("500");

interface FoundryArtifact {
  readonly abi: Abi;
  readonly bytecode: { readonly object: Hex };
}

async function artifact(source: string, contract: string): Promise<FoundryArtifact> {
  const file = path.join(CONTRACTS, "out", source, `${contract}.json`);
  return JSON.parse(await readFile(file, "utf8")) as FoundryArtifact;
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Unable to reserve a local Anvil port."));
        return;
      }
      server.close((error) => (error === undefined ? resolve(address.port) : reject(error)));
    });
  });
}

async function waitForAnvil(url: string, process: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Anvil exited with code ${process.exitCode}.`);
    try {
      const response = await fetch(url, {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "eth_chainId", params: [] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.ok) return;
    } catch {
      // The local process may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for local Anvil.");
}

async function stopAnvil(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => process.once("exit", () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (process.exitCode === null) process.kill("SIGKILL");
        resolve();
      }, 2_000),
    ),
  ]);
}

function solidityIntent(intent: VectorExecutionIntent) {
  return {
    allowanceTarget: intent.allowanceTarget,
    buyToken: intent.buyToken,
    callValue: intent.executionValue,
    deadline: intent.deadline,
    executionData: intent.executionData,
    executionTarget: intent.executionTarget,
    minBuyAmount: intent.minBuyAmount,
    nonce: intent.nonce,
    owner: intent.owner,
    recipient: intent.recipient,
    sellAmount: intent.sellAmount,
    sellToken: intent.sellToken,
  };
}

async function main(): Promise<void> {
  const build = spawnSync("forge", ["build"], { cwd: CONTRACTS, encoding: "utf8" });
  if (build.status !== 0) throw new Error(build.stderr || build.stdout || "forge build failed");

  const port = await availablePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn(
    "anvil",
    [
      "--silent",
      "--port",
      String(port),
      "--chain-id",
      String(VECTOR_CHAIN_ID),
      "--mnemonic",
      LOCAL_MNEMONIC,
    ],
    { stdio: "ignore" },
  );

  try {
    await waitForAnvil(rpcUrl, anvil);
    const chain = defineChain({
      id: VECTOR_CHAIN_ID,
      name: "LOCAL AUTHORIZATION HARNESS",
      nativeCurrency: { decimals: 18, name: "Local Ether", symbol: "LETH" },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const account = mnemonicToAccount(LOCAL_MNEMONIC);
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

    const [tokenArtifact, routerArtifact, executorArtifact, harnessArtifact] = await Promise.all([
      artifact("MockERC20.sol", "MockERC20"),
      artifact("MockExecutionRouter.sol", "MockExecutionRouter"),
      artifact("VectorExecutor.sol", "VectorExecutor"),
      artifact("LocalAuthorizationHarness.sol", "LocalAuthorizationHarness"),
    ]);

    async function deploy(
      abi: Abi,
      bytecode: Hex,
      args: readonly unknown[] = [],
    ): Promise<EvmAddress> {
      const hash = await walletClient.deployContract({ abi, args, bytecode });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success");
      assert.ok(receipt.contractAddress);
      return getAddress(receipt.contractAddress) as EvmAddress;
    }

    const sellToken = await deploy(tokenArtifact.abi, tokenArtifact.bytecode.object, [
      "LOCAL MOCK SELL",
      "LMSELL",
    ]);
    const buyToken = await deploy(tokenArtifact.abi, tokenArtifact.bytecode.object, [
      "LOCAL MOCK BUY",
      "LMBUY",
    ]);
    const router = await deploy(routerArtifact.abi, routerArtifact.bytecode.object);
    const unapprovedRouter = await deploy(routerArtifact.abi, routerArtifact.bytecode.object);
    const executor = await deploy(executorArtifact.abi, executorArtifact.bytecode.object, [
      account.address,
    ]);
    const harness = await deploy(harnessArtifact.abi, harnessArtifact.bytecode.object, [
      account.address,
    ]);

    async function write(
      address: EvmAddress,
      abi: Abi,
      functionName: string,
      args: readonly unknown[],
    ) {
      const hash = await walletClient.writeContract({
        abi,
        address,
        args,
        functionName,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "success");
      return receipt;
    }

    await write(executor, executorArtifact.abi, "setSupportedAsset", [sellToken, true]);
    await write(executor, executorArtifact.abi, "setSupportedAsset", [buyToken, true]);
    await write(executor, executorArtifact.abi, "setExecutionTargetApproval", [router, true]);
    await write(executor, executorArtifact.abi, "setAllowanceTargetApproval", [router, true]);
    await write(sellToken, tokenArtifact.abi, "mint", [harness, STARTING_SELL]);

    const block = await publicClient.getBlock();
    const currentTimestamp = block.timestamp;
    const deadline = currentTimestamp + 300n;
    const sellAsset = Object.freeze({
      assetStandard: "ERC20",
      decimals: 18,
      enabled: true,
      name: "LOCAL MOCK SELL TOKEN",
      symbol: "LMSELL",
      tokenAddress: sellToken,
    }) satisfies Erc20VectorAsset;
    const buyAsset = Object.freeze({
      assetStandard: "B20",
      decimals: 18,
      enabled: true,
      name: "LOCAL MOCK B20 BUY TOKEN",
      symbol: "LMBUY",
      tokenAddress: buyToken,
      underlyingTicker: "LOCAL",
    }) satisfies B20VectorAsset;
    const registry = new AssetRegistry([sellAsset, buyAsset]);
    const executionData = encodeFunctionData({
      abi: routerArtifact.abi,
      functionName: "executeSwap",
      args: [sellToken, buyToken, executor, executor, ACTUAL_SELL, QUOTED_BUY],
    });
    const quote = Object.freeze({
      allowanceTarget: router,
      buyAsset,
      chainId: VECTOR_CHAIN_ID,
      issues: {
        allowance: null,
        balance: null,
        invalidSourcesPassed: [],
        simulationIncomplete: false,
      },
      kind: "firm-execution-quote",
      minBuyAmount: MIN_BUY,
      quoteBlockNumber: block.number,
      quoteTimestamp: new Date(Number(currentTimestamp) * 1_000).toISOString(),
      quotedB20EconomicBuyAmount: b20UIAmount(QUOTED_BUY),
      quotedRawBuyAmount: QUOTED_BUY,
      quotedRawSellAmount: SELL_BOUND,
      requestedRawSellAmount: SELL_BOUND,
      route: { fills: [] },
      routeSourceNames: ["LOCAL_MOCK_ROUTER_FIXTURE"],
      sellAsset,
      slippageBps: 30,
      source: "0x",
      taker: executor,
      transaction: { data: executionData, target: router, value: 0n },
    }) satisfies VectorExecutionQuote;
    const candidateValue = {
      buyAsset,
      chainId: VECTOR_CHAIN_ID,
      constraints: {
        maximumSingleAssetExposureBps: 10_000,
        maximumSlippageBps: 30,
        minimumReserve: { rawAmount: 0n, token: sellAsset },
      },
      currentTimestamp,
      deadline,
      executionQuote: quote,
      executionReferenceValuation: {
        kind: "REFERENCE_VALUATION",
        proposedBuyReferenceValue: QUOTED_BUY,
        quotedSellReferenceValue: SELL_BOUND,
        referenceValueDecimals: 18,
      },
      owner: harness,
      portfolioSnapshot: {
        account: harness,
        positions: [
          { asset: sellAsset, rawBalance: STARTING_SELL },
          { asset: buyAsset, rawBalance: 0n },
        ],
        referenceValueDecimals: 18,
        totalReferenceValue: STARTING_SELL,
        valuedPositions: [
          { asset: sellAsset, referenceValue: STARTING_SELL },
          { asset: buyAsset, referenceValue: 0n },
        ],
      },
      requestedRawSellAmount: SELL_BOUND,
      sellAsset,
    } as const satisfies ExecutionCandidate & { readonly executionQuote: VectorExecutionQuote };
    const candidate = Object.freeze(candidateValue);
    const riskResult = validateExecutionCandidate(candidate, registry);
    assert.equal(riskResult.status, "ACCEPTED");
    const planInput = {
      assetRegistry: registry,
      candidate,
      currentTimestamp,
      deadline,
      nonce: 42n,
      recipient: account.address,
      riskResult,
      smartAccountAddress: harness,
      trustedConfig: {
        approvedAllowanceTargets: [router],
        approvedExecutionTargets: [router],
        environment: "LOCAL_AUTHORIZATION_HARNESS" as const,
        executorAddress: executor,
      },
    };
    const intent = buildVectorExecutionIntent(planInput);
    const plan = buildVectorExecutionPlan(planInput);
    const calls = buildSmartAccountCalls(plan);

    assert.equal(intent.minBuyAmount, quote.minBuyAmount);
    assert.equal(intent.nonce, 42n);
    assert.equal(calls.length, 2);
    assert.equal(plan.calls[0].amount, SELL_BOUND);
    assert.equal(plan.calls[0].spender, executor);

    const artifactCalldata = encodeFunctionData({
      abi: executorArtifact.abi,
      functionName: "execute",
      args: [solidityIntent(intent)],
    });
    assert.equal(plan.calls[1].data, artifactCalldata);
    assert.equal(artifactCalldata.slice(0, 10), VECTOR_EXECUTOR_EXECUTE_SELECTOR);

    const expectedExecutionId = hashVectorExecutionIntent(intent, executor);
    const contractExecutionId = await publicClient.readContract({
      abi: executorArtifact.abi,
      address: executor,
      args: [solidityIntent(intent)],
      functionName: "hashExecutionIntent",
    });
    assert.equal(contractExecutionId, expectedExecutionId);

    const batchHash = await walletClient.writeContract({
      abi: harnessArtifact.abi,
      address: harness,
      args: [calls],
      functionName: "executeBatch",
      gas: 5_000_000n,
    });
    const batchReceipt = await publicClient.waitForTransactionReceipt({ hash: batchHash });
    assert.equal(batchReceipt.status, "success");

    const executionLog = batchReceipt.logs
      .filter((log) => log.address.toLowerCase() === executor.toLowerCase())
      .map((log) => {
        try {
          return decodeEventLog({ abi: executorArtifact.abi, data: log.data, topics: log.topics });
        } catch {
          return undefined;
        }
      })
      .find((log) => log?.eventName === "IntentExecuted");
    assert.ok(executionLog);
    const eventArgs = executionLog.args as unknown as {
      actualBuyAmount: bigint;
      actualSellAmount: bigint;
      executionId: Hex;
      maximumSellAmount: bigint;
    };
    assert.equal(eventArgs.executionId, expectedExecutionId);
    assert.equal(eventArgs.actualSellAmount, ACTUAL_SELL);
    assert.equal(eventArgs.actualBuyAmount, QUOTED_BUY);
    assert.equal(eventArgs.maximumSellAmount, SELL_BOUND);

    const [
      recipientBuy,
      executorSell,
      executorBuy,
      routerSell,
      routerAllowance,
      routerTotalSellPulled,
      nonceConsumed,
    ] = await Promise.all([
      publicClient.readContract({
        abi: erc20Abi,
        address: buyToken,
        args: [account.address],
        functionName: "balanceOf",
      }),
      publicClient.readContract({
        abi: erc20Abi,
        address: sellToken,
        args: [executor],
        functionName: "balanceOf",
      }),
      publicClient.readContract({
        abi: erc20Abi,
        address: buyToken,
        args: [executor],
        functionName: "balanceOf",
      }),
      publicClient.readContract({
        abi: erc20Abi,
        address: sellToken,
        args: [router],
        functionName: "balanceOf",
      }),
      publicClient.readContract({
        abi: erc20Abi,
        address: sellToken,
        args: [executor, router],
        functionName: "allowance",
      }),
      publicClient.readContract({
        abi: routerArtifact.abi,
        address: router,
        functionName: "totalSellPulled",
      }),
      publicClient.readContract({
        abi: executorArtifact.abi,
        address: executor,
        args: [harness, 42n],
        functionName: "usedNonce",
      }),
    ]);
    assert.equal(recipientBuy, QUOTED_BUY);
    assert.ok(recipientBuy >= MIN_BUY);
    assert.equal(executorSell, 0n);
    assert.equal(executorBuy, 0n);
    assert.equal(routerSell, ACTUAL_SELL);
    assert.equal(routerAllowance, 0n);
    assert.equal(routerTotalSellPulled, ACTUAL_SELL);
    assert.equal(nonceConsumed, true);
    assert.equal(
      await publicClient.readContract({
        abi: erc20Abi,
        address: sellToken,
        args: [harness],
        functionName: "balanceOf",
      }),
      STARTING_SELL - ACTUAL_SELL,
    );
    assert.equal(
      await publicClient.readContract({
        abi: routerArtifact.abi,
        address: router,
        functionName: "maximumAllowanceObserved",
      }),
      SELL_BOUND,
    );

    async function expectBatchRevert(
      failureCalls: readonly { to: EvmAddress; value: bigint; data: Hex }[],
    ) {
      const hash = await walletClient.writeContract({
        abi: harnessArtifact.abi,
        address: harness,
        args: [failureCalls],
        functionName: "executeBatch",
        gas: 5_000_000n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      assert.equal(receipt.status, "reverted");
    }

    await expectBatchRevert(calls); // reused nonce
    const approvalCall = calls[0];
    await expectBatchRevert([
      approvalCall,
      { ...calls[1], data: encodeVectorExecutionIntent({ ...intent, deadline: 0n, nonce: 43n }) },
    ]);
    const belowMinimumData = encodeFunctionData({
      abi: routerArtifact.abi,
      functionName: "executeSwap",
      args: [sellToken, buyToken, executor, executor, ACTUAL_SELL, MIN_BUY - 1n],
    });
    await expectBatchRevert([
      approvalCall,
      {
        ...calls[1],
        data: encodeVectorExecutionIntent({
          ...intent,
          executionData: belowMinimumData,
          nonce: 44n,
        }),
      },
    ]);
    await expectBatchRevert([
      approvalCall,
      {
        ...calls[1],
        data: encodeVectorExecutionIntent({
          ...intent,
          allowanceTarget: unapprovedRouter,
          executionTarget: unapprovedRouter,
          nonce: 45n,
        }),
      },
    ]);

    const rejectedCandidate = { ...candidate, currentTimestamp: candidate.deadline + 1n };
    const rejectedRisk = validateExecutionCandidate(rejectedCandidate, registry);
    assert.equal(rejectedRisk.status, "REJECTED");
    assert.throws(
      () =>
        buildVectorExecutionIntent({
          ...planInput,
          candidate: rejectedCandidate,
          riskResult: rejectedRisk,
        }),
      (error: unknown) =>
        error instanceof ExecutionPlanValidationError && error.code === "RISK_NOT_ACCEPTED",
    );
    assert.throws(
      () => buildVectorExecutionIntent({ ...planInput, smartAccountAddress: account.address }),
      (error: unknown) =>
        error instanceof ExecutionPlanValidationError && error.code === "OWNER_MISMATCH",
    );
    assert.throws(
      () =>
        buildVectorExecutionIntent({
          ...planInput,
          candidate: {
            ...candidate,
            executionQuote: { ...quote, buyAsset: { ...buyAsset, tokenAddress: sellToken } },
          },
        }),
      (error: unknown) =>
        error instanceof ExecutionPlanValidationError && error.code === "QUOTE_INVALID",
    );
    assert.equal(plan.calls[0].amount, plan.intent.sellAmount);

    console.log("Vector local execution E2E passed");
    console.log("network=anvil");
    console.log("authorizationMode=LOCAL_AUTHORIZATION_HARNESS");
    console.log(`riskStatus=${riskResult.status}`);
    console.log(`calls=${calls.length}`);
    console.log(`sellAmount=${SELL_BOUND}`);
    console.log(`minBuyAmount=${MIN_BUY}`);
    console.log(`actualBuyAmount=${eventArgs.actualBuyAmount}`);
    console.log("nonceConsumed=true");
    console.log("allowanceCleared=true");
    console.log("recipientReceived=true");
    console.log(`executorResidualSell=${executorSell}`);
    console.log(`executorResidualBuy=${executorBuy}`);
    console.log(
      "failureScenarios=RISK_REJECTED,WRONG_OWNER,EXPIRED,REUSED_NONCE,BELOW_MINIMUM,UNAPPROVED_ROUTER,WRONG_QUOTE_TOKEN,EXCESS_APPROVAL_PREVENTED",
    );
    console.log("transactionSubmittedToBase=false");
  } finally {
    await stopAnvil(anvil);
  }
}

await main();

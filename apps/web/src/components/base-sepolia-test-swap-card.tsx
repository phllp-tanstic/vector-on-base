"use client";

import { useSendUserOperation, useWaitForUserOperation } from "@coinbase/cdp-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";

import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_EXPLORER } from "../lib/authorization";
import {
  BASE_SEPOLIA_PUBLIC_RPC_URL,
  BASE_SEPOLIA_TEST_FIXTURES,
  TEST_SWAP_SELL_AMOUNT,
  buildBaseSepoliaTestSwapRequest,
  canSubmitBaseSepoliaTestSwap,
  ERC20_TEST_ABI,
  prepareBaseSepoliaTestSwap,
  testSwapErrorMessage,
  type BaseSepoliaTestSwapPlan,
} from "../lib/base-sepolia-test-swap";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_PUBLIC_RPC_URL),
});

interface TestTokenBalances {
  readonly sell: bigint;
  readonly buy: bigint;
}

function formatDeadline(deadline: bigint): string {
  return new Date(Number(deadline) * 1_000).toLocaleString();
}

export function BaseSepoliaTestSwapCard({
  smartAccountAddress,
}: Readonly<{ smartAccountAddress: `0x${string}` | undefined }>) {
  const { sendUserOperation, status: sendStatus, error: sendError } = useSendUserOperation();
  const [plan, setPlan] = useState<BaseSepoliaTestSwapPlan>();
  const [balances, setBalances] = useState<TestTokenBalances>();
  const [balanceError, setBalanceError] = useState<string>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmittedPlan, setHasSubmittedPlan] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [userOperationHash, setUserOperationHash] = useState<`0x${string}`>();
  const [balancesRefreshedFor, setBalancesRefreshedFor] = useState<string>();
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1_000)));
  const submissionLock = useRef(false);

  const receipt = useWaitForUserOperation({
    ...(userOperationHash ? { userOperationHash } : {}),
    ...(smartAccountAddress ? { evmSmartAccount: smartAccountAddress } : {}),
    network: "base-sepolia",
    enabled: Boolean(userOperationHash && smartAccountAddress),
  });
  const isPending =
    isSubmitting ||
    sendStatus === "pending" ||
    Boolean(userOperationHash && receipt.status === "pending");

  const refreshBalances = useCallback(async (): Promise<boolean> => {
    if (!smartAccountAddress) {
      setBalances(undefined);
      return false;
    }
    setIsRefreshing(true);
    setBalanceError(undefined);
    try {
      const [sell, buy] = await Promise.all([
        publicClient.readContract({
          address: BASE_SEPOLIA_TEST_FIXTURES.sellToken,
          abi: ERC20_TEST_ABI,
          functionName: "balanceOf",
          args: [smartAccountAddress],
        }),
        publicClient.readContract({
          address: BASE_SEPOLIA_TEST_FIXTURES.buyToken,
          abi: ERC20_TEST_ABI,
          functionName: "balanceOf",
          args: [smartAccountAddress],
        }),
      ]);
      setBalances({ sell, buy });
      return true;
    } catch (error) {
      setBalanceError(
        `Could not read Base Sepolia token balances: ${testSwapErrorMessage(error).replace("Test swap simulation or submission failed: ", "")}`,
      );
      return false;
    } finally {
      setIsRefreshing(false);
    }
  }, [smartAccountAddress]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setNowSeconds(BigInt(Math.floor(Date.now() / 1_000))),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const transactionHash = userOperationHash ? receipt.data?.transactionHash : undefined;
    if (receipt.status === "success" && transactionHash) {
      void refreshBalances().then((refreshed) => {
        if (refreshed) setBalancesRefreshedFor(transactionHash);
      });
    }
  }, [userOperationHash, receipt.status, receipt.data?.transactionHash, refreshBalances]);

  function prepareSwap() {
    if (!smartAccountAddress || isPending) return;
    setLocalError(undefined);
    setUserOperationHash(undefined);
    setBalancesRefreshedFor(undefined);
    setHasSubmittedPlan(false);
    const prepared = prepareBaseSepoliaTestSwap({
      explicitUserAction: true,
      smartAccountAddress,
      chainId: BASE_SEPOLIA_CHAIN_ID,
    });
    if (prepared) setPlan(prepared);
  }

  async function authorizeAndExecute() {
    if (
      submissionLock.current ||
      !plan ||
      !canSubmitBaseSepoliaTestSwap(
        smartAccountAddress,
        isPending,
        plan,
        nowSeconds,
        balances?.sell,
      ) ||
      !smartAccountAddress ||
      hasSubmittedPlan
    ) {
      return;
    }
    setLocalError(undefined);
    setUserOperationHash(undefined);
    setIsSubmitting(true);
    setHasSubmittedPlan(true);
    submissionLock.current = true;
    try {
      const request = buildBaseSepoliaTestSwapRequest(true, smartAccountAddress, plan);
      if (!request) return;
      const submission = await sendUserOperation(request);
      setUserOperationHash(submission.userOperationHash);
    } catch (error) {
      setHasSubmittedPlan(false);
      setLocalError(testSwapErrorMessage(error));
    } finally {
      submissionLock.current = false;
      setIsSubmitting(false);
    }
  }

  const canSubmit =
    !hasSubmittedPlan &&
    canSubmitBaseSepoliaTestSwap(smartAccountAddress, isPending, plan, nowSeconds, balances?.sell);
  const displayedStatus = userOperationHash
    ? receipt.status === "idle"
      ? sendStatus
      : receipt.status
    : "idle";
  const expired = Boolean(plan && plan.intent.deadline <= nowSeconds);
  const insufficient = Boolean(plan && balances && balances.sell < TEST_SWAP_SELL_AMOUNT);
  const transactionHash = userOperationHash ? receipt.data?.transactionHash : undefined;
  const receiptSucceeded = Boolean(userOperationHash && receipt.status === "success");
  const receiptError = userOperationHash ? receipt.error : undefined;
  const relevantSendError = hasSubmittedPlan ? sendError : undefined;

  return (
    <div className="card test-swap-card">
      <p className="eyebrow">Base Sepolia fixture · real token movement</p>
      <h2>Explicit test swap</h2>
      <p className="muted">
        This is separate from Test Authorization. It moves exactly 1 mUSDC through the deployed
        VectorExecutor and requires two deliberate clicks: prepare, then authorize.
      </p>

      <div className="balance-grid" aria-label="Smart Account fixture token balances">
        <div>
          <span>mUSDC balance</span>
          <strong>{balances ? formatUnits(balances.sell, 6) : "—"}</strong>
        </div>
        <div>
          <span>NOTB20 balance</span>
          <strong>{balances ? formatUnits(balances.buy, 8) : "—"}</strong>
        </div>
      </div>
      <button
        className="secondary compact"
        type="button"
        onClick={() => void refreshBalances()}
        disabled={!smartAccountAddress || isRefreshing}
      >
        {isRefreshing ? "Refreshing balances…" : "Refresh balances"}
      </button>
      {balanceError && <p className="error">{balanceError}</p>}

      <button type="button" onClick={prepareSwap} disabled={!smartAccountAddress || isPending}>
        {plan ? "Prepare a fresh test swap" : "Prepare test swap"}
      </button>

      {plan && (
        <div className="confirmation" aria-label="Test swap confirmation">
          <h3>Confirm exact instruction</h3>
          <dl>
            <dt>Sell</dt>
            <dd>1 mUSDC (1,000,000 base units)</dd>
            <dt>Minimum receive</dt>
            <dd>1 NOTB20 (100,000,000 base units)</dd>
            <dt>Owner / recipient</dt>
            <dd>{plan.intent.owner}</dd>
            <dt>VectorExecutor</dt>
            <dd>{BASE_SEPOLIA_TEST_FIXTURES.executor}</dd>
            <dt>mUSDC</dt>
            <dd>{BASE_SEPOLIA_TEST_FIXTURES.sellToken}</dd>
            <dt>NOTB20</dt>
            <dd>{BASE_SEPOLIA_TEST_FIXTURES.buyToken}</dd>
            <dt>Execution / allowance target</dt>
            <dd>{BASE_SEPOLIA_TEST_FIXTURES.router}</dd>
            <dt>Native call value</dt>
            <dd>0</dd>
            <dt>Nonce</dt>
            <dd>{plan.intent.nonce.toString()}</dd>
            <dt>Deadline</dt>
            <dd>
              {formatDeadline(plan.intent.deadline)} ({plan.intent.deadline.toString()})
            </dd>
            <dt>Time remaining</dt>
            <dd>
              {plan.intent.deadline > nowSeconds
                ? `${(plan.intent.deadline - nowSeconds).toString()} seconds`
                : "Expired"}
            </dd>
          </dl>
          <ol className="call-sequence">
            <li>mUSDC.approve(VectorExecutor, 1,000,000)</li>
            <li>
              VectorExecutor.execute(intent), which calls router.executeSwap(VectorExecutor,
              VectorExecutor, 1,000,000)
            </li>
          </ol>
          {expired && <p className="error">This plan expired. Prepare a fresh test swap.</p>}
          {insufficient && (
            <p className="error">At least 1 mUSDC is required in the Smart Account.</p>
          )}
          <button type="button" onClick={() => void authorizeAndExecute()} disabled={!canSubmit}>
            {isPending ? "Authorization or execution pending…" : "Authorize and execute"}
          </button>
        </div>
      )}

      <p className="status">UserOperation status: {displayedStatus}</p>
      {userOperationHash && (
        <p className="hash-line">
          UserOperation: <code>{userOperationHash}</code>
        </p>
      )}
      {transactionHash && (
        <p className="hash-line">
          Transaction: <code>{transactionHash}</code>{" "}
          <a
            href={`${BASE_SEPOLIA_EXPLORER}/tx/${transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View on BaseScan
          </a>
        </p>
      )}
      {receiptSucceeded && (
        <p className="success">
          {transactionHash && balancesRefreshedFor === transactionHash
            ? "Test swap succeeded. The receipt is confirmed and the displayed balances were refreshed."
            : "Test swap receipt succeeded. Refreshing the displayed balances…"}
        </p>
      )}
      {(localError || relevantSendError || receiptError) && (
        <p className="error">
          {localError ??
            (relevantSendError ? testSwapErrorMessage(relevantSendError) : undefined) ??
            (receiptError ? testSwapErrorMessage(receiptError) : undefined)}
        </p>
      )}
    </div>
  );
}

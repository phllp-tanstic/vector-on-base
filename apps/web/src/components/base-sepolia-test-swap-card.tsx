"use client";

import { useSendUserOperation, useWaitForUserOperation } from "@coinbase/cdp-hooks";
import type { EndUserEvmSmartAccount } from "@coinbase/cdp-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";

import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_EXPLORER, asEvmAddress } from "../lib/authorization";
import {
  BASE_SEPOLIA_PUBLIC_RPC_URL,
  BASE_SEPOLIA_TEST_FIXTURES,
  TEST_SWAP_SELL_AMOUNT,
  buildBaseSepoliaTestSwapRequest,
  buildConfirmedTestSwapReceipt,
  canSubmitBaseSepoliaTestSwap,
  ERC20_TEST_ABI,
  prepareBaseSepoliaTestSwap,
  testSwapErrorMessage,
  type BaseSepoliaTestSwapPlan,
} from "../lib/base-sepolia-test-swap";
import {
  DEMO_PORTFOLIO,
  type ExecutableThesis,
  type ThesisRiskResult,
  type ThesisStatus,
} from "../lib/executable-thesis";
import type { ThesisExecutionRecord } from "../lib/persisted-thesis";
import { CopyableValue } from "./copyable-value";

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
  smartAccount,
  thesis,
  risk,
  onStatusChange,
  onConfirmedExecution,
}: Readonly<{
  smartAccount: EndUserEvmSmartAccount | undefined;
  thesis: ExecutableThesis;
  risk: ThesisRiskResult;
  onStatusChange: (status: ThesisStatus) => void;
  onConfirmedExecution?: (record: Omit<ThesisExecutionRecord, "thesisId">) => void;
}>) {
  const smartAccountAddress = asEvmAddress(smartAccount?.address);
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
  const [preExecutionBalances, setPreExecutionBalances] = useState<TestTokenBalances>();
  const [confirmedAt, setConfirmedAt] = useState<string>();
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1_000)));
  const submissionLock = useRef(false);
  const recordedTransaction = useRef<string | undefined>(undefined);

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
          address: BASE_SEPOLIA_TEST_FIXTURES.mockUsdc,
          abi: ERC20_TEST_ABI,
          functionName: "balanceOf",
          args: [smartAccountAddress],
        }),
        publicClient.readContract({
          address: BASE_SEPOLIA_TEST_FIXTURES.mockB20LikeToken,
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
      onStatusChange("EXECUTED");
      void refreshBalances().then((refreshed) => {
        if (refreshed) {
          setBalancesRefreshedFor(transactionHash);
          setConfirmedAt(new Date().toISOString());
        }
      });
    }
    if (receipt.status === "error") onStatusChange("FAILED");
  }, [
    userOperationHash,
    receipt.status,
    receipt.data?.transactionHash,
    refreshBalances,
    onStatusChange,
  ]);

  function prepareSwap() {
    if (!smartAccountAddress || isPending) return;
    setLocalError(undefined);
    setUserOperationHash(undefined);
    setBalancesRefreshedFor(undefined);
    setHasSubmittedPlan(false);
    setConfirmedAt(undefined);
    try {
      const prepared = prepareBaseSepoliaTestSwap({
        explicitUserAction: true,
        smartAccountAddress,
        chainId: BASE_SEPOLIA_CHAIN_ID,
      });
      if (prepared) setPlan(prepared);
    } catch (error) {
      setLocalError(testSwapErrorMessage(error));
    }
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
      !smartAccount ||
      !smartAccountAddress ||
      hasSubmittedPlan
    ) {
      return;
    }
    setLocalError(undefined);
    setUserOperationHash(undefined);
    setIsSubmitting(true);
    setHasSubmittedPlan(true);
    onStatusChange("AUTHORIZING");
    submissionLock.current = true;
    try {
      const request = buildBaseSepoliaTestSwapRequest(true, smartAccount, plan);
      if (!request) return;
      setPreExecutionBalances(balances);
      const submission = await sendUserOperation(request);
      setUserOperationHash(submission.userOperationHash);
    } catch (error) {
      setHasSubmittedPlan(false);
      setLocalError(testSwapErrorMessage(error));
      onStatusChange("FAILED");
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
  const confirmedReceipt = buildConfirmedTestSwapReceipt({
    afterBuyBalance: balances?.buy,
    beforeBuyBalance: preExecutionBalances?.buy,
    confirmedAt,
    receiptStatus: receipt.status,
    transactionHash,
    userOperationHash,
  });
  const progressLabel = receiptSucceeded
    ? "Confirmed"
    : userOperationHash
      ? "Waiting for Base confirmation…"
      : isSubmitting || sendStatus === "pending"
        ? "Submitting UserOperation…"
        : plan
          ? "Ready for authorization"
          : "Prepare execution to review the exact calls";

  useEffect(() => {
    if (!confirmedReceipt || !smartAccountAddress || !onConfirmedExecution) return;
    if (recordedTransaction.current === confirmedReceipt.transactionHash) return;
    recordedTransaction.current = confirmedReceipt.transactionHash;
    onConfirmedExecution({
      executionId: confirmedReceipt.transactionHash,
      network: "base-sepolia",
      status: "CONFIRMED",
      sellAmount: "1 mUSDC",
      receiveAmount: `${formatUnits(confirmedReceipt.receivedRawBuyAmount, 8)} NOTB20`,
      executedAt: confirmedReceipt.confirmedAt,
      smartAccount: smartAccountAddress,
      userOperationHash: confirmedReceipt.userOperationHash,
      transactionHash: confirmedReceipt.transactionHash,
    });
  }, [confirmedReceipt, onConfirmedExecution, smartAccountAddress]);

  return (
    <section className="surface test-swap-card">
      <div className="testnet-banner">
        <strong>BASE SEPOLIA LIVE DEMO</strong>
        <span>TEST ASSETS</span>
        <span>NO REAL STOCKS</span>
      </div>
      <p className="eyebrow">Execution preview</p>
      <h2>You are authorizing</h2>
      <p className="muted">
        The NVDA thesis has passed deterministic risk review. This isolated testnet settlement
        proves the same authorization boundary with mUSDC → NOTB20.
      </p>

      <div className="balance-grid" aria-label="Smart Account fixture token balances">
        <div>
          <span>mUSDC balance</span>
          <strong>
            {balances ? formatUnits(balances.sell, 6) : isRefreshing ? "Reading…" : "—"}
          </strong>
        </div>
        <div>
          <span>NOTB20 balance</span>
          <strong>
            {balances ? formatUnits(balances.buy, 8) : isRefreshing ? "Reading…" : "—"}
          </strong>
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
      {balanceError && (
        <p className="error" role="alert">
          {balanceError}
        </p>
      )}

      <button
        type="button"
        onClick={prepareSwap}
        disabled={!smartAccountAddress || isPending || thesis.status !== "READY_FOR_AUTHORIZATION"}
      >
        {plan ? "Prepare a fresh execution" : "Prepare execution"}
      </button>

      {plan && (
        <div className="confirmation" aria-label="Test swap confirmation">
          <div className="authorization-summary">
            <div>
              <span>Sell amount</span>
              <strong>1 mUSDC</strong>
            </div>
            <div>
              <span>Asset</span>
              <strong>NOTB20 test settlement</strong>
            </div>
            <div>
              <span>Minimum receive</span>
              <strong>1 NOTB20</strong>
            </div>
            <div>
              <span>Network</span>
              <strong>Base Sepolia</strong>
            </div>
            <div>
              <span>Deadline</span>
              <strong>{formatDeadline(plan.intent.deadline)}</strong>
            </div>
          </div>
          <div className="call-count">
            <strong>2 onchain calls</strong>
            <span>Both require your explicit authorization</span>
          </div>
          <ol className="call-sequence">
            <li>
              <strong>Exact approval</strong>
              <span>Approve exactly 1 mUSDC to VectorExecutor</span>
            </li>
            <li>
              <strong>Vector execution</strong>
              <span>Execute the reviewed testnet settlement</span>
            </li>
          </ol>
          <details className="technical-details">
            <summary>Technical details</summary>
            <dl>
              <dt>Sell amount</dt>
              <dd>1 mUSDC (1,000,000 base units)</dd>
              <dt>Minimum receive</dt>
              <dd>1 NOTB20 (100,000,000 base units)</dd>
              <dt>Owner / recipient</dt>
              <dd>
                <CopyableValue label="owner address" value={plan.intent.owner} />
              </dd>
              <dt>VectorExecutor</dt>
              <dd>
                <CopyableValue
                  label="VectorExecutor address"
                  value={BASE_SEPOLIA_TEST_FIXTURES.executor}
                />
              </dd>
              <dt>mUSDC</dt>
              <dd>
                <CopyableValue label="mUSDC address" value={BASE_SEPOLIA_TEST_FIXTURES.mockUsdc} />
              </dd>
              <dt>NOTB20</dt>
              <dd>
                <CopyableValue
                  label="NOTB20 address"
                  value={BASE_SEPOLIA_TEST_FIXTURES.mockB20LikeToken}
                />
              </dd>
              <dt>Reviewed test router</dt>
              <dd>
                <CopyableValue label="router address" value={BASE_SEPOLIA_TEST_FIXTURES.router} />
              </dd>
              <dt>Native call value</dt>
              <dd>0</dd>
              <dt>Network</dt>
              <dd>Base Sepolia (84532)</dd>
              <dt>Authorization source</dt>
              <dd>Coinbase user-controlled Smart Account</dd>
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
          </details>
          {expired && (
            <p className="error" role="alert">
              This prepared execution expired. Prepare a fresh execution before authorizing.
            </p>
          )}
          {insufficient && (
            <p className="error" role="alert">
              At least 1 mUSDC is required. Follow the manual testnet setup in docs/BASE_SEPOLIA.md,
              then refresh balances. Vector will not mint or submit automatically.
            </p>
          )}
          <button type="button" onClick={() => void authorizeAndExecute()} disabled={!canSubmit}>
            {isSubmitting
              ? "Submitting UserOperation…"
              : userOperationHash && !receiptSucceeded
                ? "Waiting for Base confirmation…"
                : receiptSucceeded
                  ? "Executed"
                  : "Authorize 2 calls"}
          </button>
        </div>
      )}

      <p className="execution-progress" role="status" aria-live="polite">
        <span aria-hidden="true" className={`progress-dot ${displayedStatus}`} />
        {progressLabel}
      </p>
      {userOperationHash && (
        <p className="hash-line">
          UserOperation: <CopyableValue label="UserOperation hash" value={userOperationHash} />
        </p>
      )}
      {transactionHash && (
        <p className="hash-line">
          Transaction: <CopyableValue label="transaction hash" value={transactionHash} />{" "}
          <a
            href={`${BASE_SEPOLIA_EXPLORER}/tx/${transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View on BaseScan
          </a>
        </p>
      )}
      {receiptSucceeded &&
        (transactionHash && balancesRefreshedFor === transactionHash && confirmedReceipt ? (
          <div className="execution-receipt">
            <div className="receipt-heading">
              <div>
                <p className="eyebrow">Execution receipt</p>
                <h3>Thesis executed</h3>
              </div>
              <span className="risk-state passed">EXECUTED</span>
            </div>
            <dl>
              <dt>Executed thesis</dt>
              <dd>NVDA conditional entry</dd>
              <dt>Asset</dt>
              <dd>NVDA intent · NOTB20 test settlement</dd>
              <dt>Sell amount</dt>
              <dd>1 mUSDC</dd>
              <dt>Received amount</dt>
              <dd>{formatUnits(confirmedReceipt.receivedRawBuyAmount, 8)} NOTB20</dd>
              <dt>Smart Account</dt>
              <dd>
                <CopyableValue label="Smart Account address" value={smartAccountAddress ?? ""} />
              </dd>
              <dt>VectorExecutor</dt>
              <dd>
                <CopyableValue
                  label="VectorExecutor address"
                  value={BASE_SEPOLIA_TEST_FIXTURES.executor}
                />
              </dd>
              <dt>UserOperation hash</dt>
              <dd>
                <CopyableValue
                  label="UserOperation hash"
                  value={confirmedReceipt.userOperationHash}
                />
              </dd>
              <dt>Transaction hash</dt>
              <dd>
                <a
                  href={`${BASE_SEPOLIA_EXPLORER}/tx/${confirmedReceipt.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction on BaseScan
                </a>
              </dd>
              <dt>Network</dt>
              <dd>Base Sepolia (84532)</dd>
              <dt>Timestamp</dt>
              <dd>{new Date(confirmedReceipt.confirmedAt).toLocaleString()}</dd>
            </dl>
            <div className="why-executed">
              <strong>Why this executed</strong>
              <ul>
                <li>Trigger satisfied at ${DEMO_PORTFOLIO.currentReferencePriceUsd}</li>
                <li>${thesis.parameters.reserveUsd.toLocaleString()} reserve preserved</li>
                <li>${risk.executableSizeUsd} position within exposure limit</li>
                <li>{DEMO_PORTFOLIO.quotedSlippagePercent}% slippage within maximum</li>
                <li>User explicitly authorized both calls</li>
              </ul>
            </div>
          </div>
        ) : (
          <p className="success">
            Execution confirmed. Refreshing onchain balances for the final receipt…
          </p>
        ))}
      {(localError || relevantSendError || receiptError) && (
        <p className="error" role="alert">
          {localError ??
            (relevantSendError ? testSwapErrorMessage(relevantSendError) : undefined) ??
            (receiptError ? testSwapErrorMessage(receiptError) : undefined)}
        </p>
      )}
    </section>
  );
}

"use client";

import type { EndUserEvmSmartAccount } from "@coinbase/cdp-core";
import { useSendUserOperation, useWaitForUserOperation } from "@coinbase/cdp-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";

import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_EXPLORER, asEvmAddress } from "../lib/authorization";
import {
  BASE_SEPOLIA_DEMO_FAUCET_ABI,
  DEMO_FAUCET_ADDRESS_ENV_VAR,
  DEMO_FAUCET_CLAIM_AMOUNT,
  buildDemoFaucetClaimRequest,
  demoFaucetErrorMessage,
  deriveDemoFaucetEligibility,
  formatDemoFaucetCooldown,
  loadDemoFaucetConfig,
  prepareDemoFaucetClaim,
  shouldPromoteDemoFaucet,
  type DemoFaucetState,
} from "../lib/base-sepolia-demo-faucet";
import {
  BASE_SEPOLIA_PUBLIC_RPC_URL,
  BASE_SEPOLIA_TEST_FIXTURES,
  ERC20_TEST_ABI,
} from "../lib/base-sepolia-test-swap";
import { CopyableValue } from "./copyable-value";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_PUBLIC_RPC_URL),
});

let configuredFaucetAddress: `0x${string}` | undefined;
let faucetConfigurationError: string | undefined;
try {
  configuredFaucetAddress = loadDemoFaucetConfig({
    [DEMO_FAUCET_ADDRESS_ENV_VAR]: process.env.NEXT_PUBLIC_VECTOR_TEST_DEMO_FAUCET_ADDRESS,
  }).faucetAddress;
} catch (error) {
  faucetConfigurationError = error instanceof Error ? error.message : "Invalid demo faucet config.";
}

interface FaucetSnapshot {
  readonly bytecodeValid: boolean;
  readonly inventory: bigint;
  readonly lastClaimAt: bigint;
}

function stateLabel(
  state: DemoFaucetState,
  availableAt: bigint | undefined,
  nowSeconds: bigint,
): string {
  switch (state) {
    case "CHECKING":
      return "Checking demo token eligibility…";
    case "ELIGIBLE":
      return "Ready to claim";
    case "COOLDOWN":
      return `Demo claim available again in ${formatDemoFaucetCooldown(availableAt ?? nowSeconds, nowSeconds)}`;
    case "CLAIMING":
      return "Awaiting authorization…";
    case "CONFIRMING":
      return "Waiting for Base confirmation…";
    case "CLAIMED":
      return "✓ Demo tokens received";
    case "EMPTY":
      return "Demo faucet temporarily empty";
    case "FAILED":
      return "Demo faucet unavailable";
    default:
      return "Sign in with a Coinbase Smart Account to claim";
  }
}

export function BaseSepoliaDemoFaucet({
  smartAccount,
  musdcBalance,
  onBalanceRefresh,
}: Readonly<{
  smartAccount: EndUserEvmSmartAccount | undefined;
  musdcBalance: bigint | undefined;
  onBalanceRefresh: () => Promise<boolean>;
}>) {
  const smartAccountAddress = asEvmAddress(smartAccount?.address);
  const [snapshot, setSnapshot] = useState<FaucetSnapshot>();
  const [checking, setChecking] = useState(Boolean(smartAccountAddress && configuredFaucetAddress));
  const [phase, setPhase] = useState<DemoFaucetState>();
  const [localError, setLocalError] = useState<string>();
  const [userOperationHash, setUserOperationHash] = useState<`0x${string}`>();
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1_000)));
  const handledTransaction = useRef<string | undefined>(undefined);
  const submissionLock = useRef(false);
  const { sendUserOperation, error: sendError } = useSendUserOperation();
  const receipt = useWaitForUserOperation({
    ...(userOperationHash ? { userOperationHash } : {}),
    ...(smartAccountAddress ? { evmSmartAccount: smartAccountAddress } : {}),
    network: "base-sepolia",
    enabled: Boolean(userOperationHash && smartAccountAddress),
  });

  const refreshEligibility = useCallback(async () => {
    if (!smartAccountAddress || !configuredFaucetAddress) {
      setSnapshot(undefined);
      setChecking(false);
      return;
    }
    setChecking(true);
    setLocalError(undefined);
    try {
      const bytecode = await publicClient.getBytecode({ address: configuredFaucetAddress });
      const bytecodeValid = Boolean(bytecode && bytecode !== "0x");
      if (!bytecodeValid) {
        setSnapshot({ bytecodeValid: false, inventory: 0n, lastClaimAt: 0n });
        return;
      }
      const [inventory, lastClaimAt, mockUsdc, claimAmount] = await Promise.all([
        publicClient.readContract({
          address: BASE_SEPOLIA_TEST_FIXTURES.mockUsdc,
          abi: ERC20_TEST_ABI,
          functionName: "balanceOf",
          args: [configuredFaucetAddress],
        }),
        publicClient.readContract({
          address: configuredFaucetAddress,
          abi: BASE_SEPOLIA_DEMO_FAUCET_ABI,
          functionName: "lastClaimAt",
          args: [smartAccountAddress],
        }),
        publicClient.readContract({
          address: configuredFaucetAddress,
          abi: BASE_SEPOLIA_DEMO_FAUCET_ABI,
          functionName: "mockUSDC",
        }),
        publicClient.readContract({
          address: configuredFaucetAddress,
          abi: BASE_SEPOLIA_DEMO_FAUCET_ABI,
          functionName: "CLAIM_AMOUNT",
        }),
      ]);
      const fixtureMatches =
        mockUsdc.toLowerCase() === BASE_SEPOLIA_TEST_FIXTURES.mockUsdc.toLowerCase() &&
        claimAmount === DEMO_FAUCET_CLAIM_AMOUNT;
      setSnapshot({ bytecodeValid: bytecodeValid && fixtureMatches, inventory, lastClaimAt });
    } catch (error) {
      setSnapshot(undefined);
      setLocalError(demoFaucetErrorMessage(error));
    } finally {
      setChecking(false);
    }
  }, [smartAccountAddress]);

  useEffect(() => {
    void refreshEligibility();
  }, [refreshEligibility]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setNowSeconds(BigInt(Math.floor(Date.now() / 1_000))),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const eligibility = deriveDemoFaucetEligibility({
    authenticated: Boolean(smartAccount),
    smartAccountAddress,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    faucetAddress: configuredFaucetAddress,
    bytecodeValid: snapshot?.bytecodeValid,
    inventory: snapshot?.inventory,
    lastClaimAt: snapshot?.lastClaimAt,
    nowSeconds,
    checking,
  });

  const transactionHash = userOperationHash ? receipt.data?.transactionHash : undefined;
  useEffect(() => {
    if (receipt.status === "pending" && userOperationHash) setPhase("CONFIRMING");
    if (receipt.status === "error") {
      setPhase("FAILED");
      setLocalError(demoFaucetErrorMessage(receipt.error));
    }
    if (
      receipt.status === "success" &&
      transactionHash &&
      handledTransaction.current !== transactionHash
    ) {
      handledTransaction.current = transactionHash;
      setPhase("CLAIMED");
      void Promise.all([onBalanceRefresh(), refreshEligibility()]);
    }
  }, [
    onBalanceRefresh,
    receipt.error,
    receipt.status,
    refreshEligibility,
    transactionHash,
    userOperationHash,
  ]);

  async function claim() {
    if (submissionLock.current || !eligibility.canClaim || !smartAccount || !smartAccountAddress) {
      return;
    }
    submissionLock.current = true;
    setPhase("CLAIMING");
    setLocalError(undefined);
    setUserOperationHash(undefined);
    try {
      const plan = prepareDemoFaucetClaim({
        explicitUserAction: true,
        authenticated: true,
        smartAccountAddress,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        faucetAddress: configuredFaucetAddress,
        eligible: eligibility.canClaim,
      });
      if (!plan) return;
      const request = buildDemoFaucetClaimRequest(true, smartAccount, plan);
      if (!request) return;
      const submission = await sendUserOperation(request);
      setUserOperationHash(submission.userOperationHash);
      setPhase("CONFIRMING");
    } catch (error) {
      setPhase("FAILED");
      setLocalError(demoFaucetErrorMessage(error));
    } finally {
      submissionLock.current = false;
    }
  }

  const displayState = phase ?? eligibility.state;
  const content = (
    <div className="demo-faucet-content">
      {shouldPromoteDemoFaucet(musdcBalance) && (
        <p>
          <strong>You need demo tokens to test execution.</strong>
        </p>
      )}
      <p className="muted">Base Sepolia test token. No monetary value.</p>
      <p className="status" role="status" aria-live="polite">
        {stateLabel(displayState, eligibility.availableAt, nowSeconds)}
      </p>
      {snapshot && (
        <p className="muted compact-copy">
          Faucet inventory: {formatUnits(snapshot.inventory, 6)} mUSDC
        </p>
      )}
      <button
        type="button"
        onClick={() => void claim()}
        disabled={
          !eligibility.canClaim ||
          phase === "CLAIMING" ||
          phase === "CONFIRMING" ||
          phase === "CLAIMED"
        }
      >
        {phase === "CLAIMING"
          ? "Awaiting authorization…"
          : phase === "CONFIRMING"
            ? "Waiting for Base confirmation…"
            : phase === "CLAIMED"
              ? "Demo tokens received"
              : "Get 10 demo mUSDC"}
      </button>
      {(localError || faucetConfigurationError || sendError) && (
        <p className="error" role="alert">
          {localError ??
            faucetConfigurationError ??
            (sendError ? demoFaucetErrorMessage(sendError) : undefined)}
        </p>
      )}
      {displayState === "FAILED" && (
        <button
          className="secondary compact"
          type="button"
          onClick={() => {
            setPhase(undefined);
            void refreshEligibility();
          }}
        >
          Check faucet again
        </button>
      )}
      {userOperationHash && (
        <p className="hash-line">
          UserOperation:{" "}
          <CopyableValue label="Faucet UserOperation hash" value={userOperationHash} />
        </p>
      )}
      {transactionHash && (
        <p className="hash-line">
          Transaction: <CopyableValue label="faucet transaction hash" value={transactionHash} />{" "}
          <a
            href={`${BASE_SEPOLIA_EXPLORER}/tx/${transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View on BaseScan
          </a>
        </p>
      )}
    </div>
  );

  return shouldPromoteDemoFaucet(musdcBalance) ? (
    <aside className="demo-faucet prominent" aria-label="Base Sepolia demo faucet">
      {content}
    </aside>
  ) : (
    <details className="demo-faucet secondary-faucet">
      <summary>Need more Base Sepolia demo mUSDC?</summary>
      {content}
    </details>
  );
}

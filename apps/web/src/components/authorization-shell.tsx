"use client";

import {
  useCreateEvmSmartAccount,
  useCurrentUser,
  useEvmSmartAccounts,
  useSendUserOperation,
  useSignInWithEmail,
  useSignOut,
  useVerifyEmailOTP,
  useWaitForUserOperation,
} from "@coinbase/cdp-hooks";
import { type FormEvent, useState } from "react";

import {
  BASE_SEPOLIA_EXPLORER,
  BASE_SEPOLIA_LABEL,
  BASE_SEPOLIA_NETWORK,
  asEvmAddress,
  buildSafeAuthorizationRequest,
  canTestAuthorization,
  formatSmartAccountAddress,
  toErrorMessage,
} from "../lib/authorization";
import { BaseSepoliaTestSwapCard } from "./base-sepolia-test-swap-card";

export function AuthorizationShell() {
  const { currentUser } = useCurrentUser();
  const { evmSmartAccounts } = useEvmSmartAccounts();
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const { signOut } = useSignOut();
  const { createEvmSmartAccount } = useCreateEvmSmartAccount();
  const { sendUserOperation, status: sendStatus, error: sendError } = useSendUserOperation();

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [flowId, setFlowId] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [userOperationHash, setUserOperationHash] = useState<`0x${string}`>();

  const smartAccount = evmSmartAccounts?.[0];
  const smartAccountAddress = asEvmAddress(smartAccount?.address);
  const receipt = useWaitForUserOperation({
    ...(userOperationHash ? { userOperationHash } : {}),
    ...(smartAccountAddress ? { evmSmartAccount: smartAccountAddress } : {}),
    network: BASE_SEPOLIA_NETWORK,
    enabled: Boolean(userOperationHash && smartAccountAddress),
  });

  async function startEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(undefined);
    try {
      const result = await signInWithEmail({ email });
      setFlowId(result.flowId);
    } catch (error) {
      setLocalError(toErrorMessage(error));
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flowId) return;
    setLocalError(undefined);
    try {
      await verifyEmailOTP({ flowId, otp });
      setOtp("");
      setFlowId(undefined);
    } catch (error) {
      setLocalError(toErrorMessage(error));
    }
  }

  async function createSmartAccount() {
    setLocalError(undefined);
    setIsCreatingAccount(true);
    try {
      await createEvmSmartAccount({ enableSpendPermissions: false });
    } catch (error) {
      setLocalError(toErrorMessage(error));
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function testAuthorization() {
    if (!canTestAuthorization(Boolean(currentUser), smartAccountAddress, sendStatus)) return;
    const request = buildSafeAuthorizationRequest(true, smartAccountAddress);
    if (!request) return;
    setLocalError(undefined);
    setUserOperationHash(undefined);
    try {
      const result = await sendUserOperation(request);
      setUserOperationHash(result.userOperationHash);
    } catch (error) {
      setLocalError(toErrorMessage(error));
    }
  }

  if (!currentUser) {
    return (
      <div className="stack">
        <div className="card">
          <h2>Sign in</h2>
          {!flowId ? (
            <form onSubmit={startEmailSignIn}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <button type="submit">Send one-time code</button>
            </form>
          ) : (
            <form onSubmit={verifyOtp}>
              <label>
                Six-digit code
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  required
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                />
              </label>
              <button type="submit" disabled={!/^[0-9]{6}$/.test(otp)}>
                Verify and sign in
              </button>
            </form>
          )}
          {localError && <p className="error">{localError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <h2>Authenticated account</h2>
        <dl>
          <dt>User</dt>
          <dd>{currentUser.userId}</dd>
          <dt>Smart Account</dt>
          <dd>{formatSmartAccountAddress(smartAccountAddress)}</dd>
          <dt>Network</dt>
          <dd>{BASE_SEPOLIA_LABEL}</dd>
        </dl>
      </div>

      {!smartAccountAddress && (
        <div className="card">
          <h2>Smart Account required</h2>
          <p className="muted">
            New users receive one at sign-in. Existing users without one can create one here. Spend
            Permissions remain disabled.
          </p>
          <button type="button" onClick={createSmartAccount} disabled={isCreatingAccount}>
            {isCreatingAccount ? "Creating…" : "Create Smart Account"}
          </button>
        </div>
      )}

      <div className="card">
        <h2>Safe authorization test</h2>
        <p className="muted">
          This sends one zero-value call to the zero address. It cannot transfer ETH or tokens and
          does not call VectorExecutor.
        </p>
        <div className="actions">
          <button
            type="button"
            onClick={testAuthorization}
            disabled={!canTestAuthorization(true, smartAccountAddress, sendStatus)}
          >
            {sendStatus === "pending" ? "Awaiting authorization…" : "Test Authorization"}
          </button>
          <button className="secondary" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>

        <p className="status">Status: {receipt.status === "idle" ? sendStatus : receipt.status}</p>
        {userOperationHash && (
          <p>
            UserOperation: <code>{userOperationHash}</code>
          </p>
        )}
        {receipt.data?.transactionHash && (
          <p>
            Transaction: <code>{receipt.data.transactionHash}</code>{" "}
            <a
              href={`${BASE_SEPOLIA_EXPLORER}/tx/${receipt.data.transactionHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View on BaseScan
            </a>
          </p>
        )}
        {(localError || sendError || receipt.error) && (
          <p className="error">{localError ?? sendError?.message ?? receipt.error?.message}</p>
        )}
      </div>

      <BaseSepoliaTestSwapCard smartAccount={smartAccount} />
    </div>
  );
}

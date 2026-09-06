"use client";

import {
  useCreateEvmSmartAccount,
  useCurrentUser,
  useEvmSmartAccounts,
  useSignInWithEmail,
  useSignOut,
  useVerifyEmailOTP,
} from "@coinbase/cdp-hooks";
import { type FormEvent, useState } from "react";

import {
  BASE_SEPOLIA_LABEL,
  asEvmAddress,
  formatSmartAccountAddress,
  toErrorMessage,
} from "../lib/authorization";
import { ExecutableThesisWorkspace } from "./executable-thesis-workspace";
import { SharedThesisView, useSharedThesis } from "./shared-thesis-view";
import { CopyableValue } from "./copyable-value";

export function AuthorizationShell() {
  const shared = useSharedThesis();
  const { currentUser } = useCurrentUser();
  const { evmSmartAccounts } = useEvmSmartAccounts();
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const { signOut } = useSignOut();
  const { createEvmSmartAccount } = useCreateEvmSmartAccount();

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [flowId, setFlowId] = useState<string>();
  const [localError, setLocalError] = useState<string>();
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [authState, setAuthState] = useState<string>();

  const smartAccount = evmSmartAccounts?.[0];
  const smartAccountAddress = asEvmAddress(smartAccount?.address);

  async function startEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(undefined);
    setAuthState("Sending one-time code…");
    try {
      const result = await signInWithEmail({ email });
      setFlowId(result.flowId);
    } catch (error) {
      setLocalError(toErrorMessage(error));
    } finally {
      setAuthState(undefined);
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flowId) return;
    setLocalError(undefined);
    setAuthState("Verifying code…");
    try {
      await verifyEmailOTP({ flowId, otp });
      setOtp("");
      setFlowId(undefined);
    } catch (error) {
      setLocalError(toErrorMessage(error));
    } finally {
      setAuthState(undefined);
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

  if (!currentUser) {
    return (
      <div className="stack">
        {shared.payload && <SharedThesisView payload={shared.payload} signedIn={false} />}
        {shared.error && <p className="error shared-link-error">{shared.error}</p>}
        <div className="card sign-in-card">
          <p className="eyebrow">User-controlled authorization</p>
          <h2>Sign in</h2>
          <p className="muted">
            Use an email code to continue. Vector never receives a wallet signing key.
          </p>
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
              <button type="submit" disabled={Boolean(authState)}>
                Send one-time code
              </button>
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
              <button type="submit" disabled={!/^[0-9]{6}$/.test(otp) || Boolean(authState)}>
                Verify and sign in
              </button>
            </form>
          )}
          {authState && (
            <p className="status" role="status">
              {authState}
            </p>
          )}
          {localError && (
            <p className="error" role="alert">
              {localError}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="account-bar">
        <div>
          <span>Smart Account</span>
          {smartAccountAddress ? (
            <CopyableValue label="Smart Account address" value={smartAccountAddress} />
          ) : (
            <strong>{formatSmartAccountAddress(smartAccountAddress)}</strong>
          )}
        </div>
        <div>
          <span>Network</span>
          <strong>{BASE_SEPOLIA_LABEL}</strong>
        </div>
        <button className="text-button" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      {!smartAccountAddress && (
        <div className="card">
          <h2>Smart Account required</h2>
          <p className="muted">
            New users receive one at sign-in. Existing users without one can create one here. Spend
            Permissions remain disabled.
          </p>
          <button type="button" onClick={createSmartAccount} disabled={isCreatingAccount}>
            {isCreatingAccount ? "Creating Smart Account…" : "Create Smart Account"}
          </button>
        </div>
      )}

      {shared.error && <p className="error shared-link-error">{shared.error}</p>}
      {smartAccount && (
        <ExecutableThesisWorkspace
          smartAccount={smartAccount}
          {...(shared.payload ? { sharedPayload: shared.payload } : {})}
        />
      )}
    </div>
  );
}

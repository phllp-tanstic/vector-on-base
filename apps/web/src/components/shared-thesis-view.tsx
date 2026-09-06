"use client";

import { useEffect, useState } from "react";

import { decodeSharePayload, type PublicThesisPayload } from "../lib/persisted-thesis";
import { CopyableValue } from "./copyable-value";

export function useSharedThesis(): Readonly<{
  payload?: PublicThesisPayload;
  error?: string;
}> {
  const [state, setState] = useState<{ payload?: PublicThesisPayload; error?: string }>({});
  useEffect(() => {
    const encoded = new URLSearchParams(window.location.search).get("thesis");
    if (!encoded) return;
    try {
      setState({ payload: decodeSharePayload(encoded) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setState({
        error: /Unsupported thesis version|Unsupported thesis schema/u.test(message)
          ? "This shared thesis uses an unsupported version. Ask the creator for a new link. Nothing was imported."
          : "This shared thesis link is invalid or incomplete. Ask the creator for a new link. Nothing was imported.",
      });
    }
  }, []);
  return state;
}

export function SharedThesisView({
  payload,
  onAdapt,
  signedIn,
}: Readonly<{
  payload: PublicThesisPayload;
  onAdapt?: () => void;
  signedIn: boolean;
}>) {
  const provenance = payload.provenance;
  return (
    <section className="surface shared-thesis-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Shared Executable Thesis</p>
          <h2>{payload.asset} conditional entry</h2>
        </div>
        <span className="status-pill">PUBLIC INTENT · NOT AUTHORIZATION</span>
      </div>
      <div className="shared-warning">
        <strong>Same thesis. Your own safe position.</strong>
        <span>
          The trade is not copied. Vector recomputes risk for the recipient portfolio, and the
          recipient independently authorizes any execution.
        </span>
      </div>
      <dl className="shared-details">
        <dt>Creator</dt>
        <dd>
          <CopyableValue label="creator address" value={payload.creator} />
        </dd>
        <dt>Asset</dt>
        <dd>{payload.asset}</dd>
        <dt>Thesis</dt>
        <dd>{payload.thesisText}</dd>
        <dt>Entry</dt>
        <dd>At or below ${payload.entryCondition.priceUsd}</dd>
        <dt>Requested size</dt>
        <dd>${payload.requestedPositionUsd}</dd>
        <dt>Exposure constraint</dt>
        <dd>{payload.constraints.maxExposureBps / 100}% maximum</dd>
        <dt>Reserve</dt>
        <dd>${payload.constraints.reserveRequirementUsd} USDC</dd>
        <dt>Slippage</dt>
        <dd>{payload.constraints.maxSlippageBps / 100}% maximum</dd>
        <dt>Expiry</dt>
        <dd>{new Date(payload.expiry).toLocaleString()}</dd>
        <dt>Application provenance</dt>
        <dd>
          {provenance.kind === "ORIGINAL" ? (
            "Original thesis"
          ) : (
            <span className="provenance-values">
              <span>
                Forked from{" "}
                <CopyableValue label="parent thesis ID" value={provenance.parentThesisId} />
              </span>
              <span>
                Root thesis <CopyableValue label="root thesis ID" value={provenance.rootThesisId} />
              </span>
            </span>
          )}
        </dd>
      </dl>
      {onAdapt ? (
        <button type="button" onClick={onAdapt}>
          Adapt to my portfolio
        </button>
      ) : (
        <p className="field-note">
          {signedIn
            ? "A Smart Account is required to adapt."
            : "Sign in to adapt this thesis to your portfolio."}
        </p>
      )}
    </section>
  );
}

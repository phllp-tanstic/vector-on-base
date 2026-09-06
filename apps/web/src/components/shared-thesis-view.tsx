"use client";

import { useEffect, useState } from "react";

import { decodeSharePayload, type PublicThesisPayload } from "../lib/persisted-thesis";

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
      setState({ error: error instanceof Error ? error.message : "Malformed shared thesis link." });
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
      <p className="shared-warning">
        This link carries market intent and reusable constraints only. Your portfolio, risk result,
        execution package, and authorization are computed separately.
      </p>
      <dl className="shared-details">
        <dt>Creator</dt>
        <dd>{payload.creator}</dd>
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
        <dt>Provenance</dt>
        <dd>
          {provenance.kind === "ORIGINAL"
            ? "ORIGINAL THESIS"
            : `FORKED THESIS · parent ${provenance.parentThesisId} · root ${provenance.rootThesisId}`}
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

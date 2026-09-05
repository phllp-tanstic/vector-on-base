"use client";

import type { EndUserEvmSmartAccount } from "@coinbase/cdp-core";
import { type ChangeEvent, useCallback, useMemo, useState } from "react";

import {
  DEFAULT_DEMO_THESIS,
  DEMO_PORTFOLIO,
  PRODUCTION_READINESS,
  TESTNET_EXECUTION_DISCLOSURE,
  acceptRiskResult,
  editThesisParameters,
  evaluateThesisRisk,
  interpretDemoThesis,
  type DeterministicThesisParameters,
  type ExecutableThesis,
  type ThesisRiskResult,
  type ThesisStatus,
} from "../lib/executable-thesis";
import { BaseSepoliaTestSwapCard } from "./base-sepolia-test-swap-card";

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function Field({
  label,
  name,
  onChange,
  step,
  suffix,
  value,
}: Readonly<{
  label: string;
  name: keyof DeterministicThesisParameters;
  onChange: (name: keyof DeterministicThesisParameters, value: string) => void;
  step?: string;
  suffix: string;
  value: number;
}>) {
  return (
    <label className="parameter-field">
      <span>{label}</span>
      <span className="input-affix">
        <input
          aria-label={label}
          min="0"
          name={name}
          onChange={(event) => onChange(name, event.target.value)}
          step={step ?? "1"}
          type="number"
          value={value}
        />
        <small>{suffix}</small>
      </span>
    </label>
  );
}

export function ExecutableThesisWorkspace({
  smartAccount,
}: Readonly<{ smartAccount: EndUserEvmSmartAccount }>) {
  const [sourceText, setSourceText] = useState(DEFAULT_DEMO_THESIS);
  const [thesis, setThesis] = useState<ExecutableThesis>();
  const [risk, setRisk] = useState<ThesisRiskResult>();
  const [interpreterError, setInterpreterError] = useState<string>();
  const expiryLocal = useMemo(() => {
    if (!thesis) return "";
    const date = new Date(thesis.parameters.expiryIso);
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
  }, [thesis]);
  const handleExecutionStatus = useCallback((status: ThesisStatus) => {
    setThesis((current) => (current ? { ...current, status } : current));
  }, []);

  function interpret() {
    setInterpreterError(undefined);
    try {
      setThesis(interpretDemoThesis(sourceText));
      setRisk(undefined);
    } catch (error) {
      setInterpreterError(error instanceof Error ? error.message : String(error));
    }
  }

  function editNumber(name: keyof DeterministicThesisParameters, value: string) {
    if (!thesis) return;
    setThesis(editThesisParameters(thesis, { [name]: Number(value) }));
    setRisk(undefined);
  }

  function editExpiry(event: ChangeEvent<HTMLInputElement>) {
    if (!thesis) return;
    if (!event.target.value) return;
    setThesis(
      editThesisParameters(thesis, { expiryIso: new Date(event.target.value).toISOString() }),
    );
    setRisk(undefined);
  }

  function runRiskCheck() {
    if (!thesis) return;
    const result = evaluateThesisRisk(thesis, DEMO_PORTFOLIO);
    setRisk(result);
    setThesis({
      ...thesis,
      status:
        result.state === "BLOCKED"
          ? result.expiryValid
            ? "BLOCKED"
            : "EXPIRED"
          : result.state === "ADJUSTED"
            ? "ADJUSTED"
            : "RISK_CHECKED",
    } as ExecutableThesis);
  }

  function acceptRisk() {
    if (!thesis || !risk) return;
    setThesis(acceptRiskResult(thesis, risk));
  }

  return (
    <div className="product-grid">
      <section className="workspace-column" aria-label="Executable Thesis workflow">
        <div className="flow-steps" aria-label="Workflow progress">
          {["01 Intent", "02 Structure", "03 Risk", "04 Authorize", "05 Receipt"].map(
            (step, index) => (
              <span className={thesis && index < 2 ? "active" : ""} key={step}>
                {step}
              </span>
            ),
          )}
        </div>

        <section className="surface composer">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Create thesis</p>
              <h2>Describe the outcome, not the transaction</h2>
            </div>
            <span className="demo-chip">Demo intent interpreter</span>
          </div>
          <textarea
            aria-label="Market thesis"
            onChange={(event) => setSourceText(event.target.value)}
            rows={4}
            value={sourceText}
          />
          <div className="composer-footer">
            <p>Controlled local grammar · no free-form text reaches execution</p>
            <button onClick={interpret} type="button">
              Interpret thesis
            </button>
          </div>
          {interpreterError && <p className="error">{interpreterError}</p>}
        </section>

        {thesis && (
          <section className="surface thesis-card">
            <div className="thesis-title-row">
              <div className="asset-mark">N</div>
              <div>
                <p className="eyebrow">Executable Thesis</p>
                <h2>NVDAc conditional entry</h2>
                <p>{thesis.intent.rationale}</p>
              </div>
              <span className={`status-pill ${thesis.status.toLowerCase()}`}>{thesis.status}</span>
            </div>

            <div className="translation-grid">
              <div className="intent-pane">
                <span className="pane-label">User intent</span>
                <blockquote>“{thesis.intent.sourceText}”</blockquote>
              </div>
              <div className="parameter-pane">
                <span className="pane-label">Deterministic execution parameters</span>
                <div className="parameter-grid">
                  <Field
                    label="Entry at or below"
                    name="entryPriceUsd"
                    onChange={editNumber}
                    suffix="USD"
                    value={thesis.parameters.entryPriceUsd}
                  />
                  <Field
                    label="Intended size"
                    name="requestedSizeUsd"
                    onChange={editNumber}
                    suffix="USD"
                    value={thesis.parameters.requestedSizeUsd}
                  />
                  <Field
                    label="Max exposure"
                    name="maxExposurePercent"
                    onChange={editNumber}
                    suffix="%"
                    value={thesis.parameters.maxExposurePercent}
                  />
                  <Field
                    label="USDC reserve"
                    name="reserveUsd"
                    onChange={editNumber}
                    suffix="USD"
                    value={thesis.parameters.reserveUsd}
                  />
                  <Field
                    label="Max slippage"
                    name="maxSlippagePercent"
                    onChange={editNumber}
                    step="0.1"
                    suffix="%"
                    value={thesis.parameters.maxSlippagePercent}
                  />
                  <label className="parameter-field">
                    <span>Expiry</span>
                    <input
                      aria-label="Expiry"
                      onChange={editExpiry}
                      type="datetime-local"
                      value={expiryLocal}
                    />
                  </label>
                </div>
                <p className="field-note">
                  Editing any field invalidates the prior risk result and prepared execution.
                </p>
              </div>
            </div>

            <div className="section-action">
              <div>
                <strong>Portfolio and policy evaluation</strong>
                <p>Computed by deterministic constraints using labelled fixture values.</p>
              </div>
              <button onClick={runRiskCheck} type="button">
                Run risk check
              </button>
            </div>
          </section>
        )}

        {thesis && risk && (
          <section className="surface risk-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Portfolio adaptation</p>
                <h2>Your thesis → your executable position</h2>
              </div>
              <span className={`risk-state ${risk.state.toLowerCase()}`}>{risk.state}</span>
            </div>
            <div className="adaptation-callout">
              <div>
                <span>You asked</span>
                <strong>{money(thesis.parameters.requestedSizeUsd)}</strong>
              </div>
              <span className="arrow">→</span>
              <div>
                <span>Maximum safe size</span>
                <strong>{money(risk.executableSizeUsd)}</strong>
              </div>
              <p>
                {risk.reasons.includes("RESERVE_ADJUSTMENT")
                  ? "Adjusted to preserve your USDC reserve."
                  : "No sizing adjustment required."}
              </p>
            </div>
            <div className="risk-metrics">
              <div>
                <span>Available USDC</span>
                <strong>{money(DEMO_PORTFOLIO.availableUsdcUsd)}</strong>
              </div>
              <div>
                <span>Required reserve</span>
                <strong>{money(thesis.parameters.reserveUsd)}</strong>
              </div>
              <div>
                <span>Requested size</span>
                <strong>{money(thesis.parameters.requestedSizeUsd)}</strong>
              </div>
              <div>
                <span>Executable size</span>
                <strong>{money(risk.executableSizeUsd)}</strong>
              </div>
              <div>
                <span>Current exposure</span>
                <strong>{money(DEMO_PORTFOLIO.currentAssetExposureUsd)}</strong>
              </div>
              <div>
                <span>Post-trade exposure</span>
                <strong>{money(risk.postTradeExposureUsd)}</strong>
              </div>
              <div>
                <span>Maximum exposure</span>
                <strong>{money(risk.maximumAssetExposureUsd)}</strong>
              </div>
              <div>
                <span>Slippage</span>
                <strong>
                  {DEMO_PORTFOLIO.quotedSlippagePercent}% / {thesis.parameters.maxSlippagePercent}%
                  max
                </strong>
              </div>
              <div>
                <span>Entry trigger</span>
                <strong>{risk.triggerSatisfied ? "SATISFIED" : "NOT MET"}</strong>
              </div>
              <div>
                <span>Expiry</span>
                <strong>{risk.expiryValid ? "VALID" : "EXPIRED"}</strong>
              </div>
            </div>
            {risk.reasons.length > 0 && (
              <p className="typed-reasons">Policy output: {risk.reasons.join(" · ")}</p>
            )}
            <button disabled={risk.state === "BLOCKED"} onClick={acceptRisk} type="button">
              {risk.state === "BLOCKED"
                ? "Resolve blocked constraints"
                : "Accept adaptation and continue"}
            </button>
          </section>
        )}

        {thesis &&
          ["READY_FOR_AUTHORIZATION", "AUTHORIZING", "EXECUTED", "FAILED"].includes(
            thesis.status,
          ) && (
            <BaseSepoliaTestSwapCard
              key={thesis.planRevision}
              onStatusChange={handleExecutionStatus}
              smartAccount={smartAccount}
              thesis={thesis}
              risk={risk!}
            />
          )}
      </section>

      <aside className="context-column">
        <section className="boundary-card">
          <span className="live-dot" />
          <p className="eyebrow">Demo mode</p>
          <h3>Base Sepolia live demo</h3>
          <p>{TESTNET_EXECUTION_DISCLOSURE}</p>
          <small>
            NVDA is the product-level thesis. Final settlement uses the isolated mUSDC → NOTB20
            testnet fixture.
          </small>
        </section>
        <section className="readiness-card">
          <p className="eyebrow">Production path</p>
          <h3>Capability readiness</h3>
          <ul>
            {PRODUCTION_READINESS.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <strong className={item.state === "READY" ? "ready" : "pending"}>
                  {item.state}
                </strong>
              </li>
            ))}
          </ul>
          <small>Informational only. No mainnet transaction is available from this demo.</small>
        </section>
      </aside>
    </div>
  );
}

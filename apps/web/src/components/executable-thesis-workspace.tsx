"use client";

import type { EndUserEvmSmartAccount } from "@coinbase/cdp-core";
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

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
import { asEvmAddress } from "../lib/authorization";
import {
  LocalExecutableThesisRepository,
  LocalThesisExecutionRepository,
  adaptPublicThesis,
  createShareUrl,
  persistedFromWorkingThesis,
  resetLocalDemoProductState,
  toPublicThesisPayload,
  workingThesisFromPublic,
  type PersistedExecutableThesis,
  type PublicThesisPayload,
  type ThesisExecutionRecord,
} from "../lib/persisted-thesis";
import { BaseSepoliaTestSwapCard } from "./base-sepolia-test-swap-card";
import { CopyableValue } from "./copyable-value";
import { SharedThesisView } from "./shared-thesis-view";

const RECIPIENT_DEMO_PORTFOLIO = Object.freeze({
  ...DEMO_PORTFOLIO,
  availableUsdcUsd: 1_180,
});

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function thesisStatusLabel(status: ThesisStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function riskReasonLabel(reason: ThesisRiskResult["reasons"][number]): string {
  const labels: Partial<Record<ThesisRiskResult["reasons"][number], string>> = {
    EXPOSURE_LIMIT: "Exposure limit reached",
    INTENT_EXPIRED: "Thesis expired",
    POLICY_REJECTED: "Invalid risk parameters",
    RESERVE_ADJUSTMENT: "USDC reserve preserved",
    SLIPPAGE_TOO_HIGH: "Slippage exceeds maximum",
    TRIGGER_NOT_MET: "Entry price not reached",
  };
  return labels[reason] ?? "Risk policy blocked authorization";
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
  sharedPayload,
}: Readonly<{
  smartAccount: EndUserEvmSmartAccount;
  sharedPayload?: PublicThesisPayload;
}>) {
  const smartAccountAddress = asEvmAddress(smartAccount.address) ?? "unknown-smart-account";
  const [sourceText, setSourceText] = useState(DEFAULT_DEMO_THESIS);
  const [thesis, setThesis] = useState<ExecutableThesis>();
  const [risk, setRisk] = useState<ThesisRiskResult>();
  const [interpreterError, setInterpreterError] = useState<string>();
  const [repository, setRepository] = useState<LocalExecutableThesisRepository>();
  const [executionRepository, setExecutionRepository] = useState<LocalThesisExecutionRepository>();
  const [savedTheses, setSavedTheses] = useState<readonly PersistedExecutableThesis[]>([]);
  const [savedThesis, setSavedThesis] = useState<PersistedExecutableThesis>();
  const [savedMessage, setSavedMessage] = useState<string>();
  const [history, setHistory] = useState<readonly ThesisExecutionRecord[]>([]);
  const [isSharedAdapted, setIsSharedAdapted] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string>();
  const activePortfolio = isSharedAdapted ? RECIPIENT_DEMO_PORTFOLIO : DEMO_PORTFOLIO;
  const sharedCreatorRisk = useMemo(
    () => (sharedPayload ? adaptPublicThesis(sharedPayload, DEMO_PORTFOLIO).risk : undefined),
    [sharedPayload],
  );
  const progressIndex = !thesis
    ? 0
    : thesis.status === "EXECUTED"
      ? 4
      : ["READY_FOR_AUTHORIZATION", "AUTHORIZING", "FAILED"].includes(thesis.status)
        ? 3
        : risk
          ? 2
          : 1;

  useEffect(() => {
    try {
      const thesisRepository = new LocalExecutableThesisRepository(window.localStorage);
      const records = new LocalThesisExecutionRepository(window.localStorage);
      setRepository(thesisRepository);
      setExecutionRepository(records);
      setSavedTheses(thesisRepository.list());
      setHistory(records.list());
    } catch {
      setPersistenceError(
        "Local saving is unavailable in this browser. You can keep working, but this thesis will not persist after the page closes.",
      );
    }
  }, []);
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
      setSavedThesis(undefined);
      setSavedMessage(undefined);
    } catch (error) {
      setInterpreterError(error instanceof Error ? error.message : String(error));
    }
  }

  function editNumber(name: keyof DeterministicThesisParameters, value: string) {
    if (!thesis) return;
    setThesis(editThesisParameters(thesis, { [name]: Number(value) }));
    setRisk(undefined);
    setSavedMessage(
      savedThesis ? "Unsaved changes · execution preparation invalidated" : undefined,
    );
  }

  function editExpiry(event: ChangeEvent<HTMLInputElement>) {
    if (!thesis) return;
    if (!event.target.value) return;
    setThesis(
      editThesisParameters(thesis, { expiryIso: new Date(event.target.value).toISOString() }),
    );
    setRisk(undefined);
    setSavedMessage(
      savedThesis ? "Unsaved changes · execution preparation invalidated" : undefined,
    );
  }

  function runRiskCheck() {
    if (!thesis) return;
    const result = evaluateThesisRisk(thesis, activePortfolio);
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

  function refreshLibrary() {
    if (!repository) return;
    setSavedTheses(repository.list());
    setHistory(executionRepository?.list() ?? []);
  }

  async function saveThesis() {
    if (!thesis) return;
    if (!repository) {
      setSavedMessage("Local saving is unavailable. Your current thesis remains open.");
      return;
    }
    try {
      const persisted = await persistedFromWorkingThesis(thesis, smartAccountAddress, savedThesis);
      if (savedThesis) repository.update(savedThesis.id, persisted);
      else repository.save(persisted);
      setSavedThesis(persisted);
      setSavedMessage("Saved · no quote or authorization was created");
      refreshLibrary();
    } catch {
      setSavedMessage("The thesis could not be saved locally. Your current thesis remains open.");
    }
  }

  function openSaved(item: PersistedExecutableThesis) {
    const working = workingThesisFromPublic(toPublicThesisPayload(item), item.id);
    setThesis(working);
    setSourceText(working.intent.sourceText);
    setRisk(undefined);
    setSavedThesis(item);
    setSavedMessage("Saved thesis opened · run a fresh risk check before preparation");
  }

  async function forkSaved(item: PersistedExecutableThesis) {
    if (!repository) return;
    const fork = await repository.fork(item, smartAccountAddress);
    openSaved(fork);
    refreshLibrary();
    setSavedMessage("Fork saved with a new identity · execution state was not inherited");
  }

  function deleteSaved(item: PersistedExecutableThesis) {
    if (!repository) return;
    repository.delete(item.id);
    if (savedThesis?.id === item.id) setSavedThesis(undefined);
    refreshLibrary();
  }

  function resetDemo(clearSavedTheses = false) {
    try {
      resetLocalDemoProductState(window.localStorage, clearSavedTheses);
      if (clearSavedTheses) setSavedTheses([]);
    } catch {
      setPersistenceError(
        "Local storage could not be changed. The on-screen demo was reset, but saved theses may remain.",
      );
    }
    setSourceText(DEFAULT_DEMO_THESIS);
    setThesis(undefined);
    setRisk(undefined);
    setInterpreterError(undefined);
    setSavedThesis(undefined);
    setSavedMessage(
      clearSavedTheses
        ? "Demo reset · saved demo theses cleared · confirmed receipts preserved"
        : "Demo reset · wallet, sign-in, saved theses, and confirmed receipts preserved",
    );
    setIsSharedAdapted(false);
  }

  async function copyShareLink(item: PersistedExecutableThesis) {
    try {
      await navigator.clipboard.writeText(createShareUrl(item, window.location.origin));
      setSavedMessage("Share link copied · it contains reusable intent, not execution authority");
    } catch {
      setSavedMessage("Could not copy the share link in this browser.");
    }
  }

  function adaptShared() {
    if (!sharedPayload) return;
    const adapted = adaptPublicThesis(sharedPayload, RECIPIENT_DEMO_PORTFOLIO);
    setThesis(adapted.thesis);
    setSourceText(adapted.thesis.intent.sourceText);
    setRisk(adapted.risk);
    setSavedThesis(undefined);
    setIsSharedAdapted(true);
    setSavedMessage("Recipient risk recomputed from the recipient demo portfolio");
  }

  async function forkShared() {
    if (!sharedPayload || !repository) return;
    const working = workingThesisFromPublic(sharedPayload);
    const parentBase = await persistedFromWorkingThesis(working, sharedPayload.creator);
    const parent = {
      ...parentBase,
      id: sharedPayload.thesisId,
      provenance: sharedPayload.provenance,
    };
    const fork = await repository.fork(parent, smartAccountAddress);
    openSaved(fork);
    refreshLibrary();
    setIsSharedAdapted(true);
    setSavedMessage("Fork saved · edit expiry if needed, then run recipient-specific risk");
  }

  const handleConfirmedExecution = useCallback(
    (record: Omit<ThesisExecutionRecord, "thesisId">) => {
      if (!thesis || !executionRepository) return;
      executionRepository.saveConfirmed({ ...record, thesisId: thesis.id });
      setHistory(executionRepository.list());
      if (savedThesis && repository) {
        const executed = {
          ...savedThesis,
          status: "EXECUTED" as const,
          updatedAt: record.executedAt,
        };
        repository.update(savedThesis.id, executed);
        setSavedThesis(executed);
        setSavedTheses(repository.list());
      }
    },
    [executionRepository, repository, savedThesis, thesis],
  );

  return (
    <div className="product-grid">
      <section className="workspace-column" aria-label="Executable Thesis workflow">
        {sharedPayload && !isSharedAdapted && (
          <SharedThesisView payload={sharedPayload} signedIn onAdapt={adaptShared} />
        )}
        {sharedPayload && isSharedAdapted && (
          <section className="surface adaptation-proof">
            <p className="eyebrow">Recipient adaptation</p>
            <h2>Same thesis. Different portfolio. Different safe position.</h2>
            <div className="proof-grid">
              <div>
                <span>Shared request</span>
                <strong>{money(sharedPayload.requestedPositionUsd)}</strong>
              </div>
              <div>
                <span>Creator executable</span>
                <strong>
                  {sharedCreatorRisk ? money(sharedCreatorRisk.executableSizeUsd) : "—"}
                </strong>
              </div>
              <div>
                <span>Your executable position</span>
                <strong>{risk ? money(risk.executableSizeUsd) : "Run risk"}</strong>
              </div>
            </div>
            <p className="proof-explainer">
              The shared intent stays at {money(sharedPayload.requestedPositionUsd)}. Deterministic
              reserve logic recomputes {risk ? money(risk.executableSizeUsd) : "your safe size"}
              from your Demo Mode portfolio; no creator execution or authorization is inherited.
            </p>
            <button className="secondary" type="button" onClick={() => void forkShared()}>
              Fork thesis
            </button>
          </section>
        )}

        <section className="surface thesis-library">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Owned library</p>
              <h2>My Theses</h2>
            </div>
            <span className="demo-chip">Local to this browser</span>
          </div>
          {persistenceError && (
            <p className="error" role="alert">
              {persistenceError}
            </p>
          )}
          {savedTheses.length === 0 ? (
            <p className="muted">No saved theses yet.</p>
          ) : (
            <div className="library-list">
              {savedTheses.map((item) => {
                const lastExecution = [...history]
                  .reverse()
                  .find((record) => record.thesisId === item.id);
                return (
                  <article key={item.id}>
                    <div>
                      <strong>{item.asset}</strong>
                      <p>{item.thesisText}</p>
                    </div>
                    <div className="library-meta">
                      <span>{item.status}</span>
                      <span>{item.provenance.kind}</span>
                      <span>Created {new Date(item.createdAt).toLocaleDateString()}</span>
                      <span>Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
                      <span>Expires {new Date(item.expiry).toLocaleDateString()}</span>
                      <span>Last execution: {lastExecution?.status ?? "None"}</span>
                    </div>
                    <div className="library-actions">
                      <button
                        className="secondary compact"
                        type="button"
                        onClick={() => openSaved(item)}
                      >
                        Open / edit
                      </button>
                      <button
                        className="secondary compact"
                        type="button"
                        onClick={() => void forkSaved(item)}
                      >
                        Duplicate / fork
                      </button>
                      <button
                        className="secondary compact"
                        type="button"
                        onClick={() => void copyShareLink(item)}
                      >
                        Copy share link
                      </button>
                      <button
                        className="danger compact"
                        type="button"
                        onClick={() => deleteSaved(item)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <div className="flow-steps" aria-label="Workflow progress">
          {["01 Intent", "02 Structure", "03 Risk", "04 Authorize", "05 Receipt"].map(
            (step, index) => (
              <span className={index <= progressIndex ? "active" : ""} key={step}>
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
              <span className={`status-pill ${thesis.status.toLowerCase()}`}>
                {thesisStatusLabel(thesis.status)}
              </span>
            </div>

            {savedThesis && (
              <div className="provenance-strip">
                <span className="provenance-label">Application provenance</span>
                <strong>
                  {savedThesis.provenance.kind === "ORIGINAL" ? "ORIGINAL THESIS" : "FORKED THESIS"}
                </strong>
                {savedThesis.provenance.kind === "FORK" && (
                  <>
                    <span>
                      Forked from{" "}
                      <CopyableValue
                        label="parent thesis ID"
                        value={savedThesis.provenance.parentThesisId}
                      />
                    </span>
                    <span>
                      Root thesis{" "}
                      <CopyableValue
                        label="root thesis ID"
                        value={savedThesis.provenance.rootThesisId}
                      />
                    </span>
                  </>
                )}
              </div>
            )}

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
              <div className="inline-actions">
                <button className="secondary" onClick={() => void saveThesis()} type="button">
                  Save thesis
                </button>
                {savedThesis && (
                  <button
                    className="secondary"
                    onClick={() => void copyShareLink(savedThesis)}
                    type="button"
                  >
                    Copy share link
                  </button>
                )}
                <button onClick={runRiskCheck} type="button">
                  Run risk check
                </button>
              </div>
            </div>
            {savedMessage && <p className="saved-message">{savedMessage}</p>}
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
              <div className="requested-amount">
                <span>Requested</span>
                <strong>{money(thesis.parameters.requestedSizeUsd)}</strong>
              </div>
              <span className="arrow">→</span>
              <div className="adapted-amount">
                <span>Vector-adapted</span>
                <strong>{money(risk.executableSizeUsd)}</strong>
              </div>
              <p>
                {risk.reasons.includes("RESERVE_ADJUSTMENT")
                  ? `Deterministic portfolio rules computed ${money(risk.executableSizeUsd)} to preserve your ${money(thesis.parameters.reserveUsd)} USDC reserve. AI structured the thesis; it did not choose this amount.`
                  : "No sizing adjustment required."}
              </p>
            </div>
            <div className="risk-metrics">
              <div>
                <span>Available USDC</span>
                <strong>{money(activePortfolio.availableUsdcUsd)}</strong>
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
                <strong>{money(activePortfolio.currentAssetExposureUsd)}</strong>
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
                  {activePortfolio.quotedSlippagePercent}% / {thesis.parameters.maxSlippagePercent}%
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
              <p className="typed-reasons">
                Risk result: {risk.reasons.map(riskReasonLabel).join(" · ")}
              </p>
            )}
            {risk.state === "BLOCKED" ? (
              <p className="error blocked-guidance" role="alert">
                Authorization is blocked. Edit the highlighted thesis constraints, then run the risk
                check again. No execution can be prepared from this result.
              </p>
            ) : (
              <button onClick={acceptRisk} type="button">
                Accept adaptation and continue
              </button>
            )}
          </section>
        )}

        {thesis &&
          ["READY_FOR_AUTHORIZATION", "AUTHORIZING", "EXECUTED", "FAILED"].includes(
            thesis.status,
          ) && (
            <BaseSepoliaTestSwapCard
              key={thesis.planRevision}
              onStatusChange={handleExecutionStatus}
              onConfirmedExecution={handleConfirmedExecution}
              smartAccount={smartAccount}
              thesis={thesis}
              risk={risk!}
            />
          )}

        {history.length > 0 && (
          <section className="surface execution-history">
            <p className="eyebrow">Execution history</p>
            <h2>Confirmed receipts</h2>
            {history.map((record) => (
              <div key={record.executionId}>
                <strong>
                  {record.status} · {record.network}
                </strong>
                <span>
                  {record.sellAmount} → {record.receiveAmount}
                </span>
                <CopyableValue label="transaction hash" value={record.transactionHash} />
              </div>
            ))}
            <p className="field-note">Historical receipts never authorize future execution.</p>
          </section>
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
          <div className="demo-controls">
            <button className="secondary compact" type="button" onClick={() => resetDemo(false)}>
              Reset current demo
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                if (
                  window.confirm("Clear saved demo theses? Confirmed receipts will be preserved.")
                ) {
                  resetDemo(true);
                }
              }}
            >
              Clear saved theses
            </button>
          </div>
          {savedMessage?.startsWith("Demo reset") && (
            <p className="reset-message" role="status">
              {savedMessage}
            </p>
          )}
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

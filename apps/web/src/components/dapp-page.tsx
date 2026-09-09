import { AuthorizationShell } from "./authorization-shell";
import { CdpProvider } from "./cdp-provider";

export function DappPage() {
  return (
    <main>
      <section className="app-shell">
        <header className="app-header">
          <a className="wordmark" href="/app">
            VECTOR<span>[ BASE ]</span>
          </a>
          <div className="header-copy">
            <p className="eyebrow">[ Vector / Base ]</p>
            <h1>
              Market intent.
              <br />
              Controlled execution.
            </h1>
            <p className="lede">
              Turn a market thesis into a portfolio-aware, risk-constrained position you can
              authorize on Base.
            </p>
            <ol className="value-loop" aria-label="How Vector works">
              <li>
                <strong>Express</strong>
                <span>Your market thesis</span>
              </li>
              <li>
                <strong>Structure</strong>
                <span>Vector structures an Executable Thesis</span>
              </li>
              <li>
                <strong>Adapt</strong>
                <span>Deterministic code applies your portfolio rules</span>
              </li>
              <li>
                <strong>Authorize</strong>
                <span>You approve the final execution</span>
              </li>
              <li>
                <strong>Settle</strong>
                <span>Onchain proof closes the loop</span>
              </li>
            </ol>
          </div>
          <span className="network-chip">Base Sepolia</span>
        </header>
        <CdpProvider>
          <AuthorizationShell />
        </CdpProvider>
      </section>
    </main>
  );
}

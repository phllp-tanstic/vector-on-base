import { AuthorizationShell } from "../components/authorization-shell";
import { CdpProvider } from "../components/cdp-provider";

export default function HomePage() {
  return (
    <main>
      <section className="app-shell">
        <header className="app-header">
          <a className="wordmark" href="#">
            VECTOR<span>◆</span>
          </a>
          <div className="header-copy">
            <p className="eyebrow">Intent execution on Base</p>
            <h1>Turn a market view into controlled execution.</h1>
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
                <span>AI creates an Executable Thesis</span>
              </li>
              <li>
                <strong>Adapt</strong>
                <span>Deterministic code applies your portfolio rules</span>
              </li>
              <li>
                <strong>Authorize</strong>
                <span>You approve the final execution</span>
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

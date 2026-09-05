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
              AI interprets intent. Deterministic code controls execution. You control
              authorization.
            </p>
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

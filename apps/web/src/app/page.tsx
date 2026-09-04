import { AuthorizationShell } from "../components/authorization-shell";
import { CdpProvider } from "../components/cdp-provider";

export default function HomePage() {
  return (
    <main>
      <section className="panel">
        <p className="eyebrow">Vector · authorization proof</p>
        <h1>User-controlled Smart Account</h1>
        <p className="lede">
          Sign in and explicitly authorize one harmless, zero-value UserOperation on Base Sepolia.
          This test is not connected to Vector trading.
        </p>
        <CdpProvider>
          <AuthorizationShell />
        </CdpProvider>
      </section>
    </main>
  );
}

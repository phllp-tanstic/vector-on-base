import { AuthorizationShell } from "../components/authorization-shell";
import { CdpProvider } from "../components/cdp-provider";

export default function HomePage() {
  return (
    <main>
      <section className="panel">
        <p className="eyebrow">Vector · Base Sepolia</p>
        <h1>User-controlled Smart Account</h1>
        <p className="lede">
          Sign in to run either the harmless authorization proof or explicitly prepare and approve
          the isolated VectorExecutor fixture swap.
        </p>
        <CdpProvider>
          <AuthorizationShell />
        </CdpProvider>
      </section>
    </main>
  );
}

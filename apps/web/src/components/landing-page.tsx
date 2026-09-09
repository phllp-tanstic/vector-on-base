"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const DOCUMENTATION_URL = "https://github.com/phllp-tanstic/vector-on-base#readme";

function MeshCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("webgl");
    if (!context) return;
    const gl: WebGLRenderingContext = context;

    const vertexSource = `
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;
    const fragmentSource = `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
      }
      float noise(vec2 st) {
        vec2 i = floor(st);
        vec2 f = fract(st);
        float a = random(i);
        float b = random(i + vec2(1.0, 0.0));
        float c = random(i + vec2(0.0, 1.0));
        float d = random(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      void main() {
        vec2 pos = vUv * 1.5;
        float n1 = noise(pos + uTime * 0.2);
        float n2 = noise(pos + vec2(n1) - uTime * 0.15);
        float n3 = noise(pos + vec2(n2) + uTime * 0.1);
        vec3 lime = vec3(0.78, 0.95, 0.0);
        vec3 violet = vec3(0.26, 0.19, 0.76);
        vec3 black = vec3(0.02);
        vec3 graphite = vec3(0.30);
        vec3 color = mix(graphite, black, n1);
        color = mix(color, violet, smoothstep(0.3, 0.7, n2));
        color = mix(color, lime, smoothstep(0.5, 1.0, n3));
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    function compileShader(type: number, source: string) {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const positionLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    const timeLocation = gl.getUniformLocation(program, "uTime");

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * pixelRatio));
      const height = Math.max(1, Math.round(rect.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    };

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startedAt = performance.now();
    let animationFrame = 0;
    const render = (time: number) => {
      resize();
      gl.uniform1f(timeLocation, reducedMotion ? 0 : (time - startedAt) * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reducedMotion) animationFrame = requestAnimationFrame(render);
    };
    animationFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrame);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    };
  }, []);

  return <canvas ref={canvasRef} className="landing-mesh" aria-hidden="true" />;
}

function LandingNote({
  answer,
  id,
  question,
}: Readonly<{ answer: string; id: string; question: string }>) {
  const [open, setOpen] = useState(false);

  return (
    <div className="landing-note">
      <h3>
        <button
          type="button"
          aria-controls={id}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{question}</span>
          <i aria-hidden="true" />
        </button>
      </h3>
      <p id={id} hidden={!open}>
        {answer}
      </p>
    </div>
  );
}

export function LandingPage() {
  return (
    <main className="landing-page">
      <div className="landing-frame" aria-hidden="true">
        <i className="frame-node frame-node-top-left" />
        <i className="frame-node frame-node-left-rule" />
        <i className="frame-node frame-node-top-right" />
        <i className="frame-node frame-node-right-rule" />
        <i className="frame-node frame-node-bottom-left" />
        <i className="frame-node frame-node-bottom-right" />
      </div>

      <div className="landing-container">
        <header className="landing-header">
          <Link className="wordmark landing-reveal" href="/app" aria-label="Vector app">
            VECTOR<span>[ BASE ]</span>
          </Link>
          <nav className="landing-nav landing-reveal" aria-label="Primary navigation">
            <a href={DOCUMENTATION_URL} target="_blank" rel="noopener noreferrer">
              Documentation
            </a>
            <Link className="landing-button landing-button-small" href="/app">
              Launch App
            </Link>
          </nav>
        </header>

        <section className="landing-hero">
          <div className="landing-copy">
            <p className="landing-strip landing-reveal">BUILT FOR TOKENIZED MARKETS ON BASE</p>
            <h1 className="landing-title" aria-label="Execute Intent">
              <span className="landing-word-mask">
                <span>Execute</span>
              </span>
              <span className="landing-word-mask">
                <span>Intent</span>
              </span>
            </h1>
            <p className="landing-description landing-reveal">
              Vector turns market theses into personalized, risk-constrained, execution-ready
              positions on Base. Intent is structured, portfolio constraints are applied
              deterministically, and users retain control of authorization.
            </p>
            <Link className="landing-button landing-reveal" href="/app">
              Launch App
            </Link>
            <p className="landing-disclosure landing-reveal">
              Hackathon demo on Base Sepolia with test assets. Production tokenized-stock access
              depends on provider, account, and jurisdiction eligibility.
            </p>
          </div>

          <div className="landing-visual landing-reveal">
            <div className="landing-mockup-frame">
              <div className="landing-mockup-square">
                <MeshCanvas />
                <div className="landing-code-window">
                  <div className="landing-window-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                  <pre aria-label="Executable Thesis presentation pseudocode">
                    <code>
                      <span className="code-dim">// Executable Thesis · deterministic risk</span>
                      {"\n"}
                      <span className="code-lime">const</span> thesis = structureIntent({"{"}
                      {"\n"}
                      {"  "}asset: <span className="code-white">&quot;NVDAc&quot;</span>,{"\n"}
                      {"  "}trigger: <span className="code-white">&quot;&lt; $170&quot;</span>,
                      {"\n"}
                      {"  "}maxPortfolioBps: <span className="code-white">1000</span>,{"\n"}
                      {"  "}reserveUSDC: <span className="code-white">1000</span>,{"\n"}
                      {"  "}maxSlippageBps: <span className="code-white">100</span>,{"\n"}
                      {"}"});{"\n\n"}
                      <span className="code-lime">const</span> result = evaluateRisk({"{"}
                      {"\n"}
                      {"  "}requestedUSDC: <span className="code-white">500</span>, thesis,
                      portfolio,{"\n"}
                      {"}"});{"\n\n"}
                      <span className="code-dim">// requested: $500</span>
                      {"\n"}
                      <span className="code-dim">// executable: $320</span>
                      {"\n"}
                      <span className="code-dim">// state: READY_FOR_AUTHORIZATION</span>
                    </code>
                  </pre>
                  <div className="landing-execute-row">
                    <button type="button" aria-label="Execute example thesis">
                      Execute
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <p className="landing-diagram-label">V1 · BASE SEPOLIA</p>
          </div>
        </section>

        <section className="landing-section landing-overview" id="overview">
          <div className="landing-section-heading">
            <p className="landing-kicker">[ 01 · OVERVIEW ]</p>
            <h2>Vector on Base</h2>
          </div>
          <div className="landing-overview-grid">
            <div className="landing-overview-copy">
              <p className="landing-lead">
                A market thesis should describe what you want, without silently deciding what your
                portfolio can afford.
              </p>
              <p>
                Vector separates interpretation, deterministic risk checks, and wallet
                authorization. It turns natural-language intent into a reviewable Executable Thesis,
                adapts the requested position to explicit constraints, and leaves the final decision
                with the user.
              </p>
            </div>
            <dl className="landing-system-facts">
              <div>
                <dt>Network</dt>
                <dd>Base Sepolia</dd>
              </div>
              <div>
                <dt>Authorization</dt>
                <dd>Coinbase Smart Account</dd>
              </div>
              <div>
                <dt>Risk policy</dt>
                <dd>Deterministic constraints</dd>
              </div>
              <div>
                <dt>Demo market</dt>
                <dd>NVDA scenario</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="landing-section" id="how-it-works">
          <div className="landing-section-heading landing-section-heading-wide">
            <div>
              <p className="landing-kicker">[ 02 · HOW IT WORKS ]</p>
              <h2>From thesis to settlement</h2>
            </div>
            <p>
              Five visible stages keep interpretation, policy, authorization, and settlement
              separate.
            </p>
          </div>
          <ol className="landing-process">
            <li>
              <span>01</span>
              <h3>Express</h3>
              <p>Describe an entry, position size, limits, and expiry in plain language.</p>
            </li>
            <li>
              <span>02</span>
              <h3>Structure</h3>
              <p>
                AI maps the thesis into a strict schema. It does not receive execution authority.
              </p>
            </li>
            <li>
              <span>03</span>
              <h3>Adapt</h3>
              <p>
                Deterministic code applies exposure, reserve, trigger, slippage, and expiry rules.
              </p>
            </li>
            <li>
              <span>04</span>
              <h3>Authorize</h3>
              <p>Review the exact result and approve it with a user-controlled Smart Account.</p>
            </li>
            <li>
              <span>05</span>
              <h3>Settle</h3>
              <p>Base confirms the testnet operation and Vector records the receipt locally.</p>
            </li>
          </ol>
        </section>

        <section className="landing-section" id="features">
          <div className="landing-section-heading">
            <p className="landing-kicker">[ 03 · FEATURES ]</p>
            <h2>Built around explicit control</h2>
          </div>
          <div className="landing-feature-grid">
            <article>
              <span>[ INTENT ]</span>
              <h3>Structured interpretation</h3>
              <p>AI returns schema-constrained thesis parameters through a server-side route.</p>
            </article>
            <article>
              <span>[ POLICY ]</span>
              <h3>Deterministic adaptation</h3>
              <p>Portfolio rules can reduce or block a requested position before authorization.</p>
            </article>
            <article>
              <span>[ CONTROL ]</span>
              <h3>User-owned authorization</h3>
              <p>Coinbase CDP handles email authentication and Smart Account authorization.</p>
            </article>
            <article>
              <span>[ PROOF ]</span>
              <h3>Onchain receipts</h3>
              <p>Confirmed test operations expose transaction and UserOperation identifiers.</p>
            </article>
            <article>
              <span>[ PORTABLE ]</span>
              <h3>Shareable theses</h3>
              <p>
                Public links carry intent and constraints, never wallet authorization or receipts.
              </p>
            </article>
            <article>
              <span>[ LOCAL ]</span>
              <h3>Saved thesis library</h3>
              <p>The MVP keeps saved theses and confirmed receipts in browser-local storage.</p>
            </article>
          </div>
        </section>

        <section className="landing-section landing-state" id="current-state">
          <div className="landing-section-heading landing-section-heading-wide">
            <div>
              <p className="landing-kicker">[ 04 · CURRENT STATE ]</p>
              <h2>Testnet now. Mainnet after validation.</h2>
            </div>
            <span className="landing-live-status">
              <i /> BASE SEPOLIA LIVE DEMO
            </span>
          </div>
          <div className="landing-roadmap">
            <article>
              <p className="landing-roadmap-label">01 · PRE-HACKATHON</p>
              <h3>Initial direction</h3>
              <ul>
                <li>Define the Executable Thesis model</li>
                <li>Separate risk policy from authorization</li>
                <li>Design for tokenized markets on Base</li>
              </ul>
            </article>
            <article className="landing-roadmap-current">
              <p className="landing-roadmap-label">02 · HACKATHON MVP</p>
              <h3>Demonstrated now</h3>
              <ul>
                <li>Groq-assisted NVDA thesis interpretation</li>
                <li>Deterministic portfolio adaptation</li>
                <li>Coinbase Smart Account authorization</li>
                <li>Base Sepolia test-asset settlement</li>
                <li>Local persistence and public sharing</li>
              </ul>
            </article>
            <article>
              <p className="landing-roadmap-label">03 · POST-HACKATHON</p>
              <h3>Path to mainnet</h3>
              <ul>
                <li>Complete provider and eligibility access</li>
                <li>Wire live portfolio and reference data</li>
                <li>Harden quote freshness and simulation</li>
                <li>Audit and deploy VectorExecutor on Base</li>
                <li>Add durable storage and monitoring</li>
              </ul>
            </article>
          </div>
          <p className="landing-state-note">
            The current flow uses mock assets with no monetary value. Base Mainnet execution is not
            deployed or enabled.
          </p>
        </section>

        <section className="landing-section landing-notes" id="system-notes">
          <div className="landing-section-heading landing-section-heading-wide">
            <div>
              <p className="landing-kicker">[ 05 · SYSTEM NOTES ]</p>
              <h2>Before you use Vector</h2>
            </div>
            <p>
              Clear boundaries for a new protocol concept and its current testnet implementation.
            </p>
          </div>
          <div className="landing-accordion">
            <LandingNote
              id="landing-note-market-scope"
              question="Is Vector limited to NVDA?"
              answer="No. NVDA is the bounded hackathon demonstration scenario. The product architecture is intended for broader tokenized markets, subject to asset, provider, account, and jurisdiction support."
            />
            <LandingNote
              id="landing-note-ai-authority"
              question="Does the AI execute trades?"
              answer="No. AI produces schema-constrained intent parameters. Deterministic code applies the risk policy, and the user independently authorizes the final operation."
            />
            <LandingNote
              id="landing-note-demo-assets"
              question="Are the demo assets real tokenized stocks?"
              answer="No. The live demo runs on Base Sepolia with mock assets that have no monetary value. Production tokenized-stock access is not represented as available."
            />
            <LandingNote
              id="landing-note-sharing"
              question="What is included in a shared thesis?"
              answer="A share link contains public intent and constraints. It excludes wallet authorization, calldata, quotes, balances, nonces, and transaction receipts. A recipient must adapt and authorize independently."
            />
            <LandingNote
              id="landing-note-storage"
              question="Where is thesis data stored?"
              answer="Saved theses and confirmed receipts remain in this browser's local storage. The MVP does not provide hosted sync, recovery, or a cross-device account library."
            />
          </div>
        </section>

        <section className="landing-cta">
          <p className="landing-kicker">[ READY TO TEST THE FLOW? ]</p>
          <h2>Express the thesis. Keep control.</h2>
          <Link className="landing-button" href="/app">
            Launch App
          </Link>
        </section>

        <footer className="landing-footer">
          <div>
            <Link className="wordmark" href="/" aria-label="Vector home">
              VECTOR<span>[ BASE ]</span>
            </Link>
            <p>Intent execution for tokenized markets on Base.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#overview">Overview</a>
            <a href="#how-it-works">How it works</a>
            <a href="#current-state">Current state</a>
            <a href={DOCUMENTATION_URL} target="_blank" rel="noopener noreferrer">
              Documentation
            </a>
          </nav>
          <p className="landing-footer-legal">Hackathon MVP · Base Sepolia · Test assets only</p>
        </footer>
      </div>
    </main>
  );
}

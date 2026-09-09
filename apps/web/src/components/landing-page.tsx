"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

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
      </div>
    </main>
  );
}

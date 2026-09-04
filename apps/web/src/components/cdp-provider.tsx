"use client";

import { CDPHooksProvider } from "@coinbase/cdp-hooks";
import type { ReactNode } from "react";

import { readPublicCdpConfig } from "../lib/authorization";

export function CdpProvider({ children }: Readonly<{ children: ReactNode }>) {
  const config = readPublicCdpConfig(process.env.NEXT_PUBLIC_CDP_PROJECT_ID);

  if (!config.ok) {
    return (
      <div className="card" role="alert">
        <h2>CDP configuration required</h2>
        <p className="error">{config.error}</p>
        <p className="muted">
          Add the public project identifier to <code>apps/web/.env.local</code>. Never add a CDP API
          secret or wallet secret here.
        </p>
      </div>
    );
  }

  return (
    <CDPHooksProvider
      config={{
        projectId: config.projectId,
        ethereum: { createOnLogin: "smart" },
      }}
    >
      {children}
    </CDPHooksProvider>
  );
}

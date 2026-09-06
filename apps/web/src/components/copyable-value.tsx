"use client";

import { useState } from "react";

import { formatSmartAccountAddress } from "../lib/authorization";

export function CopyableValue({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1_500);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1_500);
    }
  }

  return (
    <span className="copyable-value" title={value}>
      <code aria-label={`${label}: ${value}`}>{formatSmartAccountAddress(value)}</code>
      <button
        aria-label={`Copy ${label}`}
        className="copy-button"
        onClick={() => void copy()}
        type="button"
      >
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
      </button>
    </span>
  );
}

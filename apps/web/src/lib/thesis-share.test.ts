import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_DEMO_THESIS, interpretDemoThesis } from "./executable-thesis.ts";
import {
  decodeSharePayload,
  persistedFromWorkingThesis,
  toPublicThesisPayload,
  type PersistedExecutableThesis,
} from "./persisted-thesis.ts";
import {
  OPEN_SHARED_VIEW_LABEL,
  attemptThesisShareLink,
  copyThesisShareLink,
  openSharedViewLinkProps,
  shareButtonLabel,
  type ShareClipboardEnvironment,
} from "./thesis-share.ts";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const CREATOR = "0x1111111111111111111111111111111111111111";

async function fixture() {
  return persistedFromWorkingThesis(
    interpretDemoThesis(DEFAULT_DEMO_THESIS, NOW),
    CREATOR,
    undefined,
    NOW,
  );
}

function fallbackEnvironment(copyResult: boolean) {
  const calls: string[] = [];
  let removed = false;
  const textarea = {
    value: "",
    readOnly: false,
    style: { opacity: "", pointerEvents: "", position: "" },
    select: () => calls.push("select"),
    setAttribute: () => undefined,
    setSelectionRange: () => calls.push("range"),
    remove: () => {
      removed = true;
    },
  };
  const environment: ShareClipboardEnvironment = {
    document: {
      body: { appendChild: () => calls.push("append") },
      createElement: () => textarea,
      execCommand: (command) => {
        calls.push(command);
        return copyResult;
      },
    },
  };
  return { calls, environment, removed: () => removed, textarea };
}

describe("thesis share UX", () => {
  it("generates the canonical origin share URL and round trips through the public route payload", async () => {
    const thesis = await fixture();
    let copiedUrl = "";
    const result = await copyThesisShareLink(thesis, "https://vector.example", {
      clipboard: { writeText: async (value) => void (copiedUrl = value) },
    });
    assert.equal(result.copied, true);
    assert.equal(copiedUrl, result.url);
    assert.match(result.url, /^https:\/\/vector\.example\/share\?thesis=/u);
    const encoded = new URL(result.url).searchParams.get("thesis");
    assert.ok(encoded);
    assert.deepEqual(decodeSharePayload(encoded), toPublicThesisPayload(thesis));
  });

  it("uses the Clipboard API when it succeeds", async () => {
    const thesis = await fixture();
    const writes: string[] = [];
    const result = await copyThesisShareLink(thesis, "https://vector.example", {
      clipboard: { writeText: async (value) => void writes.push(value) },
    });
    assert.equal(result.copied, true);
    assert.deepEqual(writes, [result.url]);
  });

  it("falls back to a temporary textarea after Clipboard API rejection and removes it", async () => {
    const thesis = await fixture();
    const fallback = fallbackEnvironment(true);
    const result = await copyThesisShareLink(thesis, "https://vector.example", {
      ...fallback.environment,
      clipboard: { writeText: async () => Promise.reject(new Error("denied")) },
    });
    assert.equal(result.copied, true);
    assert.equal(fallback.textarea.value, result.url);
    assert.deepEqual(fallback.calls, ["append", "select", "range", "copy"]);
    assert.equal(fallback.removed(), true);
  });

  it("returns failure when both copy mechanisms fail", async () => {
    const thesis = await fixture();
    const fallback = fallbackEnvironment(false);
    const result = await copyThesisShareLink(thesis, "https://vector.example", {
      ...fallback.environment,
      clipboard: { writeText: async () => Promise.reject(new Error("denied")) },
    });
    assert.equal(result.copied, false);
    assert.match(result.url, /^https:\/\/vector\.example\/share\?thesis=/u);
    assert.equal(fallback.removed(), true);
  });

  it("preserves the canonical URL when the clipboard environment itself fails", async () => {
    const thesis = await fixture();
    const result = await copyThesisShareLink(thesis, "https://vector.example", {
      clipboard: {
        writeText: () => {
          throw new Error("clipboard unavailable");
        },
      },
      document: {
        body: {
          appendChild: () => {
            throw new Error("document unavailable");
          },
        },
        createElement: () => {
          throw new Error("document unavailable");
        },
      },
    });
    assert.equal(result.copied, false);
    assert.match(result.url, /^https:\/\/vector\.example\/share\?thesis=/u);
  });

  it("opens the exact canonical URL in a safe new tab after copy failure", async () => {
    const thesis = await fixture();
    const result = await copyThesisShareLink(thesis, "https://vector.example", {});
    assert.equal(result.copied, false);
    assert.equal(OPEN_SHARED_VIEW_LABEL, "Open shared view");
    assert.deepEqual(openSharedViewLinkProps(result.url), {
      href: result.url,
      rel: "noopener noreferrer",
      target: "_blank",
    });
  });

  it("provides visible default, success, and failure labels for receipt and library buttons", () => {
    assert.equal(shareButtonLabel("library", "default"), "Copy share link");
    assert.equal(shareButtonLabel("receipt", "default"), "Share thesis");
    assert.equal(shareButtonLabel("library", "copied"), "Link copied");
    assert.equal(shareButtonLabel("receipt", "copied"), "Link copied");
    assert.equal(shareButtonLabel("library", "failed"), "Copy failed");
    assert.equal(shareButtonLabel("receipt", "failed"), "Copy failed");
    assert.equal(shareButtonLabel("library", "unavailable"), "Share link unavailable");
    assert.equal(shareButtonLabel("receipt", "unavailable"), "Share link unavailable");
  });

  it("distinguishes canonical URL generation failure from clipboard failure", async () => {
    const thesis = {
      ...(await fixture()),
      creator: 1n,
    } as unknown as PersistedExecutableThesis;
    const result = await attemptThesisShareLink(thesis, "https://vector.example", {});
    assert.deepEqual(result, { state: "unavailable" });
  });

  it("uses identical serialization and excludes execution and authorization fields", async () => {
    const thesis = {
      ...(await fixture()),
      balances: { musdc: 10 },
      receipt: { transactionHash: "0xtx" },
      smartAccountAuthorization: true,
      executionQuote: { buyAmount: "1" },
      adaptedExecutionAmount: 320,
      riskAcceptance: true,
      nonce: 7,
      calldata: "0x1234",
      approvalTarget: "0xapproval",
      executionTarget: "0xexecution",
      quote: { buyAmount: "1" },
      userOperationState: "CONFIRMED",
      targets: ["0xtarget"],
      transactionState: "CONFIRMED",
    };
    const library = await copyThesisShareLink(thesis, "https://vector.example", {
      clipboard: { writeText: async () => undefined },
    });
    const receipt = await copyThesisShareLink(thesis, "https://vector.example", {
      clipboard: { writeText: async () => undefined },
    });
    assert.equal(library.url, receipt.url);
    const payload = JSON.stringify(
      decodeSharePayload(new URL(library.url).searchParams.get("thesis") ?? ""),
    );
    for (const prohibited of [
      "balances",
      "receipt",
      "smartAccountAuthorization",
      "executionQuote",
      "adaptedExecutionAmount",
      "riskAcceptance",
      "nonce",
      "calldata",
      "approvalTarget",
      "executionTarget",
      "quote",
      "userOperationState",
      "targets",
      "transactionState",
    ]) {
      assert.equal(payload.includes(prohibited), false);
    }
  });
});

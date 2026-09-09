import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_DEMO_THESIS, interpretDemoThesis } from "../lib/executable-thesis.ts";
import {
  persistedFromWorkingThesis,
  type PersistedExecutableThesis,
} from "../lib/persisted-thesis.ts";
import { attemptThesisShareLink } from "../lib/thesis-share.ts";
import {
  CurrentThesisActionRow,
  LibraryThesisActionRow,
  ReceiptShareActionRow,
} from "./share-action.ts";

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

function renderShareActionRow(
  surface: "current" | "library" | "receipt",
  state: "default" | "failed" | "unavailable",
  fallbackUrl?: string,
) {
  const shared = { ...(fallbackUrl ? { fallbackUrl } : {}), state };
  const noop = () => undefined;
  const component =
    surface === "current"
      ? createElement(CurrentThesisActionRow, {
          ...shared,
          onRunRiskCheck: noop,
          onSave: noop,
          onShare: noop,
        })
      : surface === "library"
        ? createElement(LibraryThesisActionRow, {
            ...shared,
            onDelete: noop,
            onFork: noop,
            onOpen: noop,
            onShare: noop,
          })
        : createElement(ReceiptShareActionRow, { ...shared, onShare: noop });
  return renderToStaticMarkup(component);
}

async function failedShare() {
  const result = await attemptThesisShareLink(await fixture(), "https://vector.example", {});
  assert.equal(result.state, "failed");
  return result;
}

describe("rendered share actions", () => {
  it("renders Open shared view after clipboard failure in the current thesis action row", async () => {
    const result = await failedShare();
    const markup = renderShareActionRow("current", result.state, result.url);
    assert.match(markup, /Save thesis.*Copy failed.*Open shared view.*Run risk check/u);
    assert.match(markup, />Copy failed</u);
    assert.match(markup, />Open shared view</u);
  });

  it("renders Open shared view after clipboard failure in My Theses", async () => {
    const result = await failedShare();
    const markup = renderShareActionRow("library", result.state, result.url);
    assert.match(markup, />Copy failed</u);
    assert.match(markup, />Open shared view</u);
  });

  it("renders Open shared view after clipboard failure in the execution receipt", async () => {
    const result = await failedShare();
    const markup = renderShareActionRow("receipt", result.state, result.url);
    assert.match(markup, />Copy failed</u);
    assert.match(markup, />Open shared view</u);
  });

  it("keeps the fallback rendered after transient feedback resets", async () => {
    const result = await failedShare();
    const markup = renderShareActionRow("current", "default", result.url);
    assert.match(markup, />Copy share link</u);
    assert.match(markup, />Open shared view</u);
  });

  it("uses the generated canonical share URL as the safe fallback href", async () => {
    const result = await failedShare();
    const markup = renderShareActionRow("current", result.state, result.url);
    assert.match(result.url, /^https:\/\/vector\.example\/share\?thesis=/u);
    assert.ok(markup.includes(`href="${result.url}"`));
    assert.match(markup, /target="_blank"/u);
    assert.match(markup, /rel="noopener noreferrer"/u);
  });

  it("renders Share link unavailable and no copy failure when URL generation fails", async () => {
    const invalid = {
      ...(await fixture()),
      creator: 1n,
    } as unknown as PersistedExecutableThesis;
    const result = await attemptThesisShareLink(invalid, "https://vector.example", {});
    assert.equal(result.state, "unavailable");
    const markup = renderShareActionRow("current", result.state);
    assert.match(markup, />Share link unavailable</u);
    assert.doesNotMatch(markup, /Copy failed|Open shared view/u);
  });
});

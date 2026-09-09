import { createElement, Fragment } from "react";

import {
  OPEN_SHARED_VIEW_LABEL,
  openSharedViewLinkProps,
  shareButtonLabel,
  type ShareCopyState,
} from "../lib/thesis-share.ts";

export type ShareActionSurface = "current" | "library" | "receipt";

export function ShareAction({
  fallbackUrl,
  onShare,
  state,
  surface,
}: Readonly<{
  fallbackUrl?: string;
  onShare?: () => void;
  state: ShareCopyState;
  surface: ShareActionSurface;
}>) {
  const context = surface === "receipt" ? "receipt" : "library";
  const buttonClassName = surface === "library" ? "secondary compact" : "secondary";

  return createElement(
    Fragment,
    null,
    createElement(
      "button",
      { className: buttonClassName, onClick: onShare, type: "button" },
      createElement("span", { "aria-live": "polite" }, shareButtonLabel(context, state)),
    ),
    fallbackUrl
      ? createElement(
          "a",
          { className: "share-fallback-link", ...openSharedViewLinkProps(fallbackUrl) },
          OPEN_SHARED_VIEW_LABEL,
        )
      : null,
  );
}

export function CurrentThesisActionRow({
  fallbackUrl,
  onRunRiskCheck,
  onSave,
  onShare,
  state,
}: Readonly<{
  fallbackUrl?: string;
  onRunRiskCheck: () => void;
  onSave: () => void;
  onShare?: () => void;
  state: ShareCopyState;
}>) {
  return createElement(
    "div",
    { className: "inline-actions" },
    createElement(
      "button",
      { className: "secondary", onClick: onSave, type: "button" },
      "Save thesis",
    ),
    onShare
      ? createElement(ShareAction, {
          ...(fallbackUrl ? { fallbackUrl } : {}),
          onShare,
          state,
          surface: "current",
        })
      : null,
    createElement("button", { onClick: onRunRiskCheck, type: "button" }, "Run risk check"),
  );
}

export function LibraryThesisActionRow({
  fallbackUrl,
  onDelete,
  onFork,
  onOpen,
  onShare,
  state,
}: Readonly<{
  fallbackUrl?: string;
  onDelete: () => void;
  onFork: () => void;
  onOpen: () => void;
  onShare: () => void;
  state: ShareCopyState;
}>) {
  return createElement(
    "div",
    { className: "library-actions" },
    createElement(
      "button",
      { className: "secondary compact", onClick: onOpen, type: "button" },
      "Open / edit",
    ),
    createElement(
      "button",
      { className: "secondary compact", onClick: onFork, type: "button" },
      "Duplicate / fork",
    ),
    createElement(ShareAction, {
      ...(fallbackUrl ? { fallbackUrl } : {}),
      onShare,
      state,
      surface: "library",
    }),
    createElement(
      "button",
      { className: "danger compact", onClick: onDelete, type: "button" },
      "Delete",
    ),
  );
}

export function ReceiptShareActionRow({
  fallbackUrl,
  onShare,
  onViewMyTheses,
  state,
}: Readonly<{
  fallbackUrl?: string;
  onShare?: () => void;
  onViewMyTheses?: () => void;
  state: ShareCopyState;
}>) {
  return createElement(
    "div",
    { "aria-label": "Executed thesis actions", className: "receipt-actions" },
    createElement(ShareAction, {
      ...(fallbackUrl ? { fallbackUrl } : {}),
      ...(onShare ? { onShare } : {}),
      state,
      surface: "receipt",
    }),
    createElement(
      "button",
      {
        className: "secondary",
        ...(onViewMyTheses ? { onClick: onViewMyTheses } : {}),
        type: "button",
      },
      "View in My Theses",
    ),
  );
}

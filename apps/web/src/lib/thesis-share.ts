import { createShareUrl, type PersistedExecutableThesis } from "./persisted-thesis.ts";

export type ShareCopyState = "default" | "copied" | "failed";
export type ShareButtonContext = "library" | "receipt";

export const SHARE_FEEDBACK_DURATION_MS = 2_400;

interface ClipboardWriter {
  writeText(value: string): Promise<void>;
}

interface FallbackTextarea {
  value: string;
  readOnly: boolean;
  style: {
    opacity: string;
    pointerEvents: string;
    position: string;
  };
  select(): void;
  setAttribute(name: string, value: string): void;
  setSelectionRange(start: number, end: number): void;
  remove(): void;
}

interface FallbackDocument {
  body: { appendChild(element: FallbackTextarea): void };
  createElement(tagName: "textarea"): FallbackTextarea;
  execCommand?(command: "copy"): boolean;
}

export interface ShareClipboardEnvironment {
  readonly clipboard?: ClipboardWriter;
  readonly document?: FallbackDocument;
}

function browserClipboardEnvironment(): ShareClipboardEnvironment {
  return {
    ...(navigator.clipboard ? { clipboard: navigator.clipboard } : {}),
    document: {
      body: {
        appendChild: (element) => {
          document.body.appendChild(element as unknown as Node);
        },
      },
      createElement: () => document.createElement("textarea") as unknown as FallbackTextarea,
      execCommand: (command) => document.execCommand(command),
    },
  };
}

export function shareButtonLabel(context: ShareButtonContext, state: ShareCopyState): string {
  if (state === "copied") return "Link copied";
  if (state === "failed") return "Copy failed";
  return context === "receipt" ? "Share thesis" : "Copy share link";
}

function copyWithDocumentFallback(value: string, fallbackDocument?: FallbackDocument): boolean {
  if (!fallbackDocument?.execCommand) return false;
  const textarea = fallbackDocument.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  fallbackDocument.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    return fallbackDocument.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export async function copyTextWithFallback(
  value: string,
  environment: ShareClipboardEnvironment,
): Promise<boolean> {
  if (environment.clipboard) {
    try {
      await environment.clipboard.writeText(value);
      return true;
    } catch {
      // Continue to the DOM fallback; the caller renders an explicit failure if it also fails.
    }
  }
  return copyWithDocumentFallback(value, environment.document);
}

export async function copyThesisShareLink(
  thesis: PersistedExecutableThesis,
  origin: string,
  environment?: ShareClipboardEnvironment,
): Promise<Readonly<{ copied: boolean; url: string }>> {
  const url = createShareUrl(thesis, origin);
  return {
    copied: await copyTextWithFallback(url, environment ?? browserClipboardEnvironment()),
    url,
  };
}

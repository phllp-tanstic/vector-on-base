export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b" as const;
export const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions" as const;
export const MAX_THESIS_TEXT_LENGTH = 2_000;

export interface InterpretedMarketThesis {
  readonly asset: "NVDA";
  readonly rationale: string;
  readonly entryPriceUsd: number;
  readonly requestedSizeUsd: number;
  readonly maxExposurePercent: number;
  readonly reserveUsd: number;
  readonly maxSlippagePercent: number;
  readonly expiryIso: string;
}

export type GroqIntentErrorCode =
  | "CONFIGURATION_ERROR"
  | "INVALID_INPUT"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "UNSUPPORTED_ASSET"
  | "INVALID_RESPONSE";

export class GroqIntentError extends Error {
  readonly code: GroqIntentErrorCode;

  constructor(code: GroqIntentErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type IntentFetch = (
  input: string,
  init: Readonly<{
    method: "POST";
    headers: Readonly<Record<string, string>>;
    body: string;
    signal?: AbortSignal;
  }>,
) => Promise<FetchResponse>;

export interface GroqIntentOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly now?: Date;
  readonly fetchImpl?: IntentFetch;
  readonly signal?: AbortSignal;
}

const INTERPRETATION_KEYS = [
  "asset",
  "rationale",
  "entryPriceUsd",
  "requestedSizeUsd",
  "maxExposurePercent",
  "reserveUsd",
  "maxSlippagePercent",
  "expiryIso",
] as const;

export const MARKET_THESIS_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    asset: { type: "string", enum: ["NVDA"] },
    rationale: { type: "string", minLength: 1, maxLength: 500 },
    entryPriceUsd: { type: "number", minimum: 0.01, maximum: 1_000_000 },
    requestedSizeUsd: { type: "number", minimum: 0.01, maximum: 100_000_000 },
    maxExposurePercent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
    reserveUsd: { type: "number", minimum: 0, maximum: 100_000_000 },
    maxSlippagePercent: { type: "number", minimum: 0, maximum: 100 },
    expiryIso: { type: "string" },
  },
  required: INTERPRETATION_KEYS,
} as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

export function parseInterpretedMarketThesis(value: unknown): InterpretedMarketThesis {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== INTERPRETATION_KEYS.length ||
    !INTERPRETATION_KEYS.every((key) => Object.hasOwn(value, key)) ||
    value.asset !== "NVDA" ||
    typeof value.rationale !== "string" ||
    value.rationale.trim().length === 0 ||
    value.rationale.length > 500 ||
    !numberInRange(value.entryPriceUsd, 0.01, 1_000_000) ||
    !numberInRange(value.requestedSizeUsd, 0.01, 100_000_000) ||
    !numberInRange(value.maxExposurePercent, Number.MIN_VALUE, 100) ||
    !numberInRange(value.reserveUsd, 0, 100_000_000) ||
    !numberInRange(value.maxSlippagePercent, 0, 100) ||
    typeof value.expiryIso !== "string" ||
    !Number.isFinite(Date.parse(value.expiryIso))
  ) {
    throw new GroqIntentError("INVALID_RESPONSE", "Groq returned an invalid thesis structure.");
  }
  return Object.freeze({
    asset: "NVDA",
    rationale: value.rationale.trim(),
    entryPriceUsd: value.entryPriceUsd,
    requestedSizeUsd: value.requestedSizeUsd,
    maxExposurePercent: value.maxExposurePercent,
    reserveUsd: value.reserveUsd,
    maxSlippagePercent: value.maxSlippagePercent,
    expiryIso: new Date(value.expiryIso).toISOString(),
  });
}

function nextFridayAtFiveUtc(now: Date): string {
  const result = new Date(now);
  const days = (5 - result.getUTCDay() + 7) % 7 || 7;
  result.setUTCDate(result.getUTCDate() + days);
  result.setUTCHours(17, 0, 0, 0);
  return result.toISOString();
}

function validateRequest(sourceText: string, apiKey: string): string {
  const normalized = sourceText.trim();
  if (!normalized || normalized.length > MAX_THESIS_TEXT_LENGTH) {
    throw new GroqIntentError(
      "INVALID_INPUT",
      `The thesis must contain between 1 and ${MAX_THESIS_TEXT_LENGTH} characters.`,
    );
  }
  if (!/\b(?:NVDAc?|NVIDIA)\b/iu.test(normalized)) {
    throw new GroqIntentError(
      "UNSUPPORTED_ASSET",
      "The current live demo supports NVDA theses only.",
    );
  }
  if (!apiKey.trim()) {
    throw new GroqIntentError("CONFIGURATION_ERROR", "The Groq interpreter is not configured.");
  }
  return normalized;
}

function responseContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new GroqIntentError("INVALID_RESPONSE", "Groq returned an invalid response envelope.");
  }
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") {
    throw new GroqIntentError("INVALID_RESPONSE", "Groq returned no structured thesis.");
  }
  return first.message.content;
}

export async function interpretMarketThesisWithGroq(
  sourceText: string,
  options: GroqIntentOptions,
): Promise<InterpretedMarketThesis> {
  const normalized = validateRequest(sourceText, options.apiKey);
  const now = options.now ?? new Date();
  const model = options.model?.trim() || DEFAULT_GROQ_MODEL;
  const fallbackExpiry = nextFridayAtFiveUtc(now);
  const fetchImpl = options.fetchImpl ?? (fetch as IntentFetch);
  let response: FetchResponse;

  try {
    response = await fetchImpl(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Interpret the user's NVDA market thesis into bounded parameters. Never authorize, quote, size against a portfolio, or construct a transaction. Preserve explicit user values. If omitted, use these demo defaults: entryPriceUsd 170, requestedSizeUsd 500, maxExposurePercent 10, reserveUsd 1000, maxSlippagePercent 1, and expiryIso " +
              fallbackExpiry +
              ". Resolve relative dates from " +
              now.toISOString() +
              ". Return a concise factual rationale.",
          },
          { role: "user", content: normalized },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "vector_market_thesis",
            strict: true,
            schema: MARKET_THESIS_JSON_SCHEMA,
          },
        },
        temperature: 0,
        max_completion_tokens: 600,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    throw new GroqIntentError("PROVIDER_ERROR", "Groq could not be reached.");
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new GroqIntentError("RATE_LIMITED", "Groq rate limit reached. Try again shortly.");
    }
    throw new GroqIntentError("PROVIDER_ERROR", "Groq could not interpret this thesis.");
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new GroqIntentError("INVALID_RESPONSE", "Groq returned unreadable output.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseContent(envelope)) as unknown;
  } catch (error) {
    if (error instanceof GroqIntentError) throw error;
    throw new GroqIntentError("INVALID_RESPONSE", "Groq returned malformed structured output.");
  }
  return parseInterpretedMarketThesis(parsed);
}

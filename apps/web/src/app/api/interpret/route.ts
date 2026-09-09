import { DEFAULT_GROQ_MODEL, GroqIntentError, interpretMarketThesisWithGroq } from "@vector/intent";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 4_096;
const REQUESTS_PER_MINUTE = 10;
const MAX_TRACKED_CLIENTS = 1_000;
const requestWindows = new Map<string, { count: number; startedAt: number }>();

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function rateLimited(request: Request, now = Date.now()): boolean {
  const key = clientKey(request);
  const current = requestWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    if (!current && requestWindows.size >= MAX_TRACKED_CLIENTS) return true;
    requestWindows.set(key, { count: 1, startedAt: now });
    return false;
  }
  current.count += 1;
  return current.count > REQUESTS_PER_MINUTE;
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return errorResponse("The request must use application/json.", 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("The thesis request is too large.", 413);
  }
  if (rateLimited(request)) return errorResponse("Too many interpretation requests.", 429);

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return errorResponse("The thesis request is too large.", 413);
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return errorResponse("The request body must be valid JSON.", 400);
  }
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("sourceText" in body) ||
    typeof body.sourceText !== "string"
  ) {
    return errorResponse("A market thesis is required.", 400);
  }

  try {
    const interpretation = await interpretMarketThesisWithGroq(body.sourceText, {
      apiKey: process.env.GROQ_API_KEY ?? "",
      model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
      signal: AbortSignal.timeout(15_000),
    });
    return NextResponse.json({ interpretation });
  } catch (error) {
    if (!(error instanceof GroqIntentError)) {
      return errorResponse("The AI interpreter failed unexpectedly.", 500);
    }
    const statuses: Record<GroqIntentError["code"], number> = {
      CONFIGURATION_ERROR: 503,
      INVALID_INPUT: 400,
      INVALID_RESPONSE: 502,
      PROVIDER_ERROR: 502,
      RATE_LIMITED: 429,
      UNSUPPORTED_ASSET: 422,
    };
    return errorResponse(error.message, statuses[error.code]);
  }
}

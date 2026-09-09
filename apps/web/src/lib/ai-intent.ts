import { parseInterpretedMarketThesis, type InterpretedMarketThesis } from "@vector/intent";

interface InterpretationResponse {
  readonly interpretation?: unknown;
  readonly error?: unknown;
}

export async function requestAiThesisInterpretation(
  sourceText: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InterpretedMarketThesis> {
  let response: Response;
  try {
    response = await fetchImpl("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceText }),
    });
  } catch {
    throw new Error("The AI interpreter could not be reached. Try again.");
  }

  let body: InterpretationResponse;
  try {
    body = (await response.json()) as InterpretationResponse;
  } catch {
    throw new Error("The AI interpreter returned an unreadable response.");
  }
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : "The AI interpreter could not process this thesis.",
    );
  }
  return parseInterpretedMarketThesis(body.interpretation);
}

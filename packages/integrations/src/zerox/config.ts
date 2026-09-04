export const ZEROX_API_KEY_ENV_VAR = "ZEROX_API_KEY" as const;
export const ZEROX_API_BASE_URL_ENV_VAR = "ZEROX_API_BASE_URL" as const;
export const DEFAULT_ZEROX_API_BASE_URL = "https://api.0x.org" as const;

export interface ZeroXApiConfig {
  readonly apiBaseUrl: string;
  readonly apiKey: string;
}

export class ZeroXConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR" as const;
}

export function loadZeroXApiConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ZeroXApiConfig {
  const apiKey = environment[ZEROX_API_KEY_ENV_VAR]?.trim();

  if (!apiKey) {
    throw new ZeroXConfigurationError(`${ZEROX_API_KEY_ENV_VAR} must be configured.`);
  }

  const apiBaseUrl = environment[ZEROX_API_BASE_URL_ENV_VAR]?.trim() || DEFAULT_ZEROX_API_BASE_URL;

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(apiBaseUrl);
  } catch {
    throw new ZeroXConfigurationError(`${ZEROX_API_BASE_URL_ENV_VAR} must be a valid HTTP(S) URL.`);
  }

  const isLoopbackHttp =
    parsedUrl.protocol === "http:" &&
    (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1");

  if (parsedUrl.protocol !== "https:" && !isLoopbackHttp) {
    throw new ZeroXConfigurationError(
      `${ZEROX_API_BASE_URL_ENV_VAR} must use HTTPS (HTTP is allowed only for loopback testing).`,
    );
  }

  return Object.freeze({ apiBaseUrl: parsedUrl.toString().replace(/\/$/, ""), apiKey });
}

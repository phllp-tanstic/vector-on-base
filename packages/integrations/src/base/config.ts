export const BASE_RPC_URL_ENV_VAR = "BASE_RPC_URL" as const;
export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org" as const;

export interface BaseRpcConfig {
  readonly rpcUrl: string;
}

export type BaseRpcConfigurationErrorCode = "INVALID_RPC_URL" | "WRONG_CHAIN";

export class BaseRpcConfigurationError extends Error {
  readonly code: BaseRpcConfigurationErrorCode;

  constructor(code: BaseRpcConfigurationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function loadBaseRpcConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): BaseRpcConfig {
  const rpcUrl = environment[BASE_RPC_URL_ENV_VAR]?.trim() || DEFAULT_BASE_RPC_URL;

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rpcUrl);
  } catch {
    throw new BaseRpcConfigurationError(
      "INVALID_RPC_URL",
      `${BASE_RPC_URL_ENV_VAR} must be a valid HTTP(S) URL.`,
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new BaseRpcConfigurationError(
      "INVALID_RPC_URL",
      `${BASE_RPC_URL_ENV_VAR} must use the HTTP or HTTPS protocol.`,
    );
  }

  return Object.freeze({ rpcUrl });
}

export const BASE_SEPOLIA_NETWORK = "base-sepolia" as const;
export const BASE_SEPOLIA_CHAIN_ID = 84_532;
export const BASE_SEPOLIA_LABEL = `Base Sepolia (${BASE_SEPOLIA_CHAIN_ID})`;
export const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";

export const SAFE_AUTHORIZATION_CALL = {
  to: "0x0000000000000000000000000000000000000000" as const,
  value: 0n,
  data: "0x" as const,
};

export function buildSafeAuthorizationRequest(
  explicitUserAction: boolean,
  smartAccountAddress: `0x${string}`,
): {
  evmSmartAccount: `0x${string}`;
  network: typeof BASE_SEPOLIA_NETWORK;
  calls: Array<typeof SAFE_AUTHORIZATION_CALL>;
} | null {
  if (!explicitUserAction) return null;
  return {
    evmSmartAccount: smartAccountAddress,
    network: BASE_SEPOLIA_NETWORK,
    calls: [SAFE_AUTHORIZATION_CALL],
  };
}

export type PublicCdpConfig = { ok: true; projectId: string } | { ok: false; error: string };

export function readPublicCdpConfig(projectId: string | undefined): PublicCdpConfig {
  const normalized = projectId?.trim();
  if (!normalized) {
    return {
      ok: false,
      error: "NEXT_PUBLIC_CDP_PROJECT_ID is missing.",
    };
  }
  return { ok: true, projectId: normalized };
}

export function formatSmartAccountAddress(address: string | null | undefined): string {
  if (!address) return "Not created";
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function asEvmAddress(address: string | null | undefined): `0x${string}` | undefined {
  return /^0x[0-9a-fA-F]{40}$/.test(address ?? "")
    ? (address!.toLowerCase() as `0x${string}`)
    : undefined;
}

export function canTestAuthorization(
  isAuthenticated: boolean,
  smartAccountAddress: string | null | undefined,
  status: string,
): smartAccountAddress is `0x${string}` {
  return (
    isAuthenticated && /^0x[0-9a-fA-F]{40}$/.test(smartAccountAddress ?? "") && status !== "pending"
  );
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected authorization error.";
}

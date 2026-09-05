import { VECTOR_CHAIN_ID, type EvmAddress, type VectorChainId } from "@vector/shared";

export const ZEROX_CONTRACT_MANIFEST_VERSION = "ZEROX_BASE_CONTRACTS_V1" as const;

export type ZeroXContractRole = "ALLOWANCE_HOLDER" | "SETTLER";

export interface TrustedZeroXContract {
  readonly address: EvmAddress;
  readonly role: ZeroXContractRole;
  readonly deployment: string;
  readonly provenance: string;
}

export interface ZeroXContractManifest {
  readonly chainId: VectorChainId;
  readonly contracts: readonly TrustedZeroXContract[];
  readonly version: typeof ZEROX_CONTRACT_MANIFEST_VERSION;
}

/**
 * Deliberately reviewed production boundary. Runtime quote responses cannot add entries.
 *
 * 0x documents this Cancun AllowanceHolder deployment for Base at:
 * https://docs.0x.org/docs/core-concepts/contracts#allowanceholder-addresses
 */
export const BASE_MAINNET_ZEROX_CONTRACTS = Object.freeze({
  chainId: VECTOR_CHAIN_ID,
  contracts: Object.freeze([
    Object.freeze({
      address: "0x0000000000001fF3684f28c67538d4D072C22734",
      deployment: "CANCUN_ALLOWANCE_HOLDER",
      provenance: "https://docs.0x.org/docs/core-concepts/contracts#allowanceholder-addresses",
      role: "ALLOWANCE_HOLDER",
    }),
  ]),
  version: ZEROX_CONTRACT_MANIFEST_VERSION,
}) satisfies ZeroXContractManifest;

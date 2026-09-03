import { assertB20AssetAddress, B20_ASSET_VARIANT } from "@vector/b20";
import type { B20VectorAsset, EvmAddress } from "@vector/shared";
import { getAddress, type Hex } from "viem";

import type { BasePublicClient } from "./client.ts";

export const B20_FACTORY_ADDRESS = getAddress("0xB20f000000000000000000000000000000000000");

// Native B20 accounts use this factory-written initialization marker. Their callable
// implementation is provided by Base's node precompile, not by this byte as EVM runtime code.
export const B20_NATIVE_MARKER_CODE = "0xef" as const;

export const B20_INTERFACE_IDS = {
  ERC165: "0x01ffc9a7",
  ERC8056_BALANCES: "0xd890fd71",
  ERC8056_CONVERSION: "0x57854fc3",
  ERC8056_CORE: "0xa60bf13d",
  ERC8056_PENDING: "0x4bd27648",
} as const satisfies Readonly<Record<string, Hex>>;

const B20_FACTORY_ABI = [
  {
    inputs: [{ name: "token", type: "address" }],
    name: "isB20",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "isB20Initialized",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const B20_ASSET_VERIFICATION_ABI = [
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "multiplier",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "uiMultiplier",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    name: "supportsInterface",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const B20_READS_PER_ASSET = 11;

interface SuccessfulVerificationRead {
  readonly result: unknown;
  readonly status: "success";
}

interface FailedVerificationRead {
  readonly error: Error;
  readonly status: "failure";
}

type VerificationRead = FailedVerificationRead | SuccessfulVerificationRead;

export interface B20InterfaceSupport {
  readonly erc165: boolean | null;
  readonly erc8056Balances: boolean | null;
  readonly erc8056Conversion: boolean | null;
  readonly erc8056Core: boolean | null;
  readonly erc8056Pending: boolean | null;
}

export interface B20AssetVerificationResult {
  readonly address: EvmAddress;
  readonly addressVariant: typeof B20_ASSET_VARIANT;
  readonly code: Hex;
  readonly decimals: number;
  readonly factoryInitialized: boolean;
  readonly factoryRecognized: boolean;
  readonly interfaces: B20InterfaceSupport;
  readonly multiplier: bigint;
  readonly symbol: string;
  readonly uiMultiplier: bigint | null;
}

export type B20VerificationErrorCode =
  | "DECIMALS_MISMATCH"
  | "FACTORY_NOT_INITIALIZED"
  | "FACTORY_NOT_RECOGNIZED"
  | "INTERFACE_NOT_SUPPORTED"
  | "INVALID_MARKER_CODE"
  | "INVALID_MULTIPLIER"
  | "INVALID_RESPONSE"
  | "MULTIPLIER_ALIAS_MISMATCH"
  | "SYMBOL_MISMATCH";

export class B20VerificationError extends Error {
  readonly code: B20VerificationErrorCode;

  constructor(code: B20VerificationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function createVerificationContracts(address: EvmAddress) {
  return [
    { abi: B20_ASSET_VERIFICATION_ABI, address, functionName: "decimals" },
    {
      abi: B20_FACTORY_ABI,
      address: B20_FACTORY_ADDRESS,
      args: [address],
      functionName: "isB20Initialized",
    },
    {
      abi: B20_FACTORY_ABI,
      address: B20_FACTORY_ADDRESS,
      args: [address],
      functionName: "isB20",
    },
    { abi: B20_ASSET_VERIFICATION_ABI, address, functionName: "multiplier" },
    { abi: B20_ASSET_VERIFICATION_ABI, address, functionName: "symbol" },
    { abi: B20_ASSET_VERIFICATION_ABI, address, functionName: "uiMultiplier" },
    {
      abi: B20_ASSET_VERIFICATION_ABI,
      address,
      args: [B20_INTERFACE_IDS.ERC165],
      functionName: "supportsInterface",
    },
    {
      abi: B20_ASSET_VERIFICATION_ABI,
      address,
      args: [B20_INTERFACE_IDS.ERC8056_BALANCES],
      functionName: "supportsInterface",
    },
    {
      abi: B20_ASSET_VERIFICATION_ABI,
      address,
      args: [B20_INTERFACE_IDS.ERC8056_CONVERSION],
      functionName: "supportsInterface",
    },
    {
      abi: B20_ASSET_VERIFICATION_ABI,
      address,
      args: [B20_INTERFACE_IDS.ERC8056_CORE],
      functionName: "supportsInterface",
    },
    {
      abi: B20_ASSET_VERIFICATION_ABI,
      address,
      args: [B20_INTERFACE_IDS.ERC8056_PENDING],
      functionName: "supportsInterface",
    },
  ] as const;
}

function getRequiredResult(read: VerificationRead | undefined, asset: B20VectorAsset): unknown {
  if (read === undefined) {
    throw new B20VerificationError(
      "INVALID_RESPONSE",
      `${asset.symbol} verification returned an incomplete response.`,
    );
  }

  if (read.status === "failure") throw read.error;
  return read.result;
}

function getOptionalResult(read: VerificationRead | undefined): unknown | null {
  return read?.status === "success" ? read.result : null;
}

function verifyB20AssetResult(
  asset: B20VectorAsset,
  address: EvmAddress,
  code: Hex | undefined,
  reads: readonly VerificationRead[],
): B20AssetVerificationResult {
  const [
    decimalsRead,
    factoryInitializedRead,
    factoryRecognizedRead,
    multiplierRead,
    symbolRead,
    uiMultiplierRead,
    erc165Read,
    erc8056BalancesRead,
    erc8056ConversionRead,
    erc8056CoreRead,
    erc8056PendingRead,
  ] = reads;

  const decimals = getRequiredResult(decimalsRead, asset);
  const factoryInitialized = getRequiredResult(factoryInitializedRead, asset);
  const factoryRecognized = getRequiredResult(factoryRecognizedRead, asset);
  const multiplier = getRequiredResult(multiplierRead, asset);
  const symbol = getRequiredResult(symbolRead, asset);
  const uiMultiplier = getOptionalResult(uiMultiplierRead);
  const erc165 = getOptionalResult(erc165Read);
  const erc8056Balances = getOptionalResult(erc8056BalancesRead);
  const erc8056Conversion = getOptionalResult(erc8056ConversionRead);
  const erc8056Core = getOptionalResult(erc8056CoreRead);
  const erc8056Pending = getOptionalResult(erc8056PendingRead);

  if (
    typeof decimals !== "number" ||
    typeof factoryInitialized !== "boolean" ||
    typeof factoryRecognized !== "boolean" ||
    typeof multiplier !== "bigint" ||
    typeof symbol !== "string" ||
    (uiMultiplier !== null && typeof uiMultiplier !== "bigint") ||
    (erc165 !== null && typeof erc165 !== "boolean") ||
    (erc8056Balances !== null && typeof erc8056Balances !== "boolean") ||
    (erc8056Conversion !== null && typeof erc8056Conversion !== "boolean") ||
    (erc8056Core !== null && typeof erc8056Core !== "boolean") ||
    (erc8056Pending !== null && typeof erc8056Pending !== "boolean")
  ) {
    throw new B20VerificationError(
      "INVALID_RESPONSE",
      `${asset.symbol} verification returned an unexpected response type.`,
    );
  }

  if (code !== B20_NATIVE_MARKER_CODE) {
    throw new B20VerificationError(
      "INVALID_MARKER_CODE",
      `${asset.symbol} returned unexpected B20 marker code: ${code ?? "none"}.`,
    );
  }

  if (!factoryRecognized) {
    throw new B20VerificationError(
      "FACTORY_NOT_RECOGNIZED",
      `${asset.symbol} is not recognized by the B20 factory.`,
    );
  }

  if (!factoryInitialized) {
    throw new B20VerificationError(
      "FACTORY_NOT_INITIALIZED",
      `${asset.symbol} is not initialized according to the B20 factory.`,
    );
  }

  if (symbol !== asset.symbol) {
    throw new B20VerificationError(
      "SYMBOL_MISMATCH",
      `${asset.symbol} returned unexpected onchain symbol ${symbol}.`,
    );
  }

  if (decimals !== asset.decimals) {
    throw new B20VerificationError(
      "DECIMALS_MISMATCH",
      `${asset.symbol} returned ${decimals} decimals; registry expects ${asset.decimals}.`,
    );
  }

  if (multiplier === 0n || uiMultiplier === 0n) {
    throw new B20VerificationError(
      "INVALID_MULTIPLIER",
      `${asset.symbol} returned a zero multiplier.`,
    );
  }

  if (uiMultiplier !== null && multiplier !== uiMultiplier) {
    throw new B20VerificationError(
      "MULTIPLIER_ALIAS_MISMATCH",
      `${asset.symbol} multiplier() and uiMultiplier() do not match.`,
    );
  }

  const interfaces = {
    erc165,
    erc8056Balances,
    erc8056Conversion,
    erc8056Core,
    erc8056Pending,
  };
  const interfaceResults = Object.values(interfaces);
  const supportsInterfaceAvailable = interfaceResults.some((supported) => supported !== null);

  if (supportsInterfaceAvailable && interfaceResults.some((supported) => supported !== true)) {
    throw new B20VerificationError(
      "INTERFACE_NOT_SUPPORTED",
      `${asset.symbol} does not advertise every documented ERC-165/ERC-8056 interface.`,
    );
  }

  return Object.freeze({
    address,
    addressVariant: B20_ASSET_VARIANT,
    code,
    decimals,
    factoryInitialized,
    factoryRecognized,
    interfaces: Object.freeze(interfaces),
    multiplier,
    symbol,
    uiMultiplier,
  });
}

export async function verifyB20Assets(
  client: BasePublicClient,
  assets: readonly B20VectorAsset[],
): Promise<readonly B20AssetVerificationResult[]> {
  const addresses = assets.map((asset) => {
    assertB20AssetAddress(asset.tokenAddress);
    return getAddress(asset.tokenAddress);
  });
  const contracts = addresses.flatMap((address) => createVerificationContracts(address));

  const [codes, reads] = await Promise.all([
    Promise.all(addresses.map((address) => client.getCode({ address }))),
    client.multicall({ allowFailure: true, contracts }),
  ]);

  return Object.freeze(
    assets.map((asset, index) => {
      const start = index * B20_READS_PER_ASSET;
      return verifyB20AssetResult(
        asset,
        addresses[index]!,
        codes[index],
        reads.slice(start, start + B20_READS_PER_ASSET),
      );
    }),
  );
}

export async function verifyB20Asset(
  client: BasePublicClient,
  asset: B20VectorAsset,
): Promise<B20AssetVerificationResult> {
  const [result] = await verifyB20Assets(client, [asset]);
  return result!;
}

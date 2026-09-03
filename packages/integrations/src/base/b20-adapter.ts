import {
  b20Multiplier,
  b20RawAmount,
  type B20Multiplier,
  type B20RawAmount,
  type B20ReadAdapter,
  type B20UIAmount,
  isB20AssetAddress,
  rawToUIAmount,
  uiToRawAmount,
} from "@vector/b20";
import type { B20VectorAsset, EvmAddress } from "@vector/shared";
import { getAddress } from "viem";

import { BASE_MAINNET_ASSET_REGISTRY } from "./assets.ts";
import { basePublicClient, type BasePublicClient } from "./client.ts";

const B20_REQUIRED_READ_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
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
] as const;

const B20_OPTIONAL_READ_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOfUI",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "scaledBalanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "rawAmount", type: "uint256" }],
    name: "toUIAmount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "rawAmount", type: "uint256" }],
    name: "toScaledBalance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "uiAmount", type: "uint256" }],
    name: "fromUIAmount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "uiAmount", type: "uint256" }],
    name: "toRawBalance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type B20AdapterErrorCode =
  | "ASSET_DISABLED"
  | "ASSET_IDENTITY_MISMATCH"
  | "ASSET_NOT_REGISTERED"
  | "INVALID_ACCOUNT_ADDRESS"
  | "INVALID_ASSET_ADDRESS"
  | "MULTIPLIER_READ_FAILED"
  | "NOT_B20_ASSET"
  | "OPTIONAL_READ_MISMATCH"
  | "RAW_BALANCE_READ_FAILED";

export class B20AdapterError extends Error {
  readonly code: B20AdapterErrorCode;

  constructor(code: B20AdapterErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type B20OptionalMethodResult =
  { readonly status: "available"; readonly value: bigint } | { readonly status: "unavailable" };

export interface B20OptionalMethodInspection {
  readonly balanceOfUI: B20OptionalMethodResult;
  readonly canonicalMultiplier: B20Multiplier;
  readonly canonicalRawBalance: B20RawAmount;
  readonly fromUIAmount: B20OptionalMethodResult;
  readonly scaledBalanceOf: B20OptionalMethodResult;
  readonly toRawBalance: B20OptionalMethodResult;
  readonly toScaledBalance: B20OptionalMethodResult;
  readonly toUIAmount: B20OptionalMethodResult;
}

export interface B20BalanceRead {
  readonly asset: B20VectorAsset;
  readonly economicBalance: B20UIAmount;
  readonly multiplier: B20Multiplier;
  readonly rawBalance: B20RawAmount;
}

interface OptionalRead {
  readonly result?: unknown;
  readonly status: "failure" | "success";
}

function checkedOptionalRead(
  method: string,
  read: OptionalRead,
  expected: bigint,
): B20OptionalMethodResult {
  if (read.status === "failure") {
    return Object.freeze({ status: "unavailable" });
  }

  if (typeof read.result !== "bigint" || read.result !== expected) {
    throw new B20AdapterError(
      "OPTIONAL_READ_MISMATCH",
      `${method} did not match Vector's local B20 conversion.`,
    );
  }

  return Object.freeze({ status: "available", value: read.result });
}

function requiredUint256(method: "balanceOf" | "multiplier", read: OptionalRead): bigint {
  if (read.status === "failure" || typeof read.result !== "bigint") {
    throw new B20AdapterError(
      method === "multiplier" ? "MULTIPLIER_READ_FAILED" : "RAW_BALANCE_READ_FAILED",
      `Unable to read canonical ${method}().`,
    );
  }

  return read.result;
}

export class BaseMainnetB20Adapter implements B20ReadAdapter {
  readonly #client: BasePublicClient;

  constructor(client: BasePublicClient = basePublicClient) {
    this.#client = client;
  }

  #resolveAsset(asset: B20VectorAsset): B20VectorAsset {
    if (!isB20AssetAddress(asset.tokenAddress)) {
      throw new B20AdapterError(
        "INVALID_ASSET_ADDRESS",
        `Invalid B20 Asset address: ${asset.tokenAddress}`,
      );
    }

    const address = getAddress(asset.tokenAddress);
    const registered = BASE_MAINNET_ASSET_REGISTRY.getByAddress(address);

    if (registered === undefined) {
      throw new B20AdapterError(
        "ASSET_NOT_REGISTERED",
        `B20 asset is not registered for Base Mainnet: ${address}`,
      );
    }

    if (registered.assetStandard !== "B20") {
      throw new B20AdapterError("NOT_B20_ASSET", `${registered.symbol} is not a B20 asset.`);
    }

    if (registered.symbol !== asset.symbol) {
      throw new B20AdapterError(
        "ASSET_IDENTITY_MISMATCH",
        `B20 asset identity does not match the registry entry for ${address}.`,
      );
    }

    if (!registered.enabled) {
      throw new B20AdapterError("ASSET_DISABLED", `${registered.symbol} is disabled.`);
    }

    return registered;
  }

  #resolveAccount(account: EvmAddress): EvmAddress {
    try {
      return getAddress(account);
    } catch {
      throw new B20AdapterError("INVALID_ACCOUNT_ADDRESS", `Invalid account address: ${account}`);
    }
  }

  async rawBalanceOf(
    asset: B20VectorAsset,
    account: EvmAddress,
    blockNumber?: bigint,
  ): Promise<B20RawAmount> {
    const registered = this.#resolveAsset(asset);
    const validAccount = this.#resolveAccount(account);
    const value = await this.#client.readContract({
      abi: B20_REQUIRED_READ_ABI,
      address: getAddress(registered.tokenAddress),
      args: [validAccount],
      ...(blockNumber === undefined ? {} : { blockNumber }),
      functionName: "balanceOf",
    });

    return b20RawAmount(value);
  }

  async multiplier(asset: B20VectorAsset, blockNumber?: bigint): Promise<B20Multiplier> {
    const registered = this.#resolveAsset(asset);

    try {
      const value = await this.#client.readContract({
        abi: B20_REQUIRED_READ_ABI,
        address: getAddress(registered.tokenAddress),
        ...(blockNumber === undefined ? {} : { blockNumber }),
        functionName: "multiplier",
      });

      return b20Multiplier(value);
    } catch (error) {
      if (error instanceof B20AdapterError) throw error;
      throw new B20AdapterError(
        "MULTIPLIER_READ_FAILED",
        `Unable to read the canonical multiplier for ${registered.symbol}.`,
      );
    }
  }

  async uiBalanceOf(asset: B20VectorAsset, account: EvmAddress): Promise<B20UIAmount> {
    const [rawAmount, multiplier] = await Promise.all([
      this.rawBalanceOf(asset, account),
      this.multiplier(asset),
    ]);

    return rawToUIAmount(rawAmount, multiplier);
  }

  async toUIAmount(asset: B20VectorAsset, rawAmount: B20RawAmount): Promise<B20UIAmount> {
    return rawToUIAmount(rawAmount, await this.multiplier(asset));
  }

  async fromUIAmount(asset: B20VectorAsset, uiAmount: B20UIAmount): Promise<B20RawAmount> {
    return uiToRawAmount(uiAmount, await this.multiplier(asset));
  }

  async readBalances(
    assets: readonly B20VectorAsset[],
    account: EvmAddress,
    blockNumber?: bigint,
  ): Promise<readonly B20BalanceRead[]> {
    const registeredAssets = assets.map((asset) => this.#resolveAsset(asset));
    const validAccount = this.#resolveAccount(account);
    const contracts = registeredAssets.flatMap((asset) => {
      const address = getAddress(asset.tokenAddress);

      return [
        {
          abi: B20_REQUIRED_READ_ABI,
          address,
          args: [validAccount],
          functionName: "balanceOf",
        },
        {
          abi: B20_REQUIRED_READ_ABI,
          address,
          functionName: "multiplier",
        },
      ] as const;
    });
    const reads = await this.#client.multicall({
      allowFailure: true,
      ...(blockNumber === undefined ? {} : { blockNumber }),
      contracts,
    });

    return Object.freeze(
      registeredAssets.map((asset, index) => {
        const rawBalance = b20RawAmount(requiredUint256("balanceOf", reads[index * 2]!));
        const multiplier = b20Multiplier(requiredUint256("multiplier", reads[index * 2 + 1]!));

        return Object.freeze({
          asset,
          economicBalance: rawToUIAmount(rawBalance, multiplier),
          multiplier,
          rawBalance,
        });
      }),
    );
  }

  async inspectOptionalMethods(
    asset: B20VectorAsset,
    account: EvmAddress,
    rawAmount: B20RawAmount,
    uiAmount: B20UIAmount,
  ): Promise<B20OptionalMethodInspection> {
    const registered = this.#resolveAsset(asset);
    const validAccount = this.#resolveAccount(account);
    const address = getAddress(registered.tokenAddress);
    const reads = await this.#client.multicall({
      allowFailure: true,
      contracts: [
        {
          abi: B20_REQUIRED_READ_ABI,
          address,
          args: [validAccount],
          functionName: "balanceOf",
        },
        {
          abi: B20_REQUIRED_READ_ABI,
          address,
          functionName: "multiplier",
        },
        {
          abi: B20_OPTIONAL_READ_ABI,
          address,
          args: [validAccount],
          functionName: "balanceOfUI",
        },
        {
          abi: B20_OPTIONAL_READ_ABI,
          address,
          args: [validAccount],
          functionName: "scaledBalanceOf",
        },
        {
          abi: B20_OPTIONAL_READ_ABI,
          address,
          args: [rawAmount],
          functionName: "toUIAmount",
        },
        {
          abi: B20_OPTIONAL_READ_ABI,
          address,
          args: [rawAmount],
          functionName: "toScaledBalance",
        },
        {
          abi: B20_OPTIONAL_READ_ABI,
          address,
          args: [uiAmount],
          functionName: "fromUIAmount",
        },
        {
          abi: B20_OPTIONAL_READ_ABI,
          address,
          args: [uiAmount],
          functionName: "toRawBalance",
        },
      ],
    });
    const [
      rawBalanceRead,
      multiplierRead,
      balanceOfUIRead,
      scaledBalanceOfRead,
      toUIAmountRead,
      toScaledBalanceRead,
      fromUIAmountRead,
      toRawBalanceRead,
    ] = reads;
    const rawBalance = b20RawAmount(requiredUint256("balanceOf", rawBalanceRead));
    const multiplier = b20Multiplier(requiredUint256("multiplier", multiplierRead));
    const expectedUIBalance = rawToUIAmount(rawBalance, multiplier);
    const expectedUIAmount = rawToUIAmount(rawAmount, multiplier);
    const expectedRawAmount = uiToRawAmount(uiAmount, multiplier);

    return Object.freeze({
      balanceOfUI: checkedOptionalRead("balanceOfUI", balanceOfUIRead, expectedUIBalance),
      canonicalMultiplier: multiplier,
      canonicalRawBalance: rawBalance,
      fromUIAmount: checkedOptionalRead("fromUIAmount", fromUIAmountRead, expectedRawAmount),
      scaledBalanceOf: checkedOptionalRead(
        "scaledBalanceOf",
        scaledBalanceOfRead,
        expectedUIBalance,
      ),
      toRawBalance: checkedOptionalRead("toRawBalance", toRawBalanceRead, expectedRawAmount),
      toScaledBalance: checkedOptionalRead(
        "toScaledBalance",
        toScaledBalanceRead,
        expectedUIAmount,
      ),
      toUIAmount: checkedOptionalRead("toUIAmount", toUIAmountRead, expectedUIAmount),
    });
  }
}

export function createBaseMainnetB20Adapter(
  client: BasePublicClient = basePublicClient,
): BaseMainnetB20Adapter {
  return new BaseMainnetB20Adapter(client);
}

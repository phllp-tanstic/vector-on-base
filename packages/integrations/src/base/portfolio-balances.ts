import { type B20Multiplier, type B20RawAmount, type B20UIAmount } from "@vector/b20";
import type { B20VectorAsset, Erc20VectorAsset, EvmAddress } from "@vector/shared";
import { getAddress } from "viem";

import { BASE_MAINNET_ASSET_REGISTRY } from "./assets.ts";
import { BaseMainnetB20Adapter } from "./b20-adapter.ts";
import { basePublicClient, type BasePublicClient } from "./client.ts";

const ERC20_BALANCE_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface BaseErc20BalanceRead {
  readonly asset: Erc20VectorAsset;
  readonly rawBalance: bigint;
  readonly tokenDecimals: number;
}

export interface BaseB20BalanceRead {
  readonly asset: B20VectorAsset;
  readonly economicBalance: B20UIAmount;
  readonly multiplier: B20Multiplier;
  readonly rawBalance: B20RawAmount;
  readonly tokenDecimals: number;
}

export type BaseAssetBalanceRead = BaseB20BalanceRead | BaseErc20BalanceRead;

export interface BasePortfolioBalanceRead {
  readonly account: EvmAddress;
  readonly blockNumber: bigint;
  readonly blockTimestamp: bigint;
  readonly positions: readonly BaseAssetBalanceRead[];
}

export class BasePortfolioBalanceReaderError extends Error {
  readonly code = "INVALID_ACCOUNT_ADDRESS";
}

export class BaseMainnetPortfolioBalanceReader {
  readonly #b20Adapter: BaseMainnetB20Adapter;
  readonly #client: BasePublicClient;

  constructor(client: BasePublicClient = basePublicClient) {
    this.#client = client;
    this.#b20Adapter = new BaseMainnetB20Adapter(client);
  }

  async #readErc20(
    asset: Erc20VectorAsset,
    account: EvmAddress,
    blockNumber: bigint,
  ): Promise<BaseErc20BalanceRead> {
    const rawBalance = await this.#client.readContract({
      abi: ERC20_BALANCE_ABI,
      address: getAddress(asset.tokenAddress),
      args: [account],
      blockNumber,
      functionName: "balanceOf",
    });

    return Object.freeze({ asset, rawBalance, tokenDecimals: asset.decimals });
  }

  async read(account: EvmAddress): Promise<BasePortfolioBalanceRead> {
    let validAccount: EvmAddress;

    try {
      validAccount = getAddress(account);
    } catch {
      throw new BasePortfolioBalanceReaderError(`Invalid account address: ${account}`);
    }

    const block = await this.#client.getBlock({ blockTag: "latest" });
    const enabledAssets = BASE_MAINNET_ASSET_REGISTRY.list().filter((asset) => asset.enabled);
    const b20Assets = enabledAssets.filter((asset) => asset.assetStandard === "B20");
    const erc20Assets = enabledAssets.filter((asset) => asset.assetStandard === "ERC20");
    const [b20Reads, erc20Reads] = await Promise.all([
      this.#b20Adapter.readBalances(b20Assets, validAccount, block.number),
      Promise.all(erc20Assets.map((asset) => this.#readErc20(asset, validAccount, block.number))),
    ]);
    const positionsByAddress = new Map<string, BaseAssetBalanceRead>([
      ...b20Reads.map(
        (read) =>
          [
            read.asset.tokenAddress.toLowerCase(),
            Object.freeze({ ...read, tokenDecimals: read.asset.decimals }),
          ] as const,
      ),
      ...erc20Reads.map((read) => [read.asset.tokenAddress.toLowerCase(), read] as const),
    ]);
    const positions = enabledAssets.map((asset) =>
      positionsByAddress.get(asset.tokenAddress.toLowerCase())!,
    );

    return Object.freeze({
      account: validAccount,
      blockNumber: block.number,
      blockTimestamp: block.timestamp,
      positions: Object.freeze(positions),
    });
  }
}

export function createBaseMainnetPortfolioBalanceReader(
  client: BasePublicClient = basePublicClient,
): BaseMainnetPortfolioBalanceReader {
  return new BaseMainnetPortfolioBalanceReader(client);
}

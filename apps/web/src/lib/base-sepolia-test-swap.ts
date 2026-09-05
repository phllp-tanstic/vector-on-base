import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";

import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_NETWORK, asEvmAddress } from "./authorization.ts";

export const BASE_SEPOLIA_TEST_FIXTURES = Object.freeze({
  executor: "0x6F638384B3d750F902CE74Fd98a8536C3D8b8EdE" as const,
  mockUsdc: "0x7d8D51976eB74A7949116732521e48B08d0c92Fd" as const,
  mockB20LikeToken: "0x1e3AEfb7A9220a50ff2655f6d912cEa70993B3a9" as const,
  router: "0x6Bb43afccc1fd9d8864Db2604A9b27117716EcAB" as const,
});

export const BASE_SEPOLIA_PUBLIC_RPC_URL = "https://sepolia.base.org";
export const TEST_SWAP_SELL_AMOUNT = 1_000_000n;
export const TEST_SWAP_MIN_BUY_AMOUNT = 100_000_000n;
export const TEST_SWAP_DEADLINE_SECONDS = 5n * 60n;

export const ERC20_TEST_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const BASE_SEPOLIA_TEST_ROUTER_ABI = [
  {
    inputs: [
      { name: "payer", type: "address" },
      { name: "outputRecipient", type: "address" },
      { name: "sellAmount", type: "uint256" },
    ],
    name: "executeSwap",
    outputs: [{ name: "buyAmount", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const BASE_SEPOLIA_TEST_EXECUTOR_ABI = [
  {
    inputs: [
      {
        components: [
          { name: "owner", type: "address" },
          { name: "sellToken", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "sellAmount", type: "uint256" },
          { name: "minBuyAmount", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "executionTarget", type: "address" },
          { name: "allowanceTarget", type: "address" },
          { name: "callValue", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "executionData", type: "bytes" },
        ],
        name: "intent",
        type: "tuple",
      },
    ],
    name: "execute",
    outputs: [
      { name: "executionId", type: "bytes32" },
      { name: "actualSellAmount", type: "uint256" },
      { name: "actualBuyAmount", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
] as const;

export interface BaseSepoliaTestSwapIntent {
  readonly owner: `0x${string}`;
  readonly sellToken: `0x${string}`;
  readonly buyToken: `0x${string}`;
  readonly sellAmount: bigint;
  readonly minBuyAmount: bigint;
  readonly recipient: `0x${string}`;
  readonly executionTarget: `0x${string}`;
  readonly allowanceTarget: `0x${string}`;
  readonly callValue: 0n;
  readonly deadline: bigint;
  readonly nonce: bigint;
  readonly executionData: Hex;
}

export interface BaseSepoliaTestSwapPlan {
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly network: typeof BASE_SEPOLIA_NETWORK;
  readonly preparedAt: bigint;
  readonly intent: BaseSepoliaTestSwapIntent;
  readonly calls: readonly [
    { readonly to: `0x${string}`; readonly value: 0n; readonly data: Hex },
    { readonly to: `0x${string}`; readonly value: 0n; readonly data: Hex },
  ];
}

function randomUint128(): bigint {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const nonce = bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  return nonce === 0n ? 1n : nonce;
}

export interface PrepareBaseSepoliaTestSwapOptions {
  readonly explicitUserAction: boolean;
  readonly smartAccountAddress: `0x${string}`;
  readonly chainId: number;
  readonly nowSeconds?: bigint;
  readonly createNonce?: () => bigint;
}

export function prepareBaseSepoliaTestSwap(
  options: PrepareBaseSepoliaTestSwapOptions,
): BaseSepoliaTestSwapPlan | null {
  if (!options.explicitUserAction) return null;
  if (options.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Test swap fixtures are restricted to Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}).`,
    );
  }

  const preparedAt = options.nowSeconds ?? BigInt(Math.floor(Date.now() / 1_000));
  const nonce = (options.createNonce ?? randomUint128)();
  if (nonce < 0n || nonce >= 1n << 256n) throw new Error("Test swap nonce must be uint256.");
  const deadline = preparedAt + TEST_SWAP_DEADLINE_SECONDS;
  const owner = options.smartAccountAddress;
  const executionData = encodeFunctionData({
    abi: BASE_SEPOLIA_TEST_ROUTER_ABI,
    functionName: "executeSwap",
    args: [
      BASE_SEPOLIA_TEST_FIXTURES.executor,
      BASE_SEPOLIA_TEST_FIXTURES.executor,
      TEST_SWAP_SELL_AMOUNT,
    ],
  });
  const intent = Object.freeze({
    owner,
    sellToken: BASE_SEPOLIA_TEST_FIXTURES.mockUsdc,
    buyToken: BASE_SEPOLIA_TEST_FIXTURES.mockB20LikeToken,
    sellAmount: TEST_SWAP_SELL_AMOUNT,
    minBuyAmount: TEST_SWAP_MIN_BUY_AMOUNT,
    recipient: owner,
    executionTarget: BASE_SEPOLIA_TEST_FIXTURES.router,
    allowanceTarget: BASE_SEPOLIA_TEST_FIXTURES.router,
    callValue: 0n,
    deadline,
    nonce,
    executionData,
  }) satisfies BaseSepoliaTestSwapIntent;

  const calls = [
    Object.freeze({
      to: BASE_SEPOLIA_TEST_FIXTURES.mockUsdc,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_TEST_ABI,
        functionName: "approve",
        args: [BASE_SEPOLIA_TEST_FIXTURES.executor, TEST_SWAP_SELL_AMOUNT],
      }),
    }),
    Object.freeze({
      to: BASE_SEPOLIA_TEST_FIXTURES.executor,
      value: 0n,
      data: encodeFunctionData({
        abi: BASE_SEPOLIA_TEST_EXECUTOR_ABI,
        functionName: "execute",
        args: [intent],
      }),
    }),
  ] as const;

  return Object.freeze({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    network: BASE_SEPOLIA_NETWORK,
    preparedAt,
    intent,
    calls: Object.freeze(calls),
  });
}

export function buildBaseSepoliaTestSwapRequest(
  explicitUserAction: boolean,
  smartAccount: Readonly<{ address: string }>,
  plan: BaseSepoliaTestSwapPlan,
) {
  if (!explicitUserAction) return null;
  const smartAccountAddress = asEvmAddress(smartAccount.address);
  if (!smartAccountAddress) throw new Error("Coinbase returned an invalid Smart Account address.");
  if (plan.chainId !== BASE_SEPOLIA_CHAIN_ID || plan.network !== BASE_SEPOLIA_NETWORK) {
    throw new Error("Test swap request must use Base Sepolia.");
  }
  if (plan.intent.owner.toLowerCase() !== smartAccountAddress.toLowerCase()) {
    throw new Error("Prepared test swap owner no longer matches the Smart Account.");
  }
  return {
    evmSmartAccount: smartAccountAddress,
    network: BASE_SEPOLIA_NETWORK,
    calls: [...plan.calls],
  };
}

export function canSubmitBaseSepoliaTestSwap(
  smartAccountAddress: `0x${string}` | undefined,
  isPending: boolean,
  plan: BaseSepoliaTestSwapPlan | undefined,
  nowSeconds: bigint,
  sellTokenBalance: bigint | undefined,
): boolean {
  return Boolean(
    smartAccountAddress &&
    !isPending &&
    plan &&
    plan.intent.owner.toLowerCase() === smartAccountAddress.toLowerCase() &&
    plan.intent.deadline > nowSeconds &&
    sellTokenBalance !== undefined &&
    sellTokenBalance >= plan.intent.sellAmount,
  );
}

export function decodeTestSwapCalls(plan: BaseSepoliaTestSwapPlan) {
  return {
    approval: decodeFunctionData({ abi: ERC20_TEST_ABI, data: plan.calls[0].data }),
    execution: decodeFunctionData({
      abi: BASE_SEPOLIA_TEST_EXECUTOR_ABI,
      data: plan.calls[1].data,
    }),
    router: decodeFunctionData({
      abi: BASE_SEPOLIA_TEST_ROUTER_ABI,
      data: plan.intent.executionData,
    }),
  };
}

export function testSwapErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|denied|4001|ACTION_REJECTED/i.test(message)) {
    return "Authorization was rejected in the wallet. Nothing was submitted.";
  }
  return `Test swap simulation or submission failed: ${message}`;
}

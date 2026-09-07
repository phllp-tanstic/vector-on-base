import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Hex } from "viem";

import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_NETWORK, asEvmAddress } from "./authorization.ts";

export const DEMO_FAUCET_ADDRESS_ENV_VAR = "NEXT_PUBLIC_VECTOR_TEST_DEMO_FAUCET_ADDRESS" as const;
export const DEMO_FAUCET_CLAIM_AMOUNT = 10_000_000n;
export const DEMO_FAUCET_MINIMUM_EXECUTION_BALANCE = 1_000_000n;
export const DEMO_FAUCET_COOLDOWN_SECONDS = 24n * 60n * 60n;

export const BASE_SEPOLIA_DEMO_FAUCET_ABI = [
  {
    inputs: [],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "recipient", type: "address" }],
    name: "lastClaimAt",
    outputs: [{ name: "timestamp", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "mockUSDC",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "CLAIM_AMOUNT",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type DemoFaucetState =
  | "IDLE"
  | "CHECKING"
  | "ELIGIBLE"
  | "COOLDOWN"
  | "CLAIMING"
  | "CONFIRMING"
  | "CLAIMED"
  | "FAILED"
  | "EMPTY";

export interface DemoFaucetConfig {
  readonly faucetAddress: `0x${string}` | undefined;
}

export class DemoFaucetConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR" as const;
}

export function loadDemoFaucetConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DemoFaucetConfig {
  const configured = environment[DEMO_FAUCET_ADDRESS_ENV_VAR]?.trim();
  if (!configured) return Object.freeze({ faucetAddress: undefined });
  if (!isAddress(configured, { strict: false }) || configured.toLowerCase() === zeroAddress) {
    throw new DemoFaucetConfigurationError(
      `${DEMO_FAUCET_ADDRESS_ENV_VAR} must be a valid non-zero Base Sepolia contract address.`,
    );
  }
  return Object.freeze({ faucetAddress: getAddress(configured) });
}

export interface DemoFaucetEligibilityInput {
  readonly authenticated: boolean;
  readonly smartAccountAddress: `0x${string}` | undefined;
  readonly chainId: number;
  readonly faucetAddress: `0x${string}` | undefined;
  readonly bytecodeValid: boolean | undefined;
  readonly inventory: bigint | undefined;
  readonly lastClaimAt: bigint | undefined;
  readonly nowSeconds: bigint;
  readonly checking?: boolean;
}

export interface DemoFaucetEligibility {
  readonly state: DemoFaucetState;
  readonly canClaim: boolean;
  readonly availableAt?: bigint;
}

export function deriveDemoFaucetEligibility(
  input: Readonly<DemoFaucetEligibilityInput>,
): DemoFaucetEligibility {
  if (!input.authenticated || !input.smartAccountAddress) {
    return Object.freeze({ state: "IDLE", canClaim: false });
  }
  if (input.chainId !== BASE_SEPOLIA_CHAIN_ID || !input.faucetAddress) {
    return Object.freeze({ state: "FAILED", canClaim: false });
  }
  if (
    input.checking ||
    input.bytecodeValid === undefined ||
    input.inventory === undefined ||
    input.lastClaimAt === undefined
  ) {
    return Object.freeze({ state: "CHECKING", canClaim: false });
  }
  if (!input.bytecodeValid) return Object.freeze({ state: "FAILED", canClaim: false });
  if (input.inventory < DEMO_FAUCET_CLAIM_AMOUNT) {
    return Object.freeze({ state: "EMPTY", canClaim: false });
  }
  const availableAt = input.lastClaimAt + DEMO_FAUCET_COOLDOWN_SECONDS;
  if (input.lastClaimAt !== 0n && input.nowSeconds < availableAt) {
    return Object.freeze({ state: "COOLDOWN", canClaim: false, availableAt });
  }
  return Object.freeze({ state: "ELIGIBLE", canClaim: true });
}

export function formatDemoFaucetCooldown(availableAt: bigint, nowSeconds: bigint): string {
  const remaining = availableAt > nowSeconds ? availableAt - nowSeconds : 0n;
  const totalMinutes = (remaining + 59n) / 60n;
  const hours = totalMinutes / 60n;
  const minutes = totalMinutes % 60n;
  return `${hours.toString()}h ${minutes.toString()}m`;
}

export function shouldPromoteDemoFaucet(musdcBalance: bigint | undefined): boolean {
  return musdcBalance !== undefined && musdcBalance < DEMO_FAUCET_MINIMUM_EXECUTION_BALANCE;
}

export interface DemoFaucetClaimPlan {
  readonly chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  readonly network: typeof BASE_SEPOLIA_NETWORK;
  readonly caller: `0x${string}`;
  readonly calls: readonly [{ readonly to: `0x${string}`; readonly value: 0n; readonly data: Hex }];
}

export function prepareDemoFaucetClaim(input: {
  readonly explicitUserAction: boolean;
  readonly authenticated: boolean;
  readonly smartAccountAddress: string | undefined;
  readonly chainId: number;
  readonly faucetAddress: `0x${string}` | undefined;
  readonly eligible: boolean;
}): DemoFaucetClaimPlan | null {
  if (!input.explicitUserAction) return null;
  if (!input.authenticated || !input.smartAccountAddress) {
    throw new Error("A signed-in Coinbase Smart Account is required.");
  }
  if (input.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Demo claims are restricted to Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}).`);
  }
  if (!input.faucetAddress) throw new Error("The Base Sepolia demo faucet is not configured.");
  if (!input.eligible) throw new Error("This Smart Account is not currently eligible to claim.");
  const caller = asEvmAddress(input.smartAccountAddress);
  if (!caller) throw new Error("Coinbase returned an invalid Smart Account address.");

  return Object.freeze({
    chainId: BASE_SEPOLIA_CHAIN_ID,
    network: BASE_SEPOLIA_NETWORK,
    caller,
    calls: Object.freeze([
      Object.freeze({
        to: input.faucetAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: BASE_SEPOLIA_DEMO_FAUCET_ABI,
          functionName: "claim",
        }),
      }),
    ]) as DemoFaucetClaimPlan["calls"],
  });
}

export function buildDemoFaucetClaimRequest(
  explicitUserAction: boolean,
  smartAccount: Readonly<{ address: string }>,
  plan: DemoFaucetClaimPlan,
) {
  if (!explicitUserAction) return null;
  const smartAccountAddress = asEvmAddress(smartAccount.address);
  if (!smartAccountAddress || smartAccountAddress.toLowerCase() !== plan.caller.toLowerCase()) {
    throw new Error("Demo claim caller no longer matches the Coinbase Smart Account.");
  }
  if (plan.chainId !== BASE_SEPOLIA_CHAIN_ID || plan.network !== BASE_SEPOLIA_NETWORK) {
    throw new Error("Demo claim request must use Base Sepolia.");
  }
  return {
    evmSmartAccount: smartAccountAddress,
    network: BASE_SEPOLIA_NETWORK,
    calls: [...plan.calls],
  };
}

export const CONFIRMED_DEMO_CLAIM_EFFECTS = Object.freeze({
  refreshMusdcBalance: true,
  prepareExecution: false,
});

export function demoFaucetErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|denied|4001|ACTION_REJECTED/i.test(message)) {
    return "Demo token authorization was rejected. Nothing was submitted.";
  }
  if (/cooldown|ClaimCooldownActive/i.test(message)) {
    return "This Smart Account is still within the 24-hour demo claim cooldown.";
  }
  if (/inventory|exhaust|FaucetInventoryExhausted/i.test(message)) {
    return "The demo faucet is temporarily empty.";
  }
  if (/network|fetch|timeout|rpc|503|429/i.test(message)) {
    return "Base Sepolia is temporarily unreachable. Wait a moment and check again.";
  }
  return "The demo token claim could not be completed. Check eligibility and try again explicitly.";
}

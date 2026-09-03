import type { EvmAddress } from "@vector/shared";

export const B20_ADDRESS_PREFIX = "0xb2000000000000000000" as const;
export const B20_ASSET_VARIANT = 0 as const;
export const B20_STABLECOIN_VARIANT = 1 as const;

export type B20Variant = typeof B20_ASSET_VARIANT | typeof B20_STABLECOIN_VARIANT;

export class InvalidB20AddressError extends Error {
  readonly code = "INVALID_B20_ASSET_ADDRESS";
}

export function getB20Variant(address: string): B20Variant | undefined {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return undefined;
  }

  const normalizedAddress = address.toLowerCase();

  if (!normalizedAddress.startsWith(B20_ADDRESS_PREFIX)) {
    return undefined;
  }

  const variant = Number.parseInt(normalizedAddress.slice(22, 24), 16);

  if (variant === B20_ASSET_VARIANT || variant === B20_STABLECOIN_VARIANT) {
    return variant;
  }

  return undefined;
}

export function isB20AssetAddress(address: string): address is EvmAddress {
  return getB20Variant(address) === B20_ASSET_VARIANT;
}

export function assertB20AssetAddress(address: string): asserts address is EvmAddress {
  if (!isB20AssetAddress(address)) {
    throw new InvalidB20AddressError(
      `Address does not match the B20 Asset address structure: ${address}`,
    );
  }
}

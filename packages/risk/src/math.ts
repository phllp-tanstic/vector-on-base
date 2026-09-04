export const BASIS_POINTS_SCALE = 10_000n;

export function maximumSpendAfterReserve(balance: bigint, reserve: bigint): bigint {
  if (balance < 0n || reserve < 0n) {
    throw new RangeError("Balance and reserve must be non-negative.");
  }

  return balance > reserve ? balance - reserve : 0n;
}

export function maximumExposureValue(postTradeTotal: bigint, exposureBps: number): bigint {
  if (
    postTradeTotal < 0n ||
    !Number.isInteger(exposureBps) ||
    exposureBps < 0 ||
    exposureBps > Number(BASIS_POINTS_SCALE)
  ) {
    throw new RangeError("Exposure inputs are outside their valid ranges.");
  }

  return (postTradeTotal * BigInt(exposureBps)) / BASIS_POINTS_SCALE;
}

export function deviationBps(actual: bigint, reference: bigint): bigint {
  if (actual < 0n || reference <= 0n) {
    throw new RangeError("Deviation inputs require non-negative actual and positive reference.");
  }

  const difference = actual >= reference ? actual - reference : reference - actual;
  return (difference * BASIS_POINTS_SCALE) / reference;
}

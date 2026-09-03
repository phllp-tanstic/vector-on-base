import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BasePublicClient } from "./client.ts";
import {
  BaseMainnetPortfolioBalanceReader,
  BasePortfolioBalanceReaderError,
} from "./portfolio-balances.ts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const WAD = 1_000_000_000_000_000_000n;

describe("Base Mainnet portfolio balance reader", () => {
  it("keeps ERC-20 and B20 balance semantics distinct at one block", async () => {
    const b20Values = [
      [100_000_000n, WAD],
      [100_000_000n, 2n * WAD],
      [100_000_000n, WAD / 2n],
      [0n, WAD],
    ] as const;
    const client = {
      getBlock: async () => ({ number: 123n, timestamp: 456n }),
      multicall: async () =>
        b20Values.flatMap(([rawBalance, multiplier]) => [
          { result: rawBalance, status: "success" as const },
          { result: multiplier, status: "success" as const },
        ]),
      readContract: async () => 25_000_000n,
    } as unknown as BasePublicClient;
    const result = await new BaseMainnetPortfolioBalanceReader(client).read(ZERO_ADDRESS);

    assert.equal(result.blockNumber, 123n);
    assert.equal(result.blockTimestamp, 456n);
    assert.deepEqual(
      result.positions.map((position) => position.asset.symbol),
      ["USDC", "NVDAc", "AAPLc", "GOOGLc", "METAc"],
    );

    const [usdc, nvdac, aaplc, googlc] = result.positions;
    assert.equal(usdc?.rawBalance, 25_000_000n);
    assert.equal(usdc !== undefined && "economicBalance" in usdc, false);
    assert.equal(
      nvdac !== undefined && "economicBalance" in nvdac && nvdac.economicBalance,
      100_000_000n,
    );
    assert.equal(
      aaplc !== undefined && "economicBalance" in aaplc && aaplc.economicBalance,
      200_000_000n,
    );
    assert.equal(
      googlc !== undefined && "economicBalance" in googlc && googlc.economicBalance,
      50_000_000n,
    );
  });

  it("rejects an invalid account before an RPC read", async () => {
    const client = {} as BasePublicClient;
    const reader = new BaseMainnetPortfolioBalanceReader(client);

    await assert.rejects(
      reader.read("0xinvalid"),
      (error: unknown) => error instanceof BasePortfolioBalanceReaderError,
    );
  });
});

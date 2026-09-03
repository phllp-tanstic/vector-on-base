import {
  createB20PortfolioPosition,
  createErc20PortfolioPosition,
  createPortfolioSnapshot,
} from "@vector/portfolio";
import { createBaseMainnetPortfolioBalanceReader } from "@vector/integrations";
import { getAddress, zeroAddress } from "viem";

async function main(): Promise<void> {
  const configuredAccount = process.env.VECTOR_VERIFY_ACCOUNT?.trim();
  const usesZeroAddress = configuredAccount === undefined || configuredAccount.length === 0;
  const account = getAddress(usesZeroAddress ? zeroAddress : configuredAccount);
  const balanceRead = await createBaseMainnetPortfolioBalanceReader().read(account);
  const positions = balanceRead.positions.map((position) =>
    "economicBalance" in position
      ? createB20PortfolioPosition(
          position.asset,
          position.rawBalance,
          position.economicBalance,
          position.multiplier,
          position.tokenDecimals,
        )
      : createErc20PortfolioPosition(position.asset, position.rawBalance, position.tokenDecimals),
  );
  const snapshot = createPortfolioSnapshot({
    account: balanceRead.account,
    blockNumber: balanceRead.blockNumber,
    blockTimestamp: balanceRead.blockTimestamp,
    positions,
  });

  console.log("Base Mainnet portfolio balance verification passed");
  console.log(`account=${snapshot.account}`);
  console.log(
    `accountPurpose=${usesZeroAddress ? "ABI/read-verification-only (zero address)" : "VECTOR_VERIFY_ACCOUNT"}`,
  );
  console.log(`blockNumber=${snapshot.blockNumber}`);
  console.log(`blockTimestamp=${snapshot.blockTimestamp}`);

  for (const position of snapshot.positions) {
    if (position.asset.assetStandard === "B20" && "economicBalance" in position) {
      console.log(
        `${position.asset.symbol}.rawBalance=${position.rawBalance} decimals=${position.tokenDecimals} ` +
          `multiplier=${position.multiplier} economicBalance=${position.economicBalance}`,
      );
    } else {
      console.log(
        `${position.asset.symbol}.rawBalance=${position.rawBalance} decimals=${position.tokenDecimals}`,
      );
    }
  }

  console.log("referenceValuation=not-computed reason=no-live-reference-price-provider");
}

void main();

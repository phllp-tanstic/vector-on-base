# Base Sepolia authorization and execution fixtures

This document covers the existing Base Sepolia `VectorExecutor`, isolated testnet-only execution
fixtures, and the browser's confirmed two-call authorization and settlement proof. The fixture
contracts are not real USDC, B20 assets, or a production router. They must never be added to
`BASE_MAINNET_ASSET_REGISTRY` or used by Base Mainnet configuration.

## Browser setup

The web workspace pins `@coinbase/cdp-hooks` and its required peer `@coinbase/cdp-core` at
`0.0.123`. The provider uses `ethereum.createOnLogin: "smart"`: CDP creates an EOA owner and Smart
Account for a new authenticated user. An existing authenticated user without a Smart Account can
explicitly create one; `enableSpendPermissions` is always false.

1. Create/select a CDP project and enable email authentication.
2. Add `http://localhost:3000` to its allowed origins.
3. Create `apps/web/.env.local` containing only browser-safe public configuration:

   ```sh
   NEXT_PUBLIC_CDP_PROJECT_ID=your-public-project-id
   NEXT_PUBLIC_VECTOR_TEST_DEMO_FAUCET_ADDRESS=0xDeployedBaseSepoliaFaucet
   ```

4. Run `npm run dev --workspace apps/web` and open `http://localhost:3000`.
5. Enter your email, then the six-digit OTP sent by CDP.
6. Confirm the page shows the user-controlled Smart Account and `Base Sepolia (84532)`.
7. If the account has less than 1 mUSDC, click **Get 10 demo mUSDC** and explicitly authorize the
   separate one-call faucet UserOperation. Wait for confirmation and the automatic balance refresh.
8. Complete the deterministic thesis and risk flow, then click **Prepare execution**. Nothing is
   submitted on page load or preparation, and a successful faucet claim never prepares execution.
9. Review the exact fixture amounts, contracts, nonce, deadline, and two calls.
10. Click **Authorize 2 calls**, approve the Coinbase Smart Account request, and wait for the
    UserOperation receipt, transaction hash, balance refresh, and BaseScan link.

The live proof is the ordered two-call fixture settlement described below. Custom sponsorship
remains unconfigured; authorization and any applicable Sepolia gas sponsorship are distinct
concerns.

`NEXT_PUBLIC_CDP_PROJECT_ID` and onchain addresses are public configuration. CDP API secrets, Wallet
Secrets, developer wallet credentials, deployer private keys, and any backend signing credentials
must never enter `apps/web`, `.env.local`, or another `NEXT_PUBLIC_*` value.

## Public demo faucet

`BaseSepoliaMockUSDCFaucet` is a Base Sepolia fixture with no production role. It holds a finite
reserve of mock mUSDC and transfers exactly `10_000_000` raw units (10 mUSDC) to `msg.sender` when
that Smart Account calls `claim()`. Claims have no recipient, token, or amount parameter, require no
token approval, and mint nothing. Each recipient can claim once per 24 hours; the contract enforces
the cooldown onchain. The faucet fails cleanly when less than 10 mUSDC remains.

The browser reads faucet bytecode, inventory, the current Smart Account's last claim timestamp, and
mUSDC balance over the existing public Base Sepolia read path. Missing or invalid config, wrong
chain, no authenticated Smart Account, insufficient inventory, or an active cooldown disables the
claim. The button creates exactly one zero-value `claim()` call and sends it only after the user's
explicit Coinbase Smart Account authorization. These are Base Sepolia test assets with no monetary
value; the faucet is absent from all Base Mainnet registries and readiness, 0x, and Chainlink paths.

## Browser test-swap workflow

After thesis risk acceptance, the browser exposes an **Execution preview** for the explicit test
settlement. This workflow moves fixture tokens. It never constructs a plan on page load and never
submits merely because a plan exists.

The card reads the authenticated Smart Account's mUSDC and NOTB20 balances from the public
`https://sepolia.base.org` endpoint. This URL has no credentials and no RPC secret is exposed in a
`NEXT_PUBLIC_*` variable. After signing in:

1. Confirm that the displayed Smart Account is the intended fixture-funded account and that its
   mUSDC balance is at least `1`.
2. Click **Prepare execution**. This user action creates a cryptographically random nonce and a
   visible deadline five minutes in the future. It does not contact the wallet or submit anything.
3. Review the exact amounts, owner/recipient, four contracts, zero native value, nonce, deadline,
   and ordered two-call sequence shown on screen.
4. Click the separate **Authorize 2 calls** button and approve the CDP Smart Account request.
5. Wait while duplicate submission is disabled. A wallet rejection or simulation/submission error
   is shown as a failure and never as success.
6. Success appears only after the UserOperation receipt succeeds. The card then shows the userOp
   hash, transaction hash, BaseScan link, and refreshed token balances.

The one atomic `base-sepolia` UserOperation contains, in order:

1. mUSDC `approve(VectorExecutor, 1_000_000)`.
2. `VectorExecutor.execute(ExecutionIntent)` with a sell amount of `1_000_000`, minimum buy amount
   of `100_000_000`, the Smart Account as both owner and final recipient, the mock router as both
   execution and allowance target, and `callValue = 0`.

The nested router calldata is exactly
`executeSwap(VectorExecutor, VectorExecutor, 1_000_000)`. The router therefore returns NOTB20 to
the executor first. `VectorExecutor` verifies its NOTB20 balance delta before transferring the
received amount to the Smart Account. With the fixture's 100:1 base-unit rate, the expected first
execution changes the funded account from `10 mUSDC` to `9 mUSDC` and from `0 NOTB20` to
`1 NOTB20` (assuming those are its balances immediately before execution).

These addresses are compiled into the Base Sepolia-only browser fixture module:

- VectorExecutor: `0x6F638384B3d750F902CE74Fd98a8536C3D8b8EdE`
- mUSDC: `0x1e3AEfb7A9220a50ff2655f6d912cEa70993B3a9`
- NOTB20: `0x7d8D51976eB74A7949116732521e48B08d0c92Fd`
- MockExecutionRouter: `0x6Bb43afccc1fd9d8864Db2604A9b27117716EcAB`

They are testnet fixtures, not production assets. They are deliberately absent from
`BASE_MAINNET_ASSET_REGISTRY`, and the production execution builder remains restricted to Base
Mainnet (`8453`).

## Confirmed execution evidence

The following successful Base Sepolia receipt was read back from the public RPC and records the
Coinbase Smart Account's exact approval and execution batch:

- VectorExecutor:
  [`0x6F638384B3d750F902CE74Fd98a8536C3D8b8EdE`](https://sepolia.basescan.org/address/0x6F638384B3d750F902CE74Fd98a8536C3D8b8EdE)
- UserOperation:
  `0x586d7c51d1768c18b4fe742d91a38eede645ed388bb43645c54d3a67a1eaa1cb`
- Transaction:
  [`0xb68a0b23e4582471ce9a7a862a3e2db9aa41d0b7953d18ceb48427e0b717607d`](https://sepolia.basescan.org/tx/0xb68a0b23e4582471ce9a7a862a3e2db9aa41d0b7953d18ceb48427e0b717607d)
- Receipt: success at block `46,409,263`

The logs show `1,000,000` raw mUSDC approved to and pulled by `VectorExecutor`, a temporary exact
router allowance that returns to zero, `100,000,000` raw NOTB20 delivered through the executor to
the Smart Account recipient, and the matching `IntentExecuted` and UserOperation events.

**BASE SEPOLIA LIVE DEMO · TEST ASSETS · NO REAL STOCKS.** Fixed 1 mUSDC test settlement. This proves
Smart Account authorization and `VectorExecutor` settlement invariants; it does not execute the
displayed $320/$180 adapted dollar position.

## Existing VectorExecutor

The fixture workflow uses the already-deployed executor at
`0x6F638384B3d750F902CE74Fd98a8536C3D8b8EdE`. Do not run
`DeployVectorExecutor.s.sol` as part of this workflow. Fixture deployment and executor
configuration are deliberately separate so deploying mocks cannot silently change executor
permissions.

All scripts reject chains other than Base Sepolia (`84532`). None reads a private key or broadcasts
without an explicit CLI `--broadcast` flag. The signer always comes from a Foundry encrypted
keystore account selected with `--account`.

## One-time Foundry account setup

Acquire Base Sepolia ETH for the transaction-sending accounts from an official Base-compatible
faucet. Set the RPC URL in the current shell; RPC URLs can contain credentials and must remain
server-side:

```sh
export BASE_SEPOLIA_RPC_URL="https://your-base-sepolia-rpc"
```

Import the fixture deployer and the current executor owner/admin into Foundry's encrypted keystore.
If one address fills both roles, one account alias is enough. Enter keys only in Foundry's
interactive prompt:

```sh
cast wallet import vector-sepolia-deployer --interactive
cast wallet import vector-sepolia-owner --interactive
```

Never put a private key in `.env`, `.env.local`, a command-line flag, or a `PRIVATE_KEY` variable.

## Deploy the Base Sepolia fixtures

The fixture deployment creates only `MockUSDC`, `MockB20LikeToken`, and
`MockExecutionRouter`. It seeds the router with 1,000,000 NOTB20 tokens and prints all three
addresses. The router deterministically exchanges one whole mUSDC for one whole NOTB20 token.

From the repository root, first simulate without broadcasting:

```sh
cd contracts
forge script script/DeployBaseSepoliaFixtures.s.sol:DeployBaseSepoliaFixtures \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account vector-sepolia-deployer \
  -vvvv
```

Review the simulation. Only then manually add `--broadcast`:

```sh
forge script script/DeployBaseSepoliaFixtures.s.sol:DeployBaseSepoliaFixtures \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account vector-sepolia-deployer \
  --broadcast \
  -vvvv
```

Copy the printed public addresses into the current shell:

```sh
export VECTOR_TEST_MOCK_USDC_ADDRESS="0xDeployedMockUSDC"
export VECTOR_TEST_MOCK_B20_LIKE_TOKEN_ADDRESS="0xDeployedMockB20LikeToken"
export VECTOR_TEST_MOCK_EXECUTION_ROUTER_ADDRESS="0xDeployedMockExecutionRouter"
```

## Deploy and fund the demo faucet

The dedicated faucet script reads the existing `VECTOR_TEST_MOCK_USDC_ADDRESS`, verifies that token
bytecode exists, deploys only the faucet, and mints a finite 1,000 mUSDC reserve to it. This is about
100 default claims. It rejects every chain except Base Sepolia and does not deploy or reconfigure
`VectorExecutor`.

Simulate first with the existing encrypted Foundry keystore account:

```sh
forge script script/DeployBaseSepoliaDemoFaucet.s.sol:DeployBaseSepoliaDemoFaucet \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account vector-sepolia-deployer \
  -vvvv
```

After reviewing the mock token, new faucet, and `1_000_000_000`-unit inventory, broadcast manually:

```sh
forge script script/DeployBaseSepoliaDemoFaucet.s.sol:DeployBaseSepoliaDemoFaucet \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account vector-sepolia-deployer \
  --broadcast \
  -vvvv
```

Copy the printed faucet address to `apps/web/.env.local` as
`NEXT_PUBLIC_VECTOR_TEST_DEMO_FAUCET_ADDRESS`, rebuild/redeploy the web app, and verify its bytecode
and 1,000 mUSDC inventory before public use. Also keep it in the maintainer's current shell as
`VECTOR_TEST_DEMO_FAUCET_ADDRESS` for the manual refill command below. These values are addresses,
not secrets.

### Manual finite refill

If inventory drops below the desired reserve, the existing Base Sepolia mock's test-only mint entry
point permits replenishment. Use the same reviewed maintainer keystore workflow and an explicit
finite amount; never add a browser or backend signer:

```sh
cast send "$VECTOR_TEST_MOCK_USDC_ADDRESS" \
  "mint(address,uint256)" \
  "$VECTOR_TEST_DEMO_FAUCET_ADDRESS" \
  1000000000 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account vector-sepolia-deployer
```

Then read `balanceOf(faucet)` and record the refill transaction. The example adds another finite
1,000 mUSDC; choose and review a bounded amount appropriate to expected demo traffic. The faucet
itself exposes no refill, mint, arbitrary-token, or arbitrary-recipient method.

## Configure the existing executor

The selected `vector-sepolia-owner` account must be the current owner of
`0x6F638384B3d750F902CE74Fd98a8536C3D8b8EdE`. The script enables the two mock assets and approves
the mock router as both the execution target and allowance target. Those permissions are strictly
for this testnet fixture.

Simulate all four owner calls first:

```sh
forge script script/ConfigureBaseSepoliaFixtures.s.sol:ConfigureBaseSepoliaFixtures \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account vector-sepolia-owner \
  -vvvv
```

Review the executor address, signer, fixture bytecode, and simulated calls. Then broadcast manually:

```sh
forge script script/ConfigureBaseSepoliaFixtures.s.sol:ConfigureBaseSepoliaFixtures \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account vector-sepolia-owner \
  --broadcast \
  -vvvv
```

## Mint a small mUSDC test balance

Set the user-controlled Smart Account address. The amount is raw 6-decimal mUSDC units, defaults
to `10000000` (10 mUSDC), and is capped by the script at `100000000` (100 mUSDC):

```sh
export VECTOR_TEST_SMART_ACCOUNT="0xUserSmartAccount"
export VECTOR_TEST_MOCK_USDC_MINT_AMOUNT="10000000"
```

Simulate the mint first:

```sh
forge script script/MintBaseSepoliaMockUSDC.s.sol:MintBaseSepoliaMockUSDC \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account vector-sepolia-deployer \
  -vvvv
```

After reviewing the recipient and amount, broadcast manually:

```sh
forge script script/MintBaseSepoliaMockUSDC.s.sol:MintBaseSepoliaMockUSDC \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account vector-sepolia-deployer \
  --broadcast \
  -vvvv
```

Keep these identities separate: the authenticated user's Smart Account, the existing
`VectorExecutor`, its owner/admin, and the Foundry fixture deployer account. The mock token and
router addresses belong only in the `VECTOR_TEST_*` configuration above.

## Historical VectorExecutor deployment script

`DeployVectorExecutor.s.sol` remains available for explicit standalone deployments. It accepts
`VECTOR_OWNER_ADDRESS`, rejects non-Base-Sepolia chains, and uses a CLI keystore signer. It is not
part of the fixture workflow because the executor address above already exists. If a separate
deployment is intentionally needed, the dry-run shape is:

```sh
export VECTOR_OWNER_ADDRESS="0xYourDistinctOwnerOrMultisig"
forge script script/DeployVectorExecutor.s.sol:DeployVectorExecutor \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account vector-sepolia-deployer \
  -vvvv
```

## Official references

- [CDP frontend hooks overview](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-hooks/index)
- [CDP authentication implementation guide](https://docs.cdp.coinbase.com/wallets/authentication/implementation-guide)
- [CDP Smart Accounts](https://docs.cdp.coinbase.com/wallets/using-wallets/smart-accounts)
- [`useSendUserOperation`](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-hooks/Functions/useSendUserOperation)
- [`useWaitForUserOperation`](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-hooks/Functions/useWaitForUserOperation)
- [`useCreateEvmSmartAccount`](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-hooks/Functions/useCreateEvmSmartAccount)

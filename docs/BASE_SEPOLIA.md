# Base Sepolia authorization and execution fixtures

This document covers the existing Base Sepolia `VectorExecutor`, isolated testnet-only execution
fixtures, and the existing minimal browser authorization proof. The fixture contracts are not real
USDC, B20 assets, or a production router. They must never be added to
`BASE_MAINNET_ASSET_REGISTRY` or used by Base Mainnet configuration.

## Browser setup

The web workspace pins `@coinbase/cdp-hooks` and its required peer `@coinbase/cdp-core` at
`0.0.123`. The provider uses `ethereum.createOnLogin: "smart"`: CDP creates an EOA owner and Smart
Account for a new authenticated user. An existing authenticated user without a Smart Account can
explicitly create one; `enableSpendPermissions` is always false.

1. Create/select a CDP project and enable email authentication.
2. Add `http://localhost:3000` to its allowed origins.
3. Create `apps/web/.env.local` containing only:

   ```sh
   NEXT_PUBLIC_CDP_PROJECT_ID=your-public-project-id
   ```

4. Run `npm run dev --workspace apps/web` and open `http://localhost:3000`.
5. Enter your email, then the six-digit OTP sent by CDP.
6. Confirm the page shows the user-controlled Smart Account and `Base Sepolia (84532)`.
7. Click **Test Authorization** and approve the request. Nothing is submitted on page load.
8. Wait for the UserOperation status, userOp hash, transaction hash, and BaseScan link.

The test contains one documented harmless call to `0x0000000000000000000000000000000000000000`
with `value = 0` and empty calldata. It transfers no funds and never calls `VectorExecutor`. Base
Sepolia Smart Account UserOperations are currently subsidized by CDP, so no custom paymaster URL or
faucet funding is required for this proof. Custom sponsorship remains unconfigured. CDP Smart
Accounts continue to support ordered multi-call batching, although this safety proof sends one call.

`NEXT_PUBLIC_CDP_PROJECT_ID` and onchain addresses are public configuration. CDP API secrets, Wallet
Secrets, developer wallet credentials, deployer private keys, and any backend signing credentials
must never enter `apps/web`, `.env.local`, or another `NEXT_PUBLIC_*` value.

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

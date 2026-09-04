# Base Sepolia authorization proof

This slice prepares `VectorExecutor` for a manual Base Sepolia deployment and provides a minimal
browser shell for a user-controlled Coinbase Smart Account. It does not connect the browser to
Vector execution, 0x, USDC, B20 assets, or Spend Permissions.

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

## Manual VectorExecutor deployment

The script accepts `VECTOR_OWNER_ADDRESS` as the explicit initial administrator, rejects every
chain other than Base Sepolia (`84532`), and deploys only `VectorExecutor`. It does not configure
assets, 0x targets, B20 assets, or allowance targets. The deployer signer comes from Forge's CLI
keystore selection and is independent of the Vector owner and every user Smart Account.

1. Acquire Base Sepolia ETH for the deployer from an official Base-compatible faucet.
2. Set the RPC URL and explicit owner/admin address in the current shell:

   ```sh
   export BASE_SEPOLIA_RPC_URL="https://your-base-sepolia-rpc"
   export VECTOR_OWNER_ADDRESS="0xYourDistinctOwnerOrMultisig"
   ```

3. Import the deployer into Foundry's encrypted keystore. Enter the private key only into Foundry's
   interactive prompt, never into this repository:

   ```sh
   cast wallet import vector-sepolia-deployer --interactive
   ```

4. Dry-run against Base Sepolia without `--broadcast`:

   ```sh
   cd contracts
   forge script script/DeployVectorExecutor.s.sol:DeployVectorExecutor \
     --rpc-url "$BASE_SEPOLIA_RPC_URL" \
     --account vector-sepolia-deployer \
     -vvvv
   ```

5. Review the simulated chain ID, initial owner, deployed address, and transaction before manually
   broadcasting:

   ```sh
   forge script script/DeployVectorExecutor.s.sol:DeployVectorExecutor \
     --rpc-url "$BASE_SEPOLIA_RPC_URL" \
     --account vector-sepolia-deployer \
     --broadcast \
     -vvvv
   ```

   Forge prints the transaction hash and stores the receipt under `contracts/broadcast/`; the script
   prints the owner and deployed contract address.

6. Optionally verify using a supported BaseScan/Etherscan verifier after configuring its API key as
   a shell-only secret. Follow Foundry's current `forge verify-contract` documentation and use the
   exact compiler settings from `foundry.toml`.
7. Record the deployed address as `VECTOR_EXECUTOR_ADDRESS_SEPOLIA` in your local environment.
8. Add the same public address to future app configuration only when Vector execution is connected.
   This task deliberately does not wire it into the authorization page.

Keep these four identities separate: the authenticated user's Smart Account, the deployed
`VectorExecutor`, `VECTOR_OWNER_ADDRESS`, and the Foundry deployer account.

## Official references

- [CDP frontend hooks overview](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-hooks/index)
- [CDP authentication implementation guide](https://docs.cdp.coinbase.com/wallets/authentication/implementation-guide)
- [CDP Smart Accounts](https://docs.cdp.coinbase.com/wallets/using-wallets/smart-accounts)
- [`useSendUserOperation`](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-hooks/Functions/useSendUserOperation)
- [`useWaitForUserOperation`](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-hooks/Functions/useWaitForUserOperation)
- [`useCreateEvmSmartAccount`](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-hooks/Functions/useCreateEvmSmartAccount)

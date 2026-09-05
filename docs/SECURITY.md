# VectorExecutor V1 security model

`contracts/src/VectorExecutor.sol` is a small, non-upgradeable execution boundary. It does not
decide whether a trade is financially prudent. It executes only an instruction directly submitted
by its stated owner after offchain validation.

## Authorization and replay protection

V1 selects direct authorization: `ExecutionIntent.owner` must equal `msg.sender`. This works for an
EOA today and for later Coinbase Smart Account invocation without requiring a second signature.
There is no relayer, EIP-712 authorization, or Spend Permission in this slice.

For the Coinbase path, the Smart Account address is fixed as both the CDP
`evmSmartAccount` and `ExecutionIntent.owner`; neither the backend nor the submission adapter accepts
a replacement caller. The only authorized batch is an exact USDC approval to `VectorExecutor`
followed by `VectorExecutor.execute`. The approval is never `MaxUint256`, never names the 0x
allowance target as spender, and cannot be reordered or extended through the public builder.

Nonces are unordered and owner-scoped: `usedNonce[owner][nonce]`. Execution marks a nonce before
the first untrusted token or router interaction. EVM revert atomicity rolls that write back when any
later step fails. Owners may irreversibly cancel an unused nonce with `cancelNonce`.

## Token and router flow

1. The owner has approved the executor to pull the sell token.
2. The executor pulls exactly `sellAmount` and rejects transfer-tax or otherwise short funding.
3. It sets exactly `sellAmount` of temporary allowance on the intent's approved allowance target.
4. It sends opaque calldata and the exact declared `callValue` to the separately approved execution
   target.
5. It clears the sell-token allowance after a successful target call.
6. It rejects any observed spend above `sellAmount`, refunds unused sell tokens to the owner, and
   preserves any pre-existing executor balance.
7. It measures buy tokens received by the executor, forwards that delta to `recipient`, and requires
   the recipient's actual balance increase to be at least `minBuyAmount`.
8. Any native value returned during the approved call is refunded to the owner. Native transfers
   outside an active execution are rejected.

The quote must be generated with `VectorExecutor` as the 0x taker and must deliver bought tokens to
the executor. Direct-to-recipient router output is intentionally rejected because it cannot be
verified as an executor balance delta.

For Vector's ERC-20 `/swap/allowance-holder` flow, current 0x Swap API v2 semantics require
`transaction.to` and `allowanceTarget` to be the same official AllowanceHolder; a non-null
`issues.allowance.spender` must match them. The only documented case where this endpoint targets
the latest Settler instead is a native-ETH sell, which does not apply to Vector's Base USDC flow.
Settler must never receive ERC-20 approval. Permit2 is a separate execution model and is not mixed
into this policy. References:
[0x contract architecture](https://docs.0x.org/docs/core-concepts/contracts) and
[0x v2 upgrade guide](https://docs.0x.org/docs/upgrading/upgrading-to-swap-v2).

The offchain boundary recognizes AllowanceHolder deployments only through the versioned Base
manifest in `packages/integrations/src/zerox/trusted-contracts.ts`; quote responses cannot extend
it. The executor's execution-target and allowance-target mappings remain separate semantic
permissions even though the same AllowanceHolder address is enabled in both. This preserves
independent revocation and prevents an address approved only for calls from receiving allowance (or
an allowance-only address from receiving arbitrary calldata).

## Storage and administration

The contract stores three boolean address mappings (supported assets, approved execution targets,
and approved allowance targets), one nested owner/nonce consumption mapping, the inherited
`Ownable2Step` owner/pending-owner state, and one execution-scoped native-refund owner slot.
`ReentrancyGuardTransient` uses EIP-1153 transient storage rather than a persistent guard slot.

The `Ownable2Step` administrator can change allowlists but has no token sweep or arbitrary-call
function. Administration is nevertheless a material trust assumption: a malicious or compromised
administrator could approve malicious assets, routers, or spenders for future user-authorized
intents. Production ownership should be transferred to an appropriately secured multisig or
governance process. Every allowlist change emits an event.

## Reentrancy and external-token assumptions

`execute` uses OpenZeppelin's transient reentrancy guard because Base supports the Cancun EVM and
EIP-1153. The nonce is also consumed before external interaction. Deployment to a chain without
EIP-1153 is unsupported unless the guard and compiler target are deliberately changed.

Supported assets are assumed to implement ERC-20 balance and transfer semantics. Short funding is
rejected, and recipient balance measurement protects minimum output for transfer-tax buy tokens,
but rebasing, callback-heavy, ERC-7674 temporary-allowance, or adversarial token behavior requires
separate review before allowlisting.

## Build inputs

The Foundry project pins Solidity `0.8.36`, targets Cancun, enables the optimizer, and leaves FFI
disabled. Dependencies were installed with Foundry's dependency command using exact release tags:

```sh
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 \
  foundry-rs/forge-std@v1.16.1 --no-git
```

OpenZeppelin provides `SafeERC20`, `Ownable2Step`, and `ReentrancyGuardTransient`. `forge-std` is
test-only. Dependency directories are not nested Git repositories and are ignored; rerun the pinned
command after a fresh checkout.

## Intentionally offchain or deferred

Portfolio sizing, reserves, exposure, market triggers, reference prices, quote selection, and
slippage policy remain offchain. The current integration only assembles and validates a Coinbase
user-controlled Smart Account batch; deployment, live UserOperation submission, real-fund testing,
Spend Permissions, signed/delegated execution, and developer-controlled server wallets are
deferred.

CDP user-wallet authentication and signing belong in the browser under the authenticated user's
session (`@coinbase/cdp-hooks` or its lower-level frontend core). A CDP project identifier is public
configuration; CDP secret API keys, Wallet Secrets, developer private credentials, and delegated
signing credentials must never enter a browser bundle. Conversely, the server-oriented
`@coinbase/cdp-sdk` account model is developer controlled and must not be substituted for the user's
Smart Account. The adapter accepts only an injected user-operation sender and defaults submission
to disabled. Paymaster sponsorship is omitted unless the caller deliberately opts in; it is not an
authorization mechanism.

The Base Sepolia browser proof may contain only the public CDP project identifier, authenticated
end-user session state, the user's Smart Account address, and public network/contract addresses.
It must never contain a CDP API secret, Wallet Secret, developer-wallet secret, deployer private
key, or Vector backend signing key. There is no Vector backend signing key in V1. The user must
click **Test Authorization** before the browser requests a harmless UserOperation; page load never
submits one, and the proof is not wired to `VectorExecutionPlan` or `VectorExecutor.execute`.

## Local end-to-end harness

`npm run verify:e2e` starts a fresh loopback-only Anvil process with chain ID `8453`, the public
deterministic Anvil test mnemonic, mock tokens, mock router, and a test-only
`LocalAuthorizationHarness`. The harness atomically dispatches the same approval-then-execute call
array, but it is not a Coinbase Smart Account and proves no Coinbase behavior. The script terminates
the Anvil child in a `finally` block and never reads `.env`, connects to Base, uses real assets, or
submits to 0x/CDP.

The local-only plan mode relaxes the production Base USDC address check solely when trusted config
explicitly says `LOCAL_AUTHORIZATION_HARNESS`; registered enabled mock assets, owner binding, quote
binding, target allowlists, amounts, deadline, nonce, and calldata checks remain enforced.

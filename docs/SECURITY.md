# VectorExecutor V1 security model

`contracts/src/VectorExecutor.sol` is a small, non-upgradeable execution boundary. It does not
decide whether a trade is financially prudent. It executes only an instruction directly submitted
by its stated owner after offchain validation.

## Authorization and replay protection

V1 selects direct authorization: `ExecutionIntent.owner` must equal `msg.sender`. This works for an
EOA today and for later Coinbase Smart Account invocation without requiring a second signature.
There is no relayer, EIP-712 authorization, or Spend Permission in this slice.

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

0x Swap API v2 distinguishes the allowance target from the execution entry point. Official 0x
guidance says allowances must be set only on the API-returned AllowanceHolder or Permit2 address,
never on Settler, while executable calldata is sent to `transaction.to`. Vector therefore stores no
hardcoded 0x address and requires governance to approve each role independently. References:
[0x contract architecture](https://docs.0x.org/docs/core-concepts/contracts) and
[0x Swap API quickstart](https://docs.0x.org/docs/introduction/quickstart/swap-tokens-with-0x-swap-api).

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
slippage policy remain offchain. Coinbase Smart Accounts, Spend Permissions, signed/delegated
execution, deployment, live transaction submission, and real-fund testing are deferred.

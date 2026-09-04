# B20 amount invariant

B20 `balanceOf()` values are canonical raw token amounts used for transfers and execution.
Vector derives UI/economic exposure with exact integer arithmetic:
`floor(rawAmount * multiplier / 1e18)`. The reverse conversion also rounds down.

Future portfolio logic must value the derived UI/economic amount. It must not treat a raw B20
`balanceOf()` result as an ordinary ERC-20 display balance.

## Portfolio reference valuation

The portfolio pipeline is:

`Base balance read → raw token amount → B20 economic amount where applicable → external reference price → portfolio reference valuation`

Balance acquisition never fetches prices. B20 multipliers convert raw token amounts into economic
quantities; they are not prices and do not imply USD value. Standard ERC-20 assets such as USDC
remain on the ordinary raw-token path without a synthetic B20 multiplier.

**REFERENCE PRICE ≠ EXECUTION QUOTE.** A reference price will describe portfolio and trigger state.
An **EXECUTION QUOTE** describes currently obtainable onchain liquidity and routing from 0x and
belongs to a separate execution boundary. It is not a reference-price provider.

For 0x execution quotes, `sellAmount` and `buyAmount` are raw token base units. A quoted B20
`buyAmount` remains the raw amount used by swap calldata; Vector derives its B20 UI/economic amount
separately with the verified multiplier and exposes both values distinctly.

Live tokenized-equity routing may be gated externally by 0x or legal eligibility. Vector must
surface that outcome as execution unavailable; it must not bypass the restriction or substitute a
different asset.

## Deterministic execution risk

AI may interpret user intent, but it does not approve execution. The pure risk engine receives a
valued portfolio snapshot, a portfolio-produced execution reference valuation, an external
execution quote, explicit user constraints, optional reference-price trigger state, and an integer
Unix timestamp. It returns machine-readable `ACCEPTED` or `REJECTED` checks and typed rejection
codes. Acceptance ends at `READY_FOR_AUTHORIZATION`; this layer neither authorizes nor executes.

Checks are emitted in this order: `SCHEMA → ASSET → ACCOUNT → BALANCE → RESERVE → EXPOSURE →
TRIGGER → DEADLINE → QUOTE → SLIPPAGE → POLICY`. Independent failures accumulate. A check is
`SKIPPED` when an invalid prerequisite would make its calculation unsafe.

For a reserve denominated in the sell token:
`postExecutionBalance = currentRawBalance - quotedRawSellAmount`, which must be at least the raw
minimum reserve. Reserves are never converted across assets.

Exposure uses reference valuation produced by the portfolio boundary only. The deterministic model
is:
`postTradeTotal = preTradeTotal - quotedSellReferenceValue + proposedBuyReferenceValue`, then
`postTradeBuyExposure = currentBuyReferenceExposure + proposedBuyReferenceValue`. The position is
accepted only when `postTradeBuyExposure <= floor(postTradeTotal × maxExposureBps / 10000)`. This
models portfolio composition changing without double-counting the purchased asset or retaining the
spent sell-asset value.

Trigger comparisons use only the buy asset's reference price: `PRICE_BELOW` passes at or below its
threshold and `PRICE_ABOVE` passes at or above it. Quote slippage passes only when the explicitly
requested 0x `slippageBps` is at most the user's configured maximum. This is not a claim about
realized execution slippage, which is unavailable before execution.

When configured and both asset reference values are available, quote/reference deviation is
`floor(abs(quotedSellReferenceValue - proposedBuyReferenceValue) × 10000 /
proposedBuyReferenceValue)`. This compares the quote's effective reference value with the buy
asset's reference valuation; it is not realized slippage.

## Onchain execution boundary

The V1 trust boundary is:

`AI (no contract authority) → deterministic offchain risk engine → user or Smart Account
authorization → VectorExecutor → allowlisted external router`

Reserve, exposure, triggers, reference prices, portfolio sizing, quote selection, and slippage
policy remain offchain. `VectorExecutor` is deliberately not another portfolio or risk engine. It
enforces only execution-time invariants: direct owner authorization, asset/target/spender
allowlists, nonce replay protection, an inclusive deadline, exact bounded sell-token allowance,
actual sell and buy balance deltas, minimum recipient output, and unused-input refunds.

V1 uses direct caller authorization: `intent.owner == msg.sender`. A Coinbase Smart Account can
therefore authorize execution by calling the executor itself; there is no duplicate EIP-712
signature or premature relayer requirement. Signed or delegated submission is intentionally
deferred.

## V1 Coinbase Smart Account authorization

The authorization pipeline is deliberately linear:

`AI (draft only) → Risk Engine (ACCEPTED) → Execution Plan Builder → two bounded Smart Account
calls → Coinbase Smart Account user authorization → VectorExecutor execution-time enforcement →
0x external execution dependency`

`VectorExecutionPlan` is the deterministic bridge from `READY_FOR_AUTHORIZATION` to user review.
It is neither a 0x quote nor a receipt. The plan binds Base chain ID `8453`, the Smart Account owner,
deployed executor configuration, registered assets, exact sell and minimum-buy amounts, recipient,
nonce, deadline, executor-bound 0x taker, approved 0x targets, opaque quote calldata, and native call
value. Its calls are a closed ordered tuple: first
`USDC.approve(VectorExecutor, exactSellAmount)` with zero native value, then
`VectorExecutor.execute(intent)` with `intent.callValue`. There is no public third-call input.

Coinbase identifies Base Mainnet as `"base"`. Current CDP user-wallet documentation confirms that
multiple `calls[]` entries execute in order, atomically, in one UserOperation. Vector targets the
user-controlled browser model exposed by `@coinbase/cdp-hooks`, where the authenticated user's
Smart Account address comes from the current-user object and `useSendUserOperation` performs the
authorization. The adapter is structural and injectable, so this repository does not install a
React SDK or create credentials. It defaults submission off and never manages a signing key.

The checked API baseline is `@coinbase/cdp-hooks` `0.0.123` (registry latest on 2026-09-04), but no
Coinbase dependency is added in this non-UI slice. The equivalent request is
`sendUserOperation({ evmSmartAccount, network: "base", calls })`; status can be tracked with
`useWaitForUserOperation({ userOperationHash, evmSmartAccount, network: "base" })`. CDP paymaster
use is optional and opt-in. Without sponsorship, Base Mainnet requires the Smart Account to hold
enough ETH for gas.

Official references:

- [CDP Smart Accounts and atomic batch calls](https://docs.cdp.coinbase.com/wallets/using-wallets/smart-accounts)
- [CDP frontend hooks overview](https://docs.cdp.coinbase.com/sdks/cdp-sdks-v2/frontend/%40coinbase/cdp-hooks/index)
- [CDP authentication implementation guide](https://docs.cdp.coinbase.com/wallets/authentication/implementation-guide)
- [CDP TypeScript SDK and server-controlled EVM Smart Accounts](https://github.com/coinbase/cdp-sdk/blob/main/typescript/packages/cdp-sdk/README.md)

V1 authorization is the user's Smart Account authorization itself. There is no separate signed
ExecutionIntent, Vector relayer signer, delegated signing, or Spend Permission. A future version may
add bounded delegated execution through Spend Permissions, but that authority is not present here.

0x calldata remains opaque. A quote must use the executor as its taker and arrange for bought
tokens to arrive at the executor. The contract cannot independently decode every evolving router
command, so it constrains calldata with separately administered execution-target and
allowance-target allowlists, a temporary exact sell-token allowance, maximum-spend accounting, and
recipient balance-delta verification. A quote that sends output elsewhere fails the executor's
minimum-output check and reverts atomically.

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

0x calldata remains opaque. A quote must use the executor as its taker and arrange for bought
tokens to arrive at the executor. The contract cannot independently decode every evolving router
command, so it constrains calldata with separately administered execution-target and
allowance-target allowlists, a temporary exact sell-token allowance, maximum-spend accounting, and
recipient balance-delta verification. A quote that sends output elsewhere fails the executor's
minimum-output check and reverts atomically.

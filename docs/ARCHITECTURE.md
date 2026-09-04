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

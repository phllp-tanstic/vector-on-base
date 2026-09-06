# Vector on Base — Hackathon Submission

## A. Project name

Vector on Base

## B. One-liner

Turn a market thesis into a portfolio-aware, risk-constrained position you can authorize on Base.

## C. Short description (50–75 words)

Vector on Base turns market intent into an Executable Thesis: a portable, machine-readable thesis
with entry, sizing, reserve, exposure, slippage, and expiry constraints. Deterministic code adapts
the thesis to each user's portfolio and builds an exact execution package. The user—not AI—reviews
and authorizes the result through a Coinbase Smart Account, while VectorExecutor enforces bounded
settlement on Base.

## D. Full description (~150 words)

Vector on Base is an intent execution layer for tokenized markets. A user starts with a market
thesis, which Vector structures as an Executable Thesis containing the asset, entry condition,
requested size, exposure cap, reserve requirement, slippage bound, expiry, and provenance. It
deliberately excludes wallet authority, portfolio state, quotes, calldata, allowances, and nonces.

Deterministic portfolio and risk code adapts the same thesis independently for each user. In the
demo, a $500 request becomes $320 for its creator and $180 for a recipient with different
constraints. The recipient can fork the thesis, but never inherits execution state or authority.

After reference-price and quote validation, Vector builds a canonical intent and an exact two-call
package: approve only the sell amount to VectorExecutor, then execute. A Coinbase Smart Account
asks the user to authorize that package. VectorExecutor enforces owner, nonce, deadline, asset,
target, spender, spend, and minimum-output constraints. A confirmed Base Sepolia transaction proves
the user-controlled authorization and settlement path with isolated test assets.

## E. Problem

Market signals are usually too vague to execute safely and copy-trading systems often transfer
someone else's sizing and timing into a portfolio with different balances, reserves, exposure, and
risk tolerance. Adding AI can make the boundary less clear if interpretation is allowed to become
transaction authority.

## F. Solution

Vector separates portable intent from private execution state. It converts a thesis into a typed,
shareable object, recomputes a position against each user's portfolio, evaluates deterministic risk,
and produces a bounded execution package. The user explicitly authorizes the final calls; AI never
signs, submits, or bypasses constraints.

## G. Why Base

Base combines low-cost EVM settlement with Coinbase Smart Accounts and an emerging tokenized-asset
surface. That lets Vector keep authorization user-controlled while expressing the final action as
an atomic approval-and-execute batch. The production path targets canonical Base USDC and the
verified Coinbase Tokenized Stocks registry.

## H. Technical architecture

`User thesis → interpreter → Executable Thesis → portfolio/reference snapshot + 0x quote →
deterministic risk → canonical VectorExecutionIntent → VectorExecutionPlan → user review → Coinbase
Smart Account → VectorExecutor → Base settlement`

Interpretation has no execution authority. Reference prices and quotes remain separate inputs. Risk
acceptance only unlocks review, and the Smart Account remains the transaction authority.

## I. What makes it novel

- A portable Executable Thesis shares intent and constraints without sharing authority.
- The same thesis is deterministically adapted to different portfolios.
- AI interpretation, risk validation, user authorization, and settlement are explicit boundaries.
- B20 raw transfer amounts remain separate from multiplier-derived economic amounts.
- Forks receive independent identity and application provenance.
- The execution contract combines exact approvals, owner-scoped unordered nonces, allowlists, and
  balance-delta settlement checks around opaque router calldata.

## J. What's live

Coinbase Smart Account authentication is live in the web app. User-controlled Smart Account
authorization, the exact two-call package, VectorExecutor, and recipient balance settlement are
proven on Base Sepolia. Deterministic risk, B20 validation, browser-local thesis persistence, and
Share / Adapt / Fork are implemented. 0x BStocks and Chainlink equity streams are **ACCESS
PENDING**; Base Mainnet VectorExecutor is intentionally not deployed.

## K. Demo instructions

Use the full [judge demo runbook](./DEMO.md), or follow this short path:

1. Interpret the default NVDA thesis.
2. Run risk and show **$500 requested → $320 executable**.
3. Save and share the thesis.
4. Open it as a recipient and adapt it to **$180 executable**.
5. Fork it and inspect parent/root provenance.
6. Prepare the exact two-call Base Sepolia package.
7. Show Coinbase Smart Account authorization and the confirmed receipt.

Always label execution **BASE SEPOLIA · TEST ASSETS · NO REAL STOCKS**.

## L. Known production-access gates

- 0x currently returns `BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE` for the production BStocks route;
  external tokenized-equity access/legal entitlement is pending.
- Chainlink Data Streams server credentials and entitlement to the pinned equity streams are
  pending.
- Base Mainnet VectorExecutor is intentionally not deployed until those external gates are
  resolved.
- Persistence is browser-local and provenance is application-level, not onchain-attested.

## M. GitHub link

`TODO: ADD PUBLIC GITHUB REPOSITORY URL`

## N. Live demo link

`TODO: ADD LIVE DEMO URL`

## O. Base Sepolia contract

VectorExecutor:
[`0x6F638384B3d750F902CE74Fd98a8536C3D8b8EdE`](https://sepolia.basescan.org/address/0x6F638384B3d750F902CE74Fd98a8536C3D8b8EdE)

## P. Execution transaction proof

- UserOperation: `0x586d7c51d1768c18b4fe742d91a38eede645ed388bb43645c54d3a67a1eaa1cb`
- Confirmed transaction:
  [`0xb68a0b23e4582471ce9a7a862a3e2db9aa41d0b7953d18ceb48427e0b717607d`](https://sepolia.basescan.org/tx/0xb68a0b23e4582471ce9a7a862a3e2db9aa41d0b7953d18ceb48427e0b717607d)

The successful Base Sepolia receipt records the Smart Account's exact mUSDC approval to
VectorExecutor, deterministic fixture settlement, allowance clearing, and the recipient's confirmed
NOTB20 balance increase. **TEST ASSETS · NO REAL STOCKS.**

## Judge FAQ

### Is this copy trading?

No. Vector shares a thesis and reusable constraints, not a quote, position size, calldata, nonce,
allowance, or authorization. Every recipient recomputes portfolio sizing and risk and authorizes
independently; a recipient can be blocked even when the creator was accepted.

### Does AI decide trades?

No. Interpretation can structure what the user means, but deterministic code controls portfolio
adaptation, risk checks, and execution-package construction. AI has no signing key and cannot
bypass the Smart Account or `VectorExecutor` constraints; the current demo interpreter is itself a
deterministic NVDA-specific grammar.

### Does Vector custody user funds?

No. The user's Coinbase Smart Account is the transaction authority. During execution,
VectorExecutor pulls only the exact approved sell amount, grants only a temporary exact router
allowance, clears it, settles output to the required recipient, and refunds unused input.

### Is the demo using real stocks?

No. The live proof uses isolated Base Sepolia mUSDC and NOTB20 fixtures plus a deterministic mock
router. It proves Smart Account authorization, exact two-call execution, and settlement invariants;
it does not represent production stock liquidity.

### Why Base?

Base provides low-cost EVM settlement, Coinbase Smart Account support, canonical USDC, and the
production token registry Vector targets. It allows the complete action to remain an atomic,
user-authorized approval-and-execute batch.

### Why not just use a swap UI?

A swap UI starts with an amount and route. Vector starts with a thesis, then adapts it to reserve,
exposure, entry, expiry, and slippage constraints before presenting any authorization. It also makes
that intent portable without making the original execution state portable.

### What is the moat?

Share the thesis, not the trade. Executable Theses create a reusable social object that preserves
intent and provenance while forcing every portfolio to derive its own position, risk result, and
authorization.

### What's preventing Mainnet execution today?

The production integration and read-only readiness checker are implemented, but 0x BStocks access
and Chainlink equity-stream credentials/entitlements are pending. VectorExecutor is intentionally
not deployed on Base Mainnet until those external production gates are resolved.

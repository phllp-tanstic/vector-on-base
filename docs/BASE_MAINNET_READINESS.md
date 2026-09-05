# Base Mainnet BStocks execution readiness

This milestone is a deterministic, read-only audit of the production execution path. It does not
deploy a `VectorExecutor`, change an allowlist, sign a payload, submit a transaction, or authorize a
trade. Base Sepolia remains the only end-to-end execution proof documented in
[`BASE_SEPOLIA.md`](./BASE_SEPOLIA.md).

## Audited path

The production path is intentionally split across packages:

1. `@vector/integrations` defines canonical Base USDC and the verified Coinbase stock registry.
2. The Base B20 verifier checks marker code, factory recognition/initialization, metadata,
   multiplier behavior, and supported interfaces.
3. Portfolio balance and valuation code reads raw balances and applies independent reference
   prices.
4. The 0x client obtains an exact-sell quote whose taker is the configured executor.
5. The execution quote normalizer validates the returned address roles against the versioned Base
   0x contract manifest. For this ERC-20 flow, `transaction.to`, `allowanceTarget`, and a non-null
   `issues.allowance.spender` must identify the same recognized AllowanceHolder.
6. `@vector/risk` independently checks quote issues, reserves, slippage, price deviation, exposure,
   trigger state, and candidate consistency.
7. `@vector/execution` builds the canonical intent and ordered Smart Account plan: an exact USDC
   approval to the executor, followed by `VectorExecutor.execute`.
8. The executor enforces chain, owner, nonce, deadline, assets, execution target, allowance target,
   sell bound, and minimum received balance delta onchain.
9. Coinbase authorization remains a separate explicit user action. The readiness command never
   reaches that layer.

Two limitations are deliberately reported rather than bypassed:

- Chainlink Data Streams is wired as the selected production reference-price provider, but it is
  unavailable until server credentials, subscription entitlement, and a provider-backed risk
  snapshot are configured. A 0x execution quote is not an independent reference price. See
  [`REFERENCE_PRICE_PROVIDER.md`](./REFERENCE_PRICE_PROVIDER.md).
- With the executor as 0x taker, a quote may expose a balance or incomplete-simulation issue because
  the executor is funded only inside the atomic execution. Existing risk checks still reject those
  issues; readiness does not suppress them.

## Read-only command

Configure server-side environment values and run:

```sh
BASE_RPC_URL="https://your-base-mainnet-rpc" \
ZEROX_API_KEY="your-0x-key" \
CHAINLINK_DATA_STREAMS_API_KEY="your-chainlink-key" \
CHAINLINK_DATA_STREAMS_USER_SECRET="your-chainlink-secret" \
VECTOR_EXECUTOR_ADDRESS="0xProductionExecutor" \
VECTOR_MAINNET_SMART_ACCOUNT="0xOptionalSmartAccount" \
VECTOR_MAINNET_STOCK_SYMBOL="NVDAc" \
VECTOR_MAINNET_STOCK_TOKEN_ADDRESS="0xOptionalRegistryAddressPin" \
VECTOR_MAINNET_SELL_USDC="1000000" \
npm run verify:mainnet-readiness
```

`BASE_RPC_URL` defaults to the public Base endpoint. `VECTOR_MAINNET_SMART_ACCOUNT` is optional; if
present, it must be a valid non-zero address and its canonical USDC balance is checked.
`VECTOR_MAINNET_STOCK_SYMBOL` defaults to `NVDAc`. An optional
`VECTOR_MAINNET_STOCK_TOKEN_ADDRESS` pins the expected registry address and cannot introduce a new
asset. The currently verified stock boundary is `NVDAc`, `AAPLc`, `GOOGLc`, and `METAc`. The raw
sell amount defaults to `1000000`, and slippage is fixed at 30 basis points.

The command's dependency surface contains only RPC reads, a 0x HTTPS quote read, and an authenticated
Chainlink Data Streams reference read. It imports no wallet, signer, Coinbase authorization,
contract-write, or UserOperation submission capability. Automated tests scan the command for those
prohibited capabilities. It exits non-zero for every state other than `READY`.

## States

- `READY`: all reads passed, independent risk validation accepted the exact candidate, and the
  canonical two-call package was constructed in memory. It does **not** mean a trade was authorized,
  simulated successfully as a UserOperation, submitted, mined, or guaranteed to remain executable.
- `ACCESS_RESTRICTED`: 0x reported an access restriction. The report preserves whether this was the
  known HTTP 422 `BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE` legal/token restriction or the distinct HTTP
  403 `XSTOCKS_NOT_AUTHORIZED` account-access restriction.
- `QUOTE_UNAVAILABLE`: 0x explicitly reported no liquidity.
- `INSUFFICIENT_BALANCE`: the optional Smart Account's Base USDC balance is below the requested raw
  sell amount.
- `EXECUTOR_NOT_CONFIGURED`: no valid executor is configured or no bytecode exists at its address.
- `ASSET_NOT_SUPPORTED`: the stock is outside the verified registry or either asset is not enabled
  in the executor.
- `B20_VALIDATION_FAILED`: live token identity, metadata, factory, marker, multiplier, or interface
  verification failed.
- `RISK_REJECTED`: the independent deterministic risk engine rejected the candidate.
- `INVALID_QUOTE`: quote fields or canonical intent/plan construction failed validation.
- `REFERENCE_PRICE_PROVIDER_MISSING`: executable quote and contract checks progressed, but no
  configured provider or provider-backed portfolio/risk context exists for risk evaluation.
- `REFERENCE_PRICE_PROVIDER_FAILURE`: the configured provider was unavailable or returned a report
  that failed identity, currency, price, timestamp, session, schema, or freshness validation.
- `CONFIGURATION_ERROR`: RPC chain, executor ownership, target approvals, environment, or another
  required dependency is invalid or unreadable.

The classifier never relabels the known 422 BStocks restriction as no liquidity, a generic
unsupported Base token, or an untyped quote error.

## What `READY` requires

`READY` is possible only when all of the following describe one immutable candidate:

- requested and RPC chain IDs are Base Mainnet (`8453`);
- the configured executor has bytecode and a readable non-zero owner;
- the sell token is canonical Base USDC
  (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`);
- the buy token is an enabled entry in the verified Coinbase stock registry and passes live B20 and
  metadata validation;
- when supplied, the Smart Account is valid and has enough USDC;
- the executor supports both assets;
- the 0x exact-sell response matches chain, pair, executor taker, exact sell amount, minimum buy
  amount, non-empty calldata, and zero native value;
- the allowance target is in the reviewed Base manifest and the AllowanceHolder address relationship
  is exact; a quote-provided address alone grants no trust;
- that recognized AllowanceHolder is already approved in both semantic mappings on the deployed
  executor;
- a verified reference-price/portfolio context binds the same quote and Smart Account; trigger and
  exposure values bind to that provider snapshot and B20 economic amount; and risk accepts it;
- the production builder creates exactly `approve(executor, quotedSellAmount)` followed by
  `executor.execute(intent)` with its bounded nonce and deadline.

## Reference-price dependency audit

The execution quote answers what 0x may execute; it must not become the oracle used to judge its own
fairness. Independent reference prices are required for stock-price triggers, quote/reference value
comparison, portfolio valuation, and maximum single-asset exposure. Raw USDC balance and minimum
reserve checks do not replace those prices. The selected Chainlink adapter enforces provenance,
decimal, market-session, and freshness policy. Without entitled credentials and a snapshot derived
from those prices, the live command stops at `REFERENCE_PRICE_PROVIDER_MISSING` rather than
fabricating `READY`.

## Executor target policy

Quote-derived addresses are observations, not authorization. Never add a target merely because a
single 0x response returned it. `ZEROX_BASE_CONTRACTS_V1` currently pins the official Cancun
AllowanceHolder documented by 0x for Base. Updating that manifest requires an explicit reviewed
code change with official provenance; there is no runtime or automatic admin insertion path.

The executor's two allowlists are intentionally static and separate semantic permissions. Current
AllowanceHolder semantics legitimately require the same official address in both mappings: one
permission authorizes the external call, while the other authorizes temporary ERC-20 allowance.
Keeping both checks prevents either permission from implying the other and permits independent
revocation. If 0x changes deployment or flow semantics, readiness remains blocked until a reviewed
manifest and executor configuration update; the checker and builder never widen trust from a quote.

The readiness output distinguishes `quote-validation`, `quote-target-validation`,
`allowance-holder-recognition`, and `executor-allowlist-compatibility`. Thus a successful 0x API
response is visibly different from a target trusted for execution. When no production executor is
configured, `EXECUTOR_NOT_CONFIGURED` remains the top-level result and no quote is requested.

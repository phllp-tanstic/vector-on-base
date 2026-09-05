# Production reference-price provider decision

Status: **Chainlink Data Streams selected and integrated, but production access is not locally configured.**  
Decision date: 2026-09-05  
Trusted manifest: `chainlink-data-streams-us-equities-v1-2026-09-05`

This decision concerns USD reference prices for portfolio valuation, triggers, and exposure checks. A reference price is not an executable quote, a B20 multiplier, a token UI amount, or a market-order execution price. In particular, a 0x quote is never accepted as an oracle input.

## Decision

Vector uses Chainlink Data Streams 24/5 U.S. Equities reports with the RWA Advanced V11 schema. Chainlink's official unauthenticated [Discovery endpoint](https://docs.chain.link/data-streams/reference/data-streams-api/discovery-endpoint) identifies every selected stream as `live`, `mainnet`, `Equities`, and USD quoted. V11 provides a DON consensus `mid`, the mid's `lastSeenTimestampNs`, and an explicit `marketStatus`. The service is usable by a server through authenticated REST, and Chainlink also lists Base among the networks supporting Streams Trade/onchain lookup and verifier infrastructure in its [supported networks documentation](https://docs.chain.link/data-streams/supported-networks).

Data access still requires a Chainlink subscription, an API key, and a user secret. Production use also requires review of the applicable subscription, market-data rights, rate limits, and display/redistribution terms. The [billing documentation](https://docs.chain.link/data-streams/billing) describes subscription billing but does not publish a generally applicable mainnet price. Until both credentials are configured and entitled to all twelve streams, `REFERENCE_PRICE_PROVIDER_MISSING` remains a deployment blocker.

## Versioned trusted source manifest

The IDs below were returned by the official mainnet Discovery API with `feed_type=Equities`, `quote_asset=USD`, and `status=live` on the decision date. Vector pins all IDs; it does not derive them from token symbols or accept runtime IDs.

| Vector asset | Underlying      | Regular-hours V11 feed                                               | Extended-hours V11 feed                                              | Overnight V11 feed                                                   |
| ------------ | --------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `NVDAc`      | NVDA            | `0x000b6aa036224454037bab103184565f6aa9ea589c3b349f6d8471ee753524b9` | `0x000bb043961643d051393c085a4dd0cded6f67b4b71e47e9dcec739b7b3e2145` | `0x000b47988e89f3e63e1d679c84b774e6c38bb9929ad9de6e5e56d657a80388a9` |
| `AAPLc`      | AAPL            | `0x000bbd87a23775b4c11092ae9a1fc7b3393636ae1dbb9f1ef460f845c0f4cff1` | `0x000b8b9394931d376dbfd988ab3e459b1954ca10880d6a2ec706cd2573910b5b` | `0x000b313c8a4997a3bc871130415ffeb42cd37b79cf68c11478780650cc553c0b` |
| `GOOGLc`     | GOOGL (Class A) | `0x000b1a2aa24db17599e5003a09bcd5e2a15ef66f79c2dca4dde108ab923b1e97` | `0x000ba0be5e4c3746e3ebccec37362d9640ae6e9fee07bbb95ebdfd37d0220355` | `0x000b2630095c8e9f31bde1f89f6b99106f7740649b7a9bde504ad6f8cf52cfbc` |
| `METAc`      | META            | `0x000bc63e601958daafb805b1eecc3972a0ad231e8c08c0432961b7b5c3251166` | `0x000b2f98113576782a2bb2cecbbfd034d7c949d8457ff81dfa68b6b2927dc2ee` | `0x000bd63dc623dc102eeed0fe61ae7a3e13a28961df9a79912147f0234706f7ef` |

The manifest lives in `packages/integrations/src/chainlink/reference-price-manifest.ts`. A manifest update must re-check the Discovery record's base asset, quote asset, attribute type, schema, mainnet network type, live status, and decommission fields for every ID.

## Market-hours and freshness policy

Chainlink exposes each instrument as separate regular, extended, and overnight streams. Its [24/5 U.S. Equities guide](https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide) requires routing with `marketStatus`, not timestamps:

| V11 status | Meaning                                                     | Vector source selection                             |
| ---------- | ----------------------------------------------------------- | --------------------------------------------------- |
| 0          | Unknown                                                     | Reject; do not guess a session                      |
| 1          | Pre-market, 04:00–09:30 ET Mon–Fri                          | Extended feed                                       |
| 2          | Regular, 09:30–16:00 ET Mon–Fri                             | Regular feed                                        |
| 3          | Post-market, 16:00–20:00 ET Mon–Fri                         | Extended feed                                       |
| 4          | Overnight, 20:00–04:00 ET Sun evening–Fri morning           | Overnight feed                                      |
| 5          | Closed, including weekends, holidays, or unexpected closure | Last regular reference, subject to the closed bound |

The provider says all three phase feeds carry old values while status is closed; this is expected market inactivity, not by itself an outage. Vector therefore keeps the distinction between `CLOSED`, stale data, and provider unavailability.

Vector's deterministic policy is:

- Active session (statuses 1–4): the selected feed's mid timestamp may be at most 300 seconds old.
- Closed market (status 5): the last regular-session reference may be at most 345,600 seconds (96 hours) old, covering an ordinary or three-day weekend. It remains a reference only; it is not an executable price.
- Future tolerance: 30 seconds. Anything further ahead is rejected.
- `lastSeenTimestampNs` must exist and be positive. It is floored to whole Unix seconds only after integer parsing.
- Price must be positive, use V11's documented 18-decimal fixed-point scale, be USD quoted, and come from the phase-specific pinned ID.
- Unknown status, wrong schema/currency/source, unsupported asset, stale/future/missing timestamp, non-positive price, authentication error, timeout, decode error, or provider outage fails closed with a typed error. There is no fallback to 0x or to a token market price.

Chainlink notes that the mid timestamp can pause or move non-monotonically as the provider consensus changes. Vector evaluates the returned snapshot against `now`; it does not require monotonicity across independent reads.

## Corporate actions

The selected underlying-equity V11 reports do not carry B20/xStock multipliers. Chainlink's [market-event guidance](https://docs.chain.link/data-streams/rwa-streams/handling-market-events) says a close can repeat until the first split-adjusted or post-event print and recommends application-level monitoring and pausing around splits, spin-offs, dividends, and other discontinuities. Vector therefore keeps corporate-action handling separate:

- the Chainlink report supplies the underlying per-share reference price;
- the verified onchain B20 adapter supplies raw-to-economic amount conversion and multiplier state;
- portfolio valuation multiplies the B20 economic amount by the underlying reference price using bigint fixed-point arithmetic;
- no oracle adapter changes token transfer or execution units.

Operational corporate-action monitoring and a bounded transition/circuit-breaker policy remain required before unmonitored production operation.

## Candidates evaluated

### Chainlink Data Feeds — rejected for this integration

Chainlink's push-based feeds are onchain reference contracts updated by deviation/heartbeat. Official catalog pages verify some exact equity/USD feeds, including [NVDA/USD on Arbitrum](https://data.chain.link/feeds/arbitrum/mainnet/nvda-usd) and [AAPL/USD on Polygon](https://data.chain.link/feeds/polygon/mainnet/AAPL-usd). The official catalog did not verify a current Base Mainnet Data Feeds set covering all four exact equities. Cross-chain availability of nearby feeds is not Base availability, so Vector does not select Data Feeds or bridge/copy another chain's answer.

### Chainlink Data Streams — selected

Exact NVDA, AAPL, GOOGL Class A, and META coverage is verified in the official Discovery API. The pull model supplies authenticated, signed high-frequency reports; V11 preserves market session, mid timestamp, and 18-decimal integer price. REST requests require API-key plus HMAC-secret authentication as described in [Data Streams authentication](https://docs.chain.link/data-streams/reference/data-streams-api/authentication). Server-side consumption and Base report verification are supported. Subscription access and market-data rights must be confirmed for Vector's use.

### Pyth Core and Pyth Pro — viable alternate, not selected

Pyth's official catalog verifies exact USD equity products for [NVDA](https://app.pyth.com/explore/Equity.US.NVDA%2FUSD), [AAPL](https://app.pyth.com/explore/Equity.US.AAPL%2FUSD), [GOOGL](https://app.pyth.com/explore/Equity.US.GOOGL%2FUSD), and [META](https://app.pyth.com/explore/Equity.US.META%2FUSD). Pyth Pro identifies them as numeric feed IDs 1314, 922, 1163, and 1272 respectively, with exponent -5 and 24/5 coverage. Its [payload reference](https://docs.pyth.network/price-feeds/pro/payload-reference) includes price, exponent, feed update timestamp, and market session; the [REST API](https://docs.pyth.network/price-feeds/pro/api/rest) requires a server-side bearer key. Pyth also documents carried-forward prices and corporate-action behavior.

Pyth Pro is technically plausible, but equity API access is a paid/entitled product under the [published plans](https://app.pyth.com/plans) and subscription terms. Vector selected Chainlink because its current public Discovery API explicitly marks the exact phase streams as production-live, the reports are DON-signed and independently verifiable, and Base verifier/onchain-lookup support is documented. Pyth remains a candidate for future independent-source comparison, not an automatic fallback.

### Coinbase Exchange / Advanced Trade market data — rejected

Coinbase documents public product/ticker market data for exchange trading pairs in its [Exchange API](https://docs.cdp.coinbase.com/exchange/introduction/welcome) and exposes a public product list. A read-only check on the decision date returned no `NVDA-USD`, `AAPL-USD`, or `GOOGL-USD` Exchange products. `META-USD` exists as a ticker collision but Coinbase's product response does not identify it as Meta Platforms equity reference data. Coinbase does not document this API as a four-underlying consolidated equity oracle, market-session feed, or corporate-action-aware reference service. It therefore does not qualify.

## Integration and failure boundary

The production adapter is server-only and implements the existing `ReferencePriceProvider`. It uses the official Chainlink TypeScript SDK to authenticate, fetch, and decode V11 reports. It returns the Vector asset, bigint price, 18 decimals, mid publication/observation timestamp, provider, exact feed ID, USD quote currency, and normalized market status.

`verify:mainnet-readiness` remains read-only. When both `CHAINLINK_DATA_STREAMS_API_KEY` and `CHAINLINK_DATA_STREAMS_USER_SECRET` are absent, no provider is constructed and readiness retains `REFERENCE_PRICE_PROVIDER_MISSING`. Partial configuration is a configuration error. An authenticated read/decode/freshness failure produces `REFERENCE_PRICE_PROVIDER_FAILURE`. A successful read passes the reference-price check, but production readiness still requires a provider-backed portfolio/risk snapshot and all existing executor, quote, asset, and risk checks.

## Required production setup and unresolved limitations

1. Subscribe to Chainlink Data Streams mainnet and confirm the API key is entitled to all twelve pinned IDs.
2. Obtain written confirmation that Vector's server-side, non-display risk/valuation use and any downstream display or derived-data behavior are licensed.
3. Set both server-only environment variables. Never expose either through `NEXT_PUBLIC_*` or logs.
4. Run `npm run verify:mainnet-readiness` during an active session and a closed session, recording only symbol, provider, scale, timestamp, market status, and freshness—not secrets or raw signed reports.
5. Add production monitoring for feed decommission notices, clock synchronization, corporate actions, session transitions, entitlement/rate-limit failures, and prolonged stale reads.

No live price read was performed for this decision because no Chainlink Data Streams credentials were configured locally. The public Discovery query was metadata-only and did not return a price.

The current readiness projection values canonical Base USDC at one USD when comparing the sell leg with the stock reference. Independent USDC/USD depeg pricing is outside this stock-provider task and remains an explicit production risk-policy limitation.

# Executable Thesis persistence and sharing

Vector persists an Executable Thesis as versioned market intent and reusable constraints. It is
separate from execution/session state: a saved or shared thesis never contains a nonce, quote,
calldata, allowance/execution target, UserOperation, authorization, accepted risk snapshot, Smart
Account authority, or receipt.

## Storage boundary

`ExecutableThesisRepository` exposes `save`, `get`, `list`, `update`, `delete`, and `fork`.
`LocalExecutableThesisRepository` is the browser-local MVP implementation under the versioned
`vector.executable-theses.v1` key. Product logic depends on the interface-shaped boundary so a
hosted implementation can replace it without spreading storage calls through components.

Confirmed execution receipts use the separate `LocalThesisExecutionRepository` and
`ThesisExecutionRecord` model. Only a record with confirmed transaction and UserOperation hashes is
accepted. History is display-only and is never treated as future authority.

## Public payload and identity

Share URLs use `/share?thesis=<base64url>` and embed a bounded payload with:

- schema `vector.executable-thesis` and version `1`;
- thesis ID, creator, asset, text, rationale, entry condition, requested position, expiry;
- exposure, reserve, and slippage constraints; and
- application-level original/fork provenance.

The decoder enforces the byte-safe alphabet, a 6,000-character bound, exact known fields, supported
schema/version, NVDA asset identity, valid timestamps, and possible numeric constraints. Canonical
serialization reconstructs every field in a fixed order. The fingerprint is SHA-256 over that
canonical JSON. It identifies provenance; it is not a signature or authorization.

## Adaptation and forks

Opening a link is inspection only. **Adapt to my portfolio** creates a fresh working thesis and runs
the existing deterministic risk calculation against the recipient context. It does not inherit the
creator's executable size. In the demo, the creator fixture adapts $500 to $320; the recipient fixture
has $1,180 available USDC and independently adapts the same request to $180.

A fork receives a new ID and fingerprint. Its provenance records parent, root, time, and the current
Smart Account identity. It starts as a draft (or expired), with no risk acceptance, prepared plan,
nonce, transaction data, or authorization. It then follows the normal risk → acceptance → prepare →
two-call preview → user authorization pipeline. An expired thesis remains inspectable and forkable,
but deterministic risk blocks it until the owner explicitly supplies a new valid expiry.

## Demo walkthrough

1. Sign in, interpret the default NVDA thesis, and select **Save thesis**.
2. In **My Theses**, select **Copy share link**.
3. Open the link in an incognito browser. Inspect the public thesis before signing in.
4. Sign in as the recipient and select **Adapt to my portfolio**. Observe `$320 → $180` as an
   explicit creator/recipient comparison.
5. Select **Fork thesis**. The fork appears in **My Theses** with parent/root provenance.
6. Run risk again, explicitly accept any adjustment, prepare the Base Sepolia package, and authorize
   only if desired. Confirmed testnet settlement is then stored in the separate execution history.

Local storage is intentionally browser- and origin-scoped for the hackathon MVP. Links are public
bearer data (without secrets), there is no hosted sync, and provenance is not onchain-attested.

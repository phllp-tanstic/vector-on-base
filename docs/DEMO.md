# Vector on Base — Judge Demo Runbook

Target length: 2–3 minutes. Use a pre-funded Coinbase Smart Account on Base Sepolia. The demo must
always show **BASE SEPOLIA LIVE DEMO · TEST ASSETS · NO REAL STOCKS**. Never describe NOTB20 as
NVDA stock; it is only the isolated test settlement asset.

## Before the judge arrives

- Open the app on desktop and confirm the header says Base Sepolia.
- Sign in with the demo email and confirm the Coinbase Smart Account resolves.
- Confirm the account has at least 1 mUSDC. If not, follow the manual setup in
  `docs/BASE_SEPOLIA.md`; do not mint from the product UI.
- Select **Reset current demo**. This preserves sign-in, the wallet, saved theses, and confirmed
  receipts. Clear saved demo theses separately only if the library needs a clean slate.
- Keep one previously confirmed receipt available as the network fallback.

## 0:00–0:20 — What Vector is

Action: Point to the headline and the four-step strip.

Say: “Vector turns a market thesis into a portfolio-aware, risk-constrained position that I can
authorize on Base. AI structures what I mean; deterministic code applies portfolio and risk rules;
I authorize the final execution.”

Do not dwell on: protocol names, contract addresses, or production dependencies.

## 0:20–0:50 — Create the NVDA thesis

Action: Show the default thesis, then select **Interpret thesis**.

Say: “I asked to buy $500 of NVDA exposure below $170, capped at 10% of my portfolio, while
preserving $1,000 USDC and limiting slippage to 1%. Vector turns that into an Executable Thesis.”

Action: Briefly point to the entry, intended size, reserve, slippage, and expiry fields.

Do not dwell on: the demo grammar implementation. State only that free-form text does not flow
directly into execution.

## 0:50–1:15 — Show the $500 → $320 adaptation

Action: Select **Run risk check**.

Say: “I requested $500. The Demo Mode portfolio has $1,320 USDC, so deterministic reserve logic
reduces the executable position to $320 to preserve $1,000. AI did not choose $320.”

Action: Select **Accept adaptation and continue**.

Say: “The adjustment requires my acceptance before authorization becomes available.”

Do not dwell on: every risk metric. Point only to requested size, adapted size, and reserve reason.

## 1:15–1:45 — Save and share

Action: Select **Save thesis**, then **Copy share link**. Show **My Theses**.

Say: “Saving creates a local thesis record, not a quote or authorization. The public link carries
the thesis and reusable constraints only—never portfolio data, a prepared execution, or authority.”

Do not dwell on: the fingerprint or local-storage implementation.

## 1:45–2:10 — Recipient adapts to $180 and forks

Action: Open the shared link in the signed-out recipient context. Show the public thesis, sign in,
then select **Adapt to my portfolio**.

Say: “The same $500 thesis produced $320 for the creator. The recipient Demo Mode portfolio has
$1,180 USDC, so the same deterministic reserve rule computes a different safe position: $180. The
trade is not copied, and recipient authorization is independent.”

Action: Select **Fork thesis** and point to **Application provenance**, **Forked from**, and
**Root thesis**.

Do not dwell on: long identifiers. Provenance is application metadata, not an onchain claim.

## 2:10–2:40 — Authorization and execution proof

Action: Accept the recipient adaptation if required, then select **Prepare execution**.

Say: “Preparation is explicit and creates a five-minute package. I am authorizing a 1 mUSDC test
settlement on Base Sepolia with a minimum receive of 1 NOTB20.”

Action: Point to **2 onchain calls**.

Say: “Call one approves exactly the sell amount to VectorExecutor. Call two executes the reviewed
intent. Nothing submits until I select Authorize 2 calls in the Coinbase-controlled account.”

Action: For a live run, select **Authorize 2 calls** and approve it in the Coinbase prompt. Never
perform this step during automated verification.

Do not dwell on: nonce, base units, router address, or encoded call details unless a judge asks;
those remain under Technical details.

## 2:40–3:00 — Receipt and production readiness

Action: Show **Thesis executed**, the received amount, transaction proof, and **View transaction on
BaseScan**.

Say: “This receipt links the executed thesis to the Smart Account, VectorExecutor, UserOperation,
confirmed Base Sepolia transaction, timestamp, and deterministic reason.”

Action: Point briefly to Capability readiness.

Say: “Smart Account authorization, VectorExecutor architecture, B20 validation, and deterministic
risk are ready. 0x BStocks and Chainlink equity access are pending, and Base Mainnet is not
deployed.”

Do not dwell on: the readiness panel after stating the truthful boundary.

## Base Sepolia fallback

If balance reads, authorization, or confirmation are temporarily unavailable:

1. Do not retry repeatedly and do not change networks.
2. Keep the prepared execution view onscreen and explain its exact approval, deadline, and explicit
   authorization boundary.
3. Open a previously confirmed receipt from Execution history and its BaseScan transaction.
4. State: “The live testnet is temporarily unavailable; this is a prior confirmed Base Sepolia
   receipt. No transaction is being simulated or represented as current.”
5. Continue to the production-readiness panel. Never imply that a pending operation is confirmed.

## Submission screenshot checklist

Capture at standard desktop width unless the submission calls for another size. Keep the Base
Sepolia and test-asset labels visible wherever execution appears.

1. Landing and default thesis composer, including the four-step value loop.
2. Structured Executable Thesis with the interpreted constraints.
3. Creator risk adjustment showing **Requested $500 → Vector-adapted $320** and the reserve reason.
4. Saved thesis in **My Theses**.
5. Public shared thesis while signed out, including **PUBLIC INTENT · NOT AUTHORIZATION**.
6. Recipient adaptation showing **$500 shared request / $320 creator / $180 recipient**.
7. Fork with compact **Application provenance**, parent, and root.
8. Execution preview with sell amount, asset, minimum receive, network, deadline, and two calls.
9. Successful receipt with transaction proof and BaseScan action.
10. Capability readiness with the four READY, two ACCESS PENDING, and one NOT DEPLOYED states.

Before capture, check 390px mobile, tablet, standard desktop, and wide desktop for overflow,
reachable actions, readable cards, and truncated copyable identifiers.

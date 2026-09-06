import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_DEMO_THESIS,
  editThesisParameters,
  interpretDemoThesis,
} from "./executable-thesis.ts";
import {
  LocalExecutableThesisRepository,
  LocalThesisExecutionRepository,
  MAX_SHARE_PAYLOAD_LENGTH,
  adaptPublicThesis,
  canonicalSerializePublicThesis,
  decodeSharePayload,
  encodeSharePayload,
  fingerprintPublicThesis,
  persistedFromWorkingThesis,
  resetLocalDemoProductState,
  toPublicThesisPayload,
  validatePublicThesisPayload,
  workingThesisFromPublic,
  type KeyValueStorage,
} from "./persisted-thesis.ts";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const CREATOR = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

async function fixture() {
  return persistedFromWorkingThesis(
    interpretDemoThesis(DEFAULT_DEMO_THESIS, NOW),
    CREATOR,
    undefined,
    NOW,
  );
}

describe("persisted executable theses", () => {
  it("saves, loads, updates, lists, and deletes through the repository boundary", async () => {
    const repository = new LocalExecutableThesisRepository(new MemoryStorage());
    const thesis = await fixture();
    repository.save(thesis);
    assert.deepEqual(repository.get(thesis.id), thesis);
    assert.equal(repository.list().length, 1);
    repository.update(thesis.id, {
      ...thesis,
      status: "ARCHIVED",
      updatedAt: "2026-09-03T00:00:00.000Z",
    });
    assert.equal(repository.get(thesis.id)?.status, "ARCHIVED");
    repository.delete(thesis.id);
    assert.equal(repository.get(thesis.id), undefined);
    assert.throws(
      () => repository.save({ ...thesis, version: 2 } as never),
      /Unsupported thesis version/u,
    );
  });

  it("uses canonical serialization and a deterministic SHA-256 fingerprint", async () => {
    const payload = toPublicThesisPayload(await fixture());
    assert.equal(
      canonicalSerializePublicThesis(payload),
      canonicalSerializePublicThesis(structuredClone(payload)),
    );
    const first = await fingerprintPublicThesis(payload);
    const second = await fingerprintPublicThesis(structuredClone(payload));
    assert.equal(first, second);
    assert.match(first, /^sha256:[0-9a-f]{64}$/u);
  });

  it("round trips a bounded share payload and excludes execution/private state", async () => {
    const thesis = {
      ...(await fixture()),
      nonce: 7,
      calldata: "secret",
      portfolio: { balance: 4 },
    };
    const payload = toPublicThesisPayload(thesis);
    const encoded = encodeSharePayload(payload);
    assert.ok(encoded.length < MAX_SHARE_PAYLOAD_LENGTH);
    assert.deepEqual(decodeSharePayload(encoded), payload);
    for (const forbidden of [
      "nonce",
      "calldata",
      "portfolio",
      "authorization",
      "allowance",
      "transactionHash",
    ]) {
      assert.equal(Object.hasOwn(payload, forbidden), false);
    }
  });

  it("rejects malformed, oversized, unknown-field, and unsupported-version payloads", async () => {
    const payload = toPublicThesisPayload(await fixture());
    assert.throws(() => decodeSharePayload("%%%"), /Malformed/u);
    assert.throws(() => decodeSharePayload("a".repeat(MAX_SHARE_PAYLOAD_LENGTH + 1)), /too large/u);
    assert.throws(
      () => validatePublicThesisPayload({ ...payload, version: 2 }),
      /Unsupported thesis version/u,
    );
    assert.throws(
      () => validatePublicThesisPayload({ ...payload, nonce: 1 }),
      /unknown or missing/u,
    );
    assert.throws(
      () =>
        validatePublicThesisPayload({
          ...payload,
          asset: "0x0000000000000000000000000000000000000000",
        }),
      /schema validation/u,
    );
    assert.throws(
      () =>
        validatePublicThesisPayload({
          ...payload,
          constraints: { ...payload.constraints, maxExposureBps: 10_001 },
        }),
      /schema validation/u,
    );
  });

  it("recomputes sizing from the recipient portfolio and can block independently", async () => {
    const payload = toPublicThesisPayload(await fixture());
    const adapted = adaptPublicThesis(
      payload,
      {
        availableUsdcUsd: 1_180,
        currentAssetExposureUsd: 0,
        currentReferencePriceUsd: 168.4,
        portfolioValueUsd: 5_000,
        quotedSlippagePercent: 0.75,
      },
      NOW,
    );
    assert.equal(adapted.risk.executableSizeUsd, 180);
    assert.notEqual(adapted.risk.executableSizeUsd, 320);
    const blocked = adaptPublicThesis(
      payload,
      {
        availableUsdcUsd: 4_000,
        currentAssetExposureUsd: 500,
        currentReferencePriceUsd: 168.4,
        portfolioValueUsd: 5_000,
        quotedSlippagePercent: 0.75,
      },
      NOW,
    );
    assert.equal(blocked.risk.state, "BLOCKED");
  });

  it("forks with a new identity/fingerprint, root provenance, and no execution state", async () => {
    const repository = new LocalExecutableThesisRepository(new MemoryStorage(), () => "fork-1");
    const original = { ...(await fixture()), nonce: 4, approval: true };
    const fork = await repository.fork(original, RECIPIENT, NOW);
    assert.equal(fork.id, "fork-1");
    assert.notEqual(fork.fingerprint, original.fingerprint);
    assert.deepEqual(fork.provenance, {
      kind: "FORK",
      parentThesisId: original.id,
      rootThesisId: original.id,
      forkedAt: NOW.toISOString(),
      forkedBy: RECIPIENT,
    });
    assert.equal("nonce" in fork, false);
    assert.equal("approval" in fork, false);
    const nestedRepository = new LocalExecutableThesisRepository(
      new MemoryStorage(),
      () => "fork-2",
    );
    const nested = await nestedRepository.fork(fork, CREATOR, NOW);
    assert.equal(nested.provenance.kind === "FORK" && nested.provenance.rootThesisId, original.id);
  });

  it("restores shared and forked intent without prepared execution or risk acceptance", async () => {
    const payload = toPublicThesisPayload(await fixture());
    const working = workingThesisFromPublic(payload, "recipient-copy");
    assert.equal(working.status, "INTERPRETED");
    assert.equal(working.planRevision, 0);
    assert.equal("prepared" in working, false);
    assert.equal("risk" in working, false);
    const edited = editThesisParameters(working, { maxSlippagePercent: 0.5 });
    assert.equal(edited.planRevision, 1);
    assert.equal(edited.status, "INTERPRETED");
  });

  it("blocks expired shared theses without silently extending expiry", async () => {
    const persisted = await persistedFromWorkingThesis(
      editThesisParameters(interpretDemoThesis(DEFAULT_DEMO_THESIS, NOW), {
        expiryIso: "2026-09-01T00:00:00.000Z",
      }),
      CREATOR,
      undefined,
      NOW,
    );
    const adapted = adaptPublicThesis(
      toPublicThesisPayload(persisted),
      {
        availableUsdcUsd: 5_000,
        currentAssetExposureUsd: 0,
        currentReferencePriceUsd: 168,
        portfolioValueUsd: 5_000,
        quotedSlippagePercent: 0.5,
      },
      NOW,
    );
    assert.equal(adapted.risk.state, "BLOCKED");
    assert.equal(adapted.risk.expiryValid, false);
    assert.equal(adapted.thesis.parameters.expiryIso, "2026-09-01T00:00:00.000Z");
  });

  it("stores execution history only after a confirmed success", () => {
    const repository = new LocalThesisExecutionRepository(new MemoryStorage());
    assert.throws(
      () =>
        repository.saveConfirmed({
          thesisId: "t",
          executionId: "e",
          network: "base-sepolia",
          status: "CONFIRMED",
          sellAmount: "1 mUSDC",
          receiveAmount: "1 NOTB20",
          executedAt: NOW.toISOString(),
          smartAccount: CREATOR,
          userOperationHash: "",
          transactionHash: "",
        }),
      /Only confirmed/u,
    );
    repository.saveConfirmed({
      thesisId: "t",
      executionId: "e",
      network: "base-sepolia",
      status: "CONFIRMED",
      sellAmount: "1 mUSDC",
      receiveAmount: "1 NOTB20",
      executedAt: NOW.toISOString(),
      smartAccount: CREATOR,
      userOperationHash: "0xuserop",
      transactionHash: "0xtx",
    });
    assert.equal(repository.list("t").length, 1);
  });

  it("resets only explicitly selected local demo state without touching receipts", async () => {
    const storage = new MemoryStorage();
    const theses = new LocalExecutableThesisRepository(storage);
    const receipts = new LocalThesisExecutionRepository(storage);
    theses.save(await fixture());
    receipts.saveConfirmed({
      thesisId: "t",
      executionId: "e",
      network: "base-sepolia",
      status: "CONFIRMED",
      sellAmount: "1 mUSDC",
      receiveAmount: "1 NOTB20",
      executedAt: NOW.toISOString(),
      smartAccount: CREATOR,
      userOperationHash: "0xuserop",
      transactionHash: "0xtx",
    });

    assert.deepEqual(resetLocalDemoProductState(storage, false), {
      clearedSavedTheses: false,
      preservedExecutionReceipts: true,
    });
    assert.equal(theses.list().length, 1);
    resetLocalDemoProductState(storage, true);
    assert.equal(theses.list().length, 0);
    assert.equal(receipts.list().length, 1);
  });
});

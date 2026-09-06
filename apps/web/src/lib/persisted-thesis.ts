import {
  evaluateThesisRisk,
  type DemoPortfolioSnapshot,
  type DeterministicThesisParameters,
  type ExecutableThesis,
  type ThesisRiskResult,
} from "./executable-thesis.ts";

export const EXECUTABLE_THESIS_SCHEMA = "vector.executable-thesis" as const;
export const EXECUTABLE_THESIS_VERSION = 1 as const;
export const MAX_SHARE_PAYLOAD_LENGTH = 6_000;

export type PersistedThesisStatus = "DRAFT" | "ACTIVE" | "EXPIRED" | "EXECUTED" | "ARCHIVED";

export type ThesisProvenance =
  | Readonly<{ kind: "ORIGINAL" }>
  | Readonly<{
      kind: "FORK";
      parentThesisId: string;
      rootThesisId: string;
      forkedAt: string;
      forkedBy: string;
    }>;

export interface PersistedExecutableThesis {
  readonly schema: typeof EXECUTABLE_THESIS_SCHEMA;
  readonly version: typeof EXECUTABLE_THESIS_VERSION;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly creator: string;
  readonly asset: "NVDA";
  readonly thesisText: string;
  readonly rationale: string;
  readonly entryCondition: Readonly<{ operator: "AT_OR_BELOW"; priceUsd: number }>;
  readonly requestedPositionUsd: number;
  readonly maxExposureBps: number;
  readonly reserveRequirementUsd: number;
  readonly maxSlippageBps: number;
  readonly expiry: string;
  readonly status: PersistedThesisStatus;
  readonly provenance: ThesisProvenance;
  readonly fingerprint: string;
}

export interface PublicThesisPayload {
  readonly schema: typeof EXECUTABLE_THESIS_SCHEMA;
  readonly version: typeof EXECUTABLE_THESIS_VERSION;
  readonly thesisId: string;
  readonly creator: string;
  readonly asset: "NVDA";
  readonly thesisText: string;
  readonly rationale: string;
  readonly entryCondition: Readonly<{ operator: "AT_OR_BELOW"; priceUsd: number }>;
  readonly requestedPositionUsd: number;
  readonly constraints: Readonly<{
    maxExposureBps: number;
    reserveRequirementUsd: number;
    maxSlippageBps: number;
  }>;
  readonly expiry: string;
  readonly provenance: ThesisProvenance;
}

export interface ThesisExecutionRecord {
  readonly thesisId: string;
  readonly executionId: string;
  readonly network: "base-sepolia";
  readonly status: "CONFIRMED";
  readonly sellAmount: string;
  readonly receiveAmount: string;
  readonly executedAt: string;
  readonly smartAccount: string;
  readonly userOperationHash: string;
  readonly transactionHash: string;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ExecutableThesisRepository {
  save(thesis: PersistedExecutableThesis): void;
  get(id: string): PersistedExecutableThesis | undefined;
  list(): readonly PersistedExecutableThesis[];
  update(id: string, thesis: PersistedExecutableThesis): void;
  delete(id: string): void;
  fork(
    thesis: PersistedExecutableThesis,
    forkedBy: string,
    now?: Date,
  ): Promise<PersistedExecutableThesis>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function validProvenance(value: unknown): value is ThesisProvenance {
  if (!isRecord(value)) return false;
  if (value.kind === "ORIGINAL") return Object.keys(value).length === 1;
  return (
    value.kind === "FORK" &&
    validIdentity(value.parentThesisId) &&
    validIdentity(value.rootThesisId) &&
    validIdentity(value.forkedBy) &&
    typeof value.forkedAt === "string" &&
    Number.isFinite(Date.parse(value.forkedAt)) &&
    Object.keys(value).length === 5
  );
}

const PUBLIC_KEYS = [
  "schema",
  "version",
  "thesisId",
  "creator",
  "asset",
  "thesisText",
  "rationale",
  "entryCondition",
  "requestedPositionUsd",
  "constraints",
  "expiry",
  "provenance",
] as const;

export function validatePublicThesisPayload(value: unknown): PublicThesisPayload {
  if (!isRecord(value)) throw new Error("Malformed shared thesis payload.");
  if (value.schema !== EXECUTABLE_THESIS_SCHEMA) throw new Error("Unsupported thesis schema.");
  if (value.version !== EXECUTABLE_THESIS_VERSION) throw new Error("Unsupported thesis version.");
  if (
    Object.keys(value).length !== PUBLIC_KEYS.length ||
    !PUBLIC_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    throw new Error("Shared thesis contains unknown or missing fields.");
  }
  const entry = value.entryCondition;
  const constraints = value.constraints;
  if (
    !validIdentity(value.thesisId) ||
    !validIdentity(value.creator) ||
    value.asset !== "NVDA" ||
    typeof value.thesisText !== "string" ||
    value.thesisText.length === 0 ||
    value.thesisText.length > 2_000 ||
    typeof value.rationale !== "string" ||
    value.rationale.length > 2_000 ||
    !isRecord(entry) ||
    Object.keys(entry).length !== 2 ||
    entry.operator !== "AT_OR_BELOW" ||
    !finiteInRange(entry.priceUsd, 0.01, 1_000_000) ||
    !finiteInRange(value.requestedPositionUsd, 0.01, 100_000_000) ||
    !isRecord(constraints) ||
    Object.keys(constraints).length !== 3 ||
    !finiteInRange(constraints.maxExposureBps, 1, 10_000) ||
    !Number.isInteger(constraints.maxExposureBps) ||
    !finiteInRange(constraints.reserveRequirementUsd, 0, 100_000_000) ||
    !finiteInRange(constraints.maxSlippageBps, 0, 10_000) ||
    !Number.isInteger(constraints.maxSlippageBps) ||
    typeof value.expiry !== "string" ||
    !Number.isFinite(Date.parse(value.expiry)) ||
    !validProvenance(value.provenance)
  ) {
    throw new Error("Shared thesis failed schema validation.");
  }
  return value as unknown as PublicThesisPayload;
}

export function toPublicThesisPayload(thesis: PersistedExecutableThesis): PublicThesisPayload {
  if (thesis.schema !== EXECUTABLE_THESIS_SCHEMA) throw new Error("Unsupported thesis schema.");
  if (thesis.version !== EXECUTABLE_THESIS_VERSION) throw new Error("Unsupported thesis version.");
  return validatePublicThesisPayload({
    schema: EXECUTABLE_THESIS_SCHEMA,
    version: EXECUTABLE_THESIS_VERSION,
    thesisId: thesis.id,
    creator: thesis.creator,
    asset: thesis.asset,
    thesisText: thesis.thesisText,
    rationale: thesis.rationale,
    entryCondition: {
      operator: thesis.entryCondition.operator,
      priceUsd: thesis.entryCondition.priceUsd,
    },
    requestedPositionUsd: thesis.requestedPositionUsd,
    constraints: {
      maxExposureBps: thesis.maxExposureBps,
      reserveRequirementUsd: thesis.reserveRequirementUsd,
      maxSlippageBps: thesis.maxSlippageBps,
    },
    expiry: thesis.expiry,
    provenance:
      thesis.provenance.kind === "ORIGINAL"
        ? { kind: "ORIGINAL" }
        : {
            kind: "FORK",
            parentThesisId: thesis.provenance.parentThesisId,
            rootThesisId: thesis.provenance.rootThesisId,
            forkedAt: thesis.provenance.forkedAt,
            forkedBy: thesis.provenance.forkedBy,
          },
  });
}

/** Field-by-field construction above makes this JSON deterministic without accepting arbitrary keys. */
export function canonicalSerializePublicThesis(payload: PublicThesisPayload): string {
  return JSON.stringify(toPublicThesisPayload(publicPayloadAsPersisted(payload)));
}

function publicPayloadAsPersisted(payload: PublicThesisPayload): PersistedExecutableThesis {
  const valid = validatePublicThesisPayload(payload);
  return {
    schema: valid.schema,
    version: valid.version,
    id: valid.thesisId,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    creator: valid.creator,
    asset: valid.asset,
    thesisText: valid.thesisText,
    rationale: valid.rationale,
    entryCondition: valid.entryCondition,
    requestedPositionUsd: valid.requestedPositionUsd,
    maxExposureBps: valid.constraints.maxExposureBps,
    reserveRequirementUsd: valid.constraints.reserveRequirementUsd,
    maxSlippageBps: valid.constraints.maxSlippageBps,
    expiry: valid.expiry,
    status: "ACTIVE",
    provenance: valid.provenance,
    fingerprint: "",
  };
}

export async function fingerprintPublicThesis(payload: PublicThesisPayload): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSerializePublicThesis(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function base64UrlEncode(value: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(value).toString("base64url");
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Malformed shared thesis link.");
  if (typeof Buffer !== "undefined") return Buffer.from(value, "base64url").toString("utf8");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export function encodeSharePayload(payload: PublicThesisPayload): string {
  const encoded = base64UrlEncode(canonicalSerializePublicThesis(payload));
  if (encoded.length > MAX_SHARE_PAYLOAD_LENGTH) throw new Error("Shared thesis URL is too large.");
  return encoded;
}

export function decodeSharePayload(encoded: string): PublicThesisPayload {
  if (!encoded || encoded.length > MAX_SHARE_PAYLOAD_LENGTH) {
    throw new Error("Shared thesis link is empty or too large.");
  }
  try {
    return validatePublicThesisPayload(JSON.parse(base64UrlDecode(encoded)) as unknown);
  } catch (error) {
    if (error instanceof Error && /Unsupported|Shared thesis/u.test(error.message)) throw error;
    throw new Error("Malformed shared thesis link.");
  }
}

export function createShareUrl(thesis: PersistedExecutableThesis, origin: string): string {
  return `${origin.replace(/\/$/u, "")}/share?thesis=${encodeSharePayload(toPublicThesisPayload(thesis))}`;
}

export async function persistedFromWorkingThesis(
  thesis: ExecutableThesis,
  creator: string,
  existing?: PersistedExecutableThesis,
  now = new Date(),
): Promise<PersistedExecutableThesis> {
  const timestamp = now.toISOString();
  const draft: PersistedExecutableThesis = {
    schema: EXECUTABLE_THESIS_SCHEMA,
    version: EXECUTABLE_THESIS_VERSION,
    id: existing?.id ?? thesis.id,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    creator,
    asset: thesis.intent.asset,
    thesisText: thesis.intent.sourceText,
    rationale: thesis.intent.rationale,
    entryCondition: { operator: "AT_OR_BELOW", priceUsd: thesis.parameters.entryPriceUsd },
    requestedPositionUsd: thesis.parameters.requestedSizeUsd,
    maxExposureBps: Math.round(thesis.parameters.maxExposurePercent * 100),
    reserveRequirementUsd: thesis.parameters.reserveUsd,
    maxSlippageBps: Math.round(thesis.parameters.maxSlippagePercent * 100),
    expiry: thesis.parameters.expiryIso,
    status: Date.parse(thesis.parameters.expiryIso) <= now.getTime() ? "EXPIRED" : "ACTIVE",
    provenance: existing?.provenance ?? { kind: "ORIGINAL" },
    fingerprint: "",
  };
  return { ...draft, fingerprint: await fingerprintPublicThesis(toPublicThesisPayload(draft)) };
}

export function workingThesisFromPublic(
  payload: PublicThesisPayload,
  id = payload.thesisId,
): ExecutableThesis {
  const valid = validatePublicThesisPayload(payload);
  const parameters: DeterministicThesisParameters = {
    entryPriceUsd: valid.entryCondition.priceUsd,
    expiryIso: valid.expiry,
    maxExposurePercent: valid.constraints.maxExposureBps / 100,
    maxSlippagePercent: valid.constraints.maxSlippageBps / 100,
    requestedSizeUsd: valid.requestedPositionUsd,
    reserveUsd: valid.constraints.reserveRequirementUsd,
  };
  return {
    id,
    intent: { asset: valid.asset, rationale: valid.rationale, sourceText: valid.thesisText },
    parameters,
    planRevision: 0,
    status: "INTERPRETED",
  };
}

export function adaptPublicThesis(
  payload: PublicThesisPayload,
  recipientPortfolio: DemoPortfolioSnapshot,
  now = new Date(),
): Readonly<{ thesis: ExecutableThesis; risk: ThesisRiskResult }> {
  const thesis = workingThesisFromPublic(payload);
  return Object.freeze({ thesis, risk: evaluateThesisRisk(thesis, recipientPortfolio, now) });
}

export class LocalExecutableThesisRepository implements ExecutableThesisRepository {
  static readonly storageKey = "vector.executable-theses.v1";
  private readonly storage: KeyValueStorage;
  private readonly idFactory: () => string;

  constructor(storage: KeyValueStorage, idFactory: () => string = () => crypto.randomUUID()) {
    this.storage = storage;
    this.idFactory = idFactory;
  }

  private read(): PersistedExecutableThesis[] {
    const raw = this.storage.getItem(LocalExecutableThesisRepository.storageKey);
    if (!raw) return [];
    try {
      const values = JSON.parse(raw) as unknown;
      if (!Array.isArray(values)) return [];
      return values.filter((value): value is PersistedExecutableThesis => {
        try {
          const record = value as PersistedExecutableThesis;
          this.validatePersisted(record);
          return true;
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  }

  private write(values: readonly PersistedExecutableThesis[]): void {
    this.storage.setItem(LocalExecutableThesisRepository.storageKey, JSON.stringify(values));
  }

  private validatePersisted(thesis: PersistedExecutableThesis): void {
    const allowedKeys = [
      "schema",
      "version",
      "id",
      "createdAt",
      "updatedAt",
      "creator",
      "asset",
      "thesisText",
      "rationale",
      "entryCondition",
      "requestedPositionUsd",
      "maxExposureBps",
      "reserveRequirementUsd",
      "maxSlippageBps",
      "expiry",
      "status",
      "provenance",
      "fingerprint",
    ];
    if (
      Object.keys(thesis).length !== allowedKeys.length ||
      !allowedKeys.every((key) => Object.hasOwn(thesis, key))
    ) {
      throw new Error("Persisted thesis contains unknown or missing fields.");
    }
    if (
      !Number.isFinite(Date.parse(thesis.createdAt)) ||
      !Number.isFinite(Date.parse(thesis.updatedAt))
    ) {
      throw new Error("Persisted thesis timestamps are invalid.");
    }
    if (!["DRAFT", "ACTIVE", "EXPIRED", "EXECUTED", "ARCHIVED"].includes(thesis.status)) {
      throw new Error("Persisted thesis status is invalid.");
    }
    toPublicThesisPayload(thesis);
  }

  save(thesis: PersistedExecutableThesis): void {
    this.validatePersisted(thesis);
    if (this.get(thesis.id)) throw new Error("A thesis with this ID already exists.");
    this.write([...this.read(), thesis]);
  }

  get(id: string): PersistedExecutableThesis | undefined {
    return this.read().find((thesis) => thesis.id === id);
  }

  list(): readonly PersistedExecutableThesis[] {
    return this.read().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  update(id: string, thesis: PersistedExecutableThesis): void {
    const values = this.read();
    if (!values.some((value) => value.id === id) || thesis.id !== id) {
      throw new Error("Saved thesis was not found.");
    }
    this.validatePersisted(thesis);
    this.write(values.map((value) => (value.id === id ? thesis : value)));
  }

  delete(id: string): void {
    this.write(this.read().filter((thesis) => thesis.id !== id));
  }

  async fork(
    thesis: PersistedExecutableThesis,
    forkedBy: string,
    now = new Date(),
  ): Promise<PersistedExecutableThesis> {
    const timestamp = now.toISOString();
    const id = this.idFactory();
    const rootThesisId =
      thesis.provenance.kind === "FORK" ? thesis.provenance.rootThesisId : thesis.id;
    const fork: PersistedExecutableThesis = {
      schema: EXECUTABLE_THESIS_SCHEMA,
      version: EXECUTABLE_THESIS_VERSION,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      creator: forkedBy,
      asset: thesis.asset,
      thesisText: thesis.thesisText,
      rationale: thesis.rationale,
      entryCondition: thesis.entryCondition,
      requestedPositionUsd: thesis.requestedPositionUsd,
      maxExposureBps: thesis.maxExposureBps,
      reserveRequirementUsd: thesis.reserveRequirementUsd,
      maxSlippageBps: thesis.maxSlippageBps,
      expiry: thesis.expiry,
      status: Date.parse(thesis.expiry) <= now.getTime() ? "EXPIRED" : "DRAFT",
      provenance: {
        kind: "FORK",
        parentThesisId: thesis.id,
        rootThesisId,
        forkedAt: timestamp,
        forkedBy,
      },
      fingerprint: "",
    };
    const result = {
      ...fork,
      fingerprint: await fingerprintPublicThesis(toPublicThesisPayload(fork)),
    };
    this.save(result);
    return result;
  }
}

export class LocalThesisExecutionRepository {
  static readonly storageKey = "vector.thesis-executions.v1";
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage) {
    this.storage = storage;
  }

  list(thesisId?: string): readonly ThesisExecutionRecord[] {
    try {
      const parsed = JSON.parse(
        this.storage.getItem(LocalThesisExecutionRepository.storageKey) ?? "[]",
      ) as unknown;
      if (!Array.isArray(parsed)) return [];
      const records = parsed.filter(
        (value): value is ThesisExecutionRecord => isRecord(value) && value.status === "CONFIRMED",
      );
      return thesisId ? records.filter((record) => record.thesisId === thesisId) : records;
    } catch {
      return [];
    }
  }

  saveConfirmed(record: ThesisExecutionRecord): void {
    if (record.status !== "CONFIRMED" || !record.transactionHash || !record.userOperationHash) {
      throw new Error("Only confirmed execution records may be saved.");
    }
    const records = this.list();
    if (records.some((value) => value.executionId === record.executionId)) return;
    this.storage.setItem(
      LocalThesisExecutionRepository.storageKey,
      JSON.stringify([...records, record]),
    );
  }
}

export interface DemoResetResult {
  readonly clearedSavedTheses: boolean;
  readonly preservedExecutionReceipts: true;
}

/** Clears only Vector's local thesis library. Wallet/auth state and receipts are intentionally out of scope. */
export function resetLocalDemoProductState(
  storage: KeyValueStorage,
  clearSavedTheses: boolean,
): DemoResetResult {
  if (clearSavedTheses) storage.removeItem(LocalExecutableThesisRepository.storageKey);
  return Object.freeze({
    clearedSavedTheses: clearSavedTheses,
    preservedExecutionReceipts: true,
  });
}

import { CoreloopError } from "./errors.ts";

/** Exact matching is a defensive check; the caller still owns authorization. */
export type ContextScope = {
  appId: string;
  userId: string;
  partitionId?: string;
};

export type ContextSource = {
  kind: string;
  id: string;
  revision?: string;
  /** When the source was recorded, supplied by the caller. */
  recordedAt?: string;
  /** When its event occurred, if known; never inferred from recordedAt. */
  eventAt?: string;
};

export type ContextItem = {
  id: string;
  scope: ContextScope;
  source: ContextSource;
  provenance: "user-statement" | "record" | "generated-artifact" | "interpretation";
  text: string;
  /** Must fit in full; selected before ordinary items in caller order. */
  pinned?: boolean;
};

export type ContextResult = {
  /** Compact JSON array, or an empty string when no items are selected. */
  text: string;
  items: ContextItem[];
  /** Unique matching-scope IDs excluded by the budget, in selection order. */
  omittedIds: string[];
  /** JavaScript string length (UTF-16 code units), including all JSON syntax. */
  charCount: number;
};

function invalid(message: string): never {
  throw new CoreloopError("invalid-contract", message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`Context ${field} must be a non-empty string.`);
  }
}

function validateScope(value: unknown): asserts value is ContextScope {
  if (!isObject(value)) invalid("Context scope must be an object.");
  requiredString(value.appId, "scope.appId");
  requiredString(value.userId, "scope.userId");
  if (value.partitionId !== undefined) requiredString(value.partitionId, "scope.partitionId");
}

function sameScope(left: ContextScope, right: ContextScope): boolean {
  return left.appId === right.appId && left.userId === right.userId
    && left.partitionId === right.partitionId;
}

function normalizeItem(value: Record<string, unknown>): ContextItem {
  validateScope(value.scope);
  requiredString(value.id, "item.id");
  requiredString(value.text, "item.text");
  if (!isObject(value.source)) invalid("Context source must be an object.");
  requiredString(value.source.kind, "source.kind");
  requiredString(value.source.id, "source.id");
  const source: ContextSource = { kind: value.source.kind, id: value.source.id };
  for (const key of ["revision", "recordedAt", "eventAt"] as const) {
    if (value.source[key] !== undefined) {
      requiredString(value.source[key], `source.${key}`);
      source[key] = value.source[key];
    }
  }
  if (value.provenance !== "user-statement" && value.provenance !== "record"
    && value.provenance !== "generated-artifact" && value.provenance !== "interpretation") {
    invalid("Context provenance is not supported.");
  }
  if (value.pinned !== undefined && typeof value.pinned !== "boolean") {
    invalid("Context pinned must be a boolean.");
  }
  return {
    id: value.id,
    scope: {
      appId: value.scope.appId,
      userId: value.scope.userId,
      ...(value.scope.partitionId !== undefined ? { partitionId: value.scope.partitionId } : {}),
    },
    source,
    provenance: value.provenance,
    text: value.text,
    ...(value.pinned === true ? { pinned: true } : {}),
  };
}

/**
 * Assemble caller-selected sources without IO, retrieval, or model calls.
 *
 * Scope mismatches are discarded before content is inspected and are not
 * reported in omittedIds. Identical IDs/content are deduplicated; conflicting
 * IDs throw, because choosing which revision is current belongs to the app.
 * Selection is stable, pinned first. Oversized ordinary items are skipped in
 * full, allowing later smaller items to fit. All pinned items must fit together.
 *
 * Only source metadata, provenance and text are serialized (no tenant IDs).
 * JSON is a data format, not a prompt-injection defense: applications must
 * instruct the model how to treat sources and verify ownership/deletion before
 * supplying them. No claim, date, relevance or source authority is inferred.
 */
export function buildContext(options: {
  scope: ContextScope;
  items: readonly ContextItem[];
  maxChars: number;
}): ContextResult {
  if (!isObject(options)) invalid("Context options must be an object.");
  const { scope, items, maxChars } = options;
  validateScope(scope);
  if (!Number.isSafeInteger(maxChars) || maxChars < 0) {
    invalid("Context maxChars must be a non-negative safe integer.");
  }
  if (!Array.isArray(items)) invalid("Context items must be an array.");

  const unique = new Map<string, { item: ContextItem; fingerprint: string; json: string }>();
  for (const candidate of items) {
    if (!isObject(candidate)) invalid("Context item must be an object.");
    validateScope(candidate.scope);
    if (!sameScope(scope, candidate.scope)) continue;
    const item = normalizeItem(candidate);
    const json = JSON.stringify({ id: item.id, source: item.source, provenance: item.provenance, text: item.text });
    const fingerprint = JSON.stringify([item.pinned === true, json]);
    const existing = unique.get(item.id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) invalid("Context item IDs must not have conflicting content.");
      continue;
    }
    unique.set(item.id, { item, fingerprint, json });
  }

  const entries = [...unique.values()];
  const ordered = [
    ...entries.filter(({ item }) => item.pinned),
    ...entries.filter(({ item }) => !item.pinned),
  ];
  const selected: ContextItem[] = [];
  const serialized: string[] = [];
  const omittedIds: string[] = [];
  let charCount = 0;
  for (const { item, json } of ordered) {
    const nextSize = charCount + json.length + (selected.length === 0 ? 2 : 1);
    if (nextSize > maxChars) {
      if (item.pinned) invalid("Pinned context items exceed maxChars.");
      omittedIds.push(item.id);
      continue;
    }
    selected.push(item);
    serialized.push(json);
    charCount = nextSize;
  }
  return { text: serialized.length ? `[${serialized.join(",")}]` : "", items: selected, omittedIds, charCount };
}

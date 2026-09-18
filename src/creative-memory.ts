import { z } from "zod";
import type { ContextItem, ContextScope } from "./context.ts";
import { CoreloopError } from "./errors.ts";

// Storage, source ownership, model calls and product prompts belong to callers.
const id = z.string().min(1).max(256).refine(value => value.trim().length > 0);
const text = z.string().min(1).max(4000).refine(value => value.trim().length > 0);
const ids = z.array(id).max(32);
const scopeSchema = z.object({ appId: id, userId: id, partitionId: id.optional() }).strict();
const date = z.string().datetime({ offset: true });

export const memorySourceRefSchema = z.object({
  kind: id,
  id,
  revision: id,
  locator: z.string().min(1).max(512).optional(),
}).strict();
export type MemorySourceRef = z.infer<typeof memorySourceRefSchema>;
const sourceRefs = z.array(memorySourceRefSchema).min(1).max(32);

export type MemoryKind = "event" | "meaning" | "hypothesis" | "desire" | "future_self";
export type MemoryStatus = "active" | "unconfirmed" | "confirmed" | "rejected" | "superseded";
export type MemoryOrigin = "user_statement" | "model_interpretation";
const proposalFields = {
  text,
  sourceRefs,
  relatedMemoryIds: ids,
  supersedesId: id.optional(),
};
const storedFields = { ...proposalFields, id, scope: scopeSchema, recordedAt: date };
const userStatus = z.enum(["active", "confirmed", "rejected", "superseded"]);
const hypothesisStatus = z.enum(["unconfirmed", "confirmed", "rejected", "superseded"]);

/** Even a confirmed future self remains a future self, never a past event. */
export const creativeMemoryRecordSchema = z.discriminatedUnion("kind", [
  z.object({ ...storedFields, kind: z.literal("event"), origin: z.literal("user_statement"), status: userStatus, eventAt: z.string().min(1).max(256).optional() }).strict(),
  z.object({ ...storedFields, kind: z.literal("meaning"), origin: z.literal("user_statement"), status: userStatus }).strict(),
  z.object({ ...storedFields, kind: z.literal("desire"), origin: z.literal("user_statement"), status: userStatus }).strict(),
  z.object({ ...storedFields, kind: z.literal("future_self"), origin: z.literal("user_statement"), status: userStatus }).strict(),
  z.object({ ...storedFields, kind: z.literal("hypothesis"), origin: z.literal("model_interpretation"), status: hypothesisStatus }).strict(),
]);
export type CreativeMemoryRecord = z.infer<typeof creativeMemoryRecordSchema>;

const loopProposalFields = {
  question: text,
  source: z.enum(["conversation", "creative_gap"]),
  relatedMemoryIds: ids,
  sourceRefs,
  priority: z.number().min(0).max(1),
};
export const creativeOpenLoopSchema = z.object({
  ...loopProposalFields,
  id,
  scope: scopeSchema,
  status: z.enum(["open", "deferred", "resolved", "dismissed"]),
  askedAt: date.optional(),
}).strict();
export type CreativeOpenLoop = z.infer<typeof creativeOpenLoopSchema>;
export type OpenLoopStatus = CreativeOpenLoop["status"];

export const interviewDecisionSchema = z.object({
  action: z.enum(["follow_up", "connect_memory", "switch_topic", "reflect", "clarify", "create", "stop"]),
  strategy: z.enum(["concrete_event", "meaning", "why", "contrast", "past_connection", "future", "metaphor"]).nullable(),
  targetMemoryIds: ids,
  question: text.nullable(),
  reason: text,
  memoryUpdateNeeded: z.boolean(),
}).strict();
export type InterviewDecision = z.infer<typeof interviewDecisionSchema>;

export const memoryExtractionSchema = z.object({
  records: z.array(z.discriminatedUnion("kind", [
    z.object({ ...proposalFields, kind: z.literal("event"), origin: z.literal("user_statement") }).strict(),
    z.object({ ...proposalFields, kind: z.literal("meaning"), origin: z.literal("user_statement") }).strict(),
    z.object({ ...proposalFields, kind: z.literal("desire"), origin: z.literal("user_statement") }).strict(),
    z.object({ ...proposalFields, kind: z.literal("future_self"), origin: z.literal("user_statement") }).strict(),
    z.object({ ...proposalFields, kind: z.literal("hypothesis"), origin: z.literal("model_interpretation") }).strict(),
  ])).max(16),
  openLoops: z.array(z.object(loopProposalFields).strict()).max(4),
}).strict();
export type MemoryExtraction = z.infer<typeof memoryExtractionSchema>;
export type MemoryExtractionSource = { ref: MemorySourceRef; provenance: ContextItem["provenance"] };

function invalid(message: string): never {
  throw new CoreloopError("invalid-contract", message);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  // Do not include private source text or identifiers in error messages.
  if (!result.success) invalid("Creative memory does not match its bounded contract.");
  return result.data;
}

function refKey(ref: MemorySourceRef): string {
  return JSON.stringify([ref.kind, ref.id, ref.revision, ref.locator ?? null]);
}

function knownIds(values: readonly string[]): Set<string> {
  return new Set(values.map(value => parse(id, value)));
}

function assertKnown(values: readonly string[], known: Set<string>): void {
  if (values.some(value => !known.has(value))) invalid("Creative memory references an unknown memory ID.");
}

/**
 * Only pass sources and known IDs already checked for ownership and revision.
 * This pure contract cannot establish whether a statement is true or correctly
 * classified: model extraction remains a proposal, never a verified biography.
 */
export function validateMemoryExtraction(input: {
  extraction: unknown;
  sources: readonly MemoryExtractionSource[];
  knownMemoryIds: readonly string[];
}): MemoryExtraction {
  const extraction = parse(memoryExtractionSchema, input.extraction);
  const known = knownIds(input.knownMemoryIds);
  const sources = new Map<string, ContextItem["provenance"]>();
  for (const source of input.sources) {
    const ref = parse(memorySourceRefSchema, source.ref);
    const provenance = parse(z.enum(["user-statement", "record", "generated-artifact", "interpretation"]), source.provenance);
    const key = refKey(ref);
    if (sources.has(key) && sources.get(key) !== provenance) invalid("Conflicting source provenance.");
    sources.set(key, provenance);
  }
  for (const proposal of [...extraction.records, ...extraction.openLoops]) {
    assertKnown(proposal.relatedMemoryIds, known);
    if ("supersedesId" in proposal && proposal.supersedesId) assertKnown([proposal.supersedesId], known);
    for (const ref of proposal.sourceRefs) {
      const provenance = sources.get(refKey(ref));
      if (!provenance) invalid("Creative memory references an unknown source revision or locator.");
      if ("origin" in proposal && proposal.origin === "user_statement" && provenance !== "user-statement") {
        invalid("A personal statement requires exclusively user-statement sources.");
      }
    }
  }
  return extraction;
}

/** Stop/budget never assert that unanswered probes have been completed. */
export function resolveInterviewDecision(input: {
  decision: unknown;
  knownMemoryIds: readonly string[];
  askedCount: number;
  maxQuestions: number;
  userRequestedStop: boolean;
}): InterviewDecision {
  const decision = parse(interviewDecisionSchema, input.decision);
  assertKnown(decision.targetMemoryIds, knownIds(input.knownMemoryIds));
  if (!Number.isSafeInteger(input.askedCount) || input.askedCount < 0
    || !Number.isSafeInteger(input.maxQuestions) || input.maxQuestions < 0
    || typeof input.userRequestedStop !== "boolean") invalid("Invalid interview stop or budget contract.");
  if (input.userRequestedStop || input.askedCount >= input.maxQuestions || decision.action === "stop") {
    return { ...decision, action: "stop", strategy: null, targetMemoryIds: [], question: null };
  }
  return decision;
}

function sameScope(left: ContextScope, right: ContextScope): boolean {
  return left.appId === right.appId && left.userId === right.userId && left.partitionId === right.partitionId;
}

/** Scope is defensive isolation, not authorization. Apply buildContext budgets afterwards. */
export function creativeMemoryContextItems(input: {
  scope: ContextScope;
  records: readonly CreativeMemoryRecord[];
  openLoops: readonly CreativeOpenLoop[];
}): ContextItem[] {
  const scope = parse(scopeSchema, input.scope);
  const items: ContextItem[] = [];
  for (const candidate of input.records) {
    if (!sameScope(scope, parse(scopeSchema, candidate.scope))) continue;
    const record = parse(creativeMemoryRecordSchema, candidate);
    if (record.status === "rejected" || record.status === "superseded") continue;
    items.push({
      id: `memory:${record.id}`,
      scope,
      source: { kind: `memory:${record.kind}`, id: record.id, recordedAt: record.recordedAt, ...("eventAt" in record && record.eventAt ? { eventAt: record.eventAt } : {}) },
      provenance: record.kind === "hypothesis" ? "interpretation" : "user-statement",
      text: JSON.stringify({ kind: record.kind, status: record.status, text: record.text, sourceRefs: record.sourceRefs, relatedMemoryIds: record.relatedMemoryIds }),
    });
  }
  for (const candidate of input.openLoops) {
    if (!sameScope(scope, parse(scopeSchema, candidate.scope))) continue;
    const loop = parse(creativeOpenLoopSchema, candidate);
    if (loop.status !== "open") continue;
    items.push({
      id: `open-loop:${loop.id}`,
      scope,
      source: { kind: "open_loop", id: loop.id },
      provenance: "interpretation",
      text: JSON.stringify({ kind: "open_loop", question: loop.question, source: loop.source, sourceRefs: loop.sourceRefs, relatedMemoryIds: loop.relatedMemoryIds, priority: loop.priority, ...(loop.askedAt ? { askedAt: loop.askedAt } : {}) }),
    });
  }
  return items;
}

/** Terminal loops require a new, explicit user action outside this automatic transition contract. */
export function transitionOpenLoop(input: { current: OpenLoopStatus; next: OpenLoopStatus }): OpenLoopStatus {
  const status = creativeOpenLoopSchema.shape.status;
  const current = parse(status, input.current);
  const next = parse(status, input.next);
  if (current === next) return current;
  if ((current === "open" && next !== "open") || (current === "deferred" && next !== "deferred")) return next;
  return invalid("A resolved or dismissed open loop cannot be automatically reopened or changed.");
}

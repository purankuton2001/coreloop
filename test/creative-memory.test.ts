import assert from "node:assert/strict";
import test from "node:test";
import {
  creativeMemoryContextItems, creativeMemoryRecordSchema, creativeOpenLoopSchema,
  interviewDecisionSchema, memoryExtractionSchema, resolveInterviewDecision,
  transitionOpenLoop, validateMemoryExtraction,
  type CreativeMemoryRecord, type CreativeOpenLoop, type InterviewDecision, type MemoryExtraction,
} from "../src/creative-memory.ts";
import { buildContext } from "../src/context.ts";
import { CoreloopError } from "../src/errors.ts";

const scope = { appId: "app", userId: "user", partitionId: "mode" };
const ref = { kind: "interview", id: "i1", revision: "hash", locator: "turn:1" };
const fields = { text: "自分の作品を出したい", sourceRefs: [ref], relatedMemoryIds: [] };
const proposal = { ...fields, kind: "desire" as const, origin: "user_statement" as const };
const extraction: MemoryExtraction = { records: [proposal], openLoops: [] };
const record: CreativeMemoryRecord = { ...proposal, id: "m1", scope, status: "active", recordedAt: "2026-09-18T00:00:00Z" };
const loop: CreativeOpenLoop = { id: "l1", scope, question: "どんな自分を作品にしたい？", source: "creative_gap", status: "open", relatedMemoryIds: ["m1"], sourceRefs: [ref], priority: 0.7 };
const decision: InterviewDecision = { action: "connect_memory", strategy: "future", question: "その先にどんな自分がいる？", reason: "Explore a stated desire", targetMemoryIds: ["m1"], memoryUpdateNeeded: true };
const validate = (value: unknown, sources = [{ ref, provenance: "user-statement" as const }]) =>
  validateMemoryExtraction({ extraction: value, sources, knownMemoryIds: ["m1"] });
const invalid = (fn: () => unknown) => assert.throws(fn, (error: unknown) => error instanceof CoreloopError && error.reason === "invalid-contract");

test("extraction is bounded and model cannot choose persistence state or ownership", () => {
  assert.deepEqual(validate(extraction), extraction);
  for (const extra of [{ status: "confirmed" }, { id: "forged" }, { scope }, { recordedAt: "today" }]) {
    invalid(() => validate({ ...extraction, records: [{ ...proposal, ...extra }] }));
  }
  assert.equal(memoryExtractionSchema.safeParse({ records: Array(17).fill(proposal), openLoops: [] }).success, false);
  assert.equal(memoryExtractionSchema.safeParse({ records: [{ ...proposal, text: "x".repeat(4001) }], openLoops: [] }).success, false);
  assert.equal(creativeOpenLoopSchema.safeParse({ ...loop, priority: 1.1 }).success, false);
  assert.equal(interviewDecisionSchema.safeParse({ ...decision, targetMemoryIds: Array(33).fill("m1") }).success, false);
});

test("personal statements, interpretations and imagined futures remain distinct", () => {
  assert.equal(creativeMemoryRecordSchema.safeParse({ ...record, kind: "event", origin: "model_interpretation" }).success, false);
  assert.equal(creativeMemoryRecordSchema.safeParse({ ...record, kind: "hypothesis", origin: "model_interpretation" }).success, false);
  assert.equal(creativeMemoryRecordSchema.safeParse({ ...record, kind: "future_self", eventAt: "tomorrow" }).success, false);
  assert.equal(creativeMemoryRecordSchema.safeParse({ ...record, kind: "future_self", status: "confirmed" }).success, true);
  assert.equal(creativeMemoryRecordSchema.safeParse({ ...record, kind: "hypothesis", origin: "model_interpretation", status: "unconfirmed" }).success, true);
  invalid(() => validate({ ...extraction, records: [{ ...proposal, origin: "model_interpretation" }] }));
});

test("source revision and locator are checked, not just source ID", () => {
  for (const override of [{ id: "other" }, { revision: "old" }, { locator: "turn:2" }, { kind: "daily" }, { locator: undefined }]) {
    invalid(() => validate({ ...extraction, records: [{ ...proposal, sourceRefs: [{ ...ref, ...override }] }] }));
  }
  invalid(() => validate({ ...extraction, records: [{ ...proposal, sourceRefs: [] }] }));
  invalid(() => validate(extraction, []));
});

test("generated lyrics cannot become personal history, meaning, desire or future self", () => {
  for (const provenance of ["generated-artifact", "record", "interpretation"] as const) {
    for (const kind of ["event", "meaning", "desire", "future_self"] as const) {
      invalid(() => validateMemoryExtraction({ extraction: { records: [{ ...proposal, kind }], openLoops: [] }, sources: [{ ref, provenance }], knownMemoryIds: [] }));
    }
  }
  const hypothesis = { ...proposal, kind: "hypothesis", origin: "model_interpretation" };
  assert.equal(validateMemoryExtraction({ extraction: { records: [hypothesis], openLoops: [] }, sources: [{ ref, provenance: "generated-artifact" }], knownMemoryIds: [] }).records.length, 1);
  invalid(() => validateMemoryExtraction({ extraction, sources: [{ ref, provenance: "generated-artifact" }, { ref, provenance: "user-statement" }], knownMemoryIds: [] }));
});

test("related and superseded IDs must belong to the caller-verified set", () => {
  for (const override of [{ relatedMemoryIds: ["someone-else"] }, { supersedesId: "someone-else" }]) {
    invalid(() => validate({ records: [{ ...proposal, ...override }], openLoops: [] }));
  }
  const { id: _id, scope: _scope, status: _status, ...loopProposal } = loop;
  assert.equal(validate({ records: [], openLoops: [loopProposal] }).openLoops.length, 1);
  invalid(() => validate({ records: [], openLoops: [{ ...loopProposal, relatedMemoryIds: ["unknown"] }] }));
  invalid(() => validate({ records: [], openLoops: [{ ...loopProposal, status: "open" }] }));
});

test("stop and exhausted budgets remove the question without claiming completed probes", () => {
  for (const override of [{ userRequestedStop: true }, { askedCount: 3 }, { maxQuestions: 0 }, { decision: { ...decision, action: "stop" } }]) {
    const result = resolveInterviewDecision({ decision, knownMemoryIds: ["m1"], askedCount: 1, maxQuestions: 3, userRequestedStop: false, ...override });
    assert.equal(result.action, "stop");
    assert.equal(result.question, null);
    assert.equal(result.strategy, null);
    assert.deepEqual(result.targetMemoryIds, []);
    assert.equal("filled" in result, false);
    assert.equal("complete" in result, false);
  }
  invalid(() => resolveInterviewDecision({ decision, knownMemoryIds: [], askedCount: 1, maxQuestions: 3, userRequestedStop: true }));
  invalid(() => resolveInterviewDecision({ decision, knownMemoryIds: ["m1"], askedCount: -1, maxQuestions: 3, userRequestedStop: false }));
  assert.deepEqual(resolveInterviewDecision({ decision, knownMemoryIds: ["m1"], askedCount: 1, maxQuestions: 3, userRequestedStop: false }), decision);
});

test("context isolates app, user and partition, and omits rejected and terminal items", () => {
  const records: CreativeMemoryRecord[] = [record,
    ...[{ appId: "other" }, { userId: "other" }, { partitionId: "other" }, { partitionId: undefined }].map(diff => ({ ...record, scope: { ...scope, ...diff } })),
    { ...record, id: "rejected", status: "rejected" }, { ...record, id: "old", status: "superseded" },
  ];
  const openLoops: CreativeOpenLoop[] = [loop, ...(["deferred", "resolved", "dismissed"] as const).map(status => ({ ...loop, id: status, status })), { ...loop, id: "other", scope: { ...scope, userId: "other" } }];
  assert.deepEqual(creativeMemoryContextItems({ scope, records, openLoops }).map(item => item.id), ["memory:m1", "open-loop:l1"]);
});

test("context preserves kind and provenance; buildContext remains responsible for budgets", () => {
  const hypothesis: CreativeMemoryRecord = { ...record, id: "h1", kind: "hypothesis", origin: "model_interpretation", status: "unconfirmed" };
  const items = creativeMemoryContextItems({ scope, records: [record, hypothesis, { ...record, id: "f1", kind: "future_self" }], openLoops: [loop] });
  assert.deepEqual(items.map(item => item.provenance), ["user-statement", "interpretation", "user-statement", "interpretation"]);
  assert.equal(JSON.parse(items[2]!.text).kind, "future_self");
  assert.equal(JSON.parse(items[1]!.text).status, "unconfirmed");
  assert.deepEqual(JSON.parse(items[0]!.text).sourceRefs, [ref]);
  assert.equal(buildContext({ scope, items, maxChars: 0 }).items.length, 0);
  assert.equal(buildContext({ scope, items, maxChars: 12000 }).items.length, 4);
});

test("open loops cannot automatically reopen after resolution or dismissal", () => {
  for (const status of ["open", "deferred", "resolved", "dismissed"] as const) {
    assert.equal(transitionOpenLoop({ current: status, next: status }), status);
  }
  for (const next of ["deferred", "resolved", "dismissed"] as const) assert.equal(transitionOpenLoop({ current: "open", next }), next);
  for (const next of ["open", "resolved", "dismissed"] as const) assert.equal(transitionOpenLoop({ current: "deferred", next }), next);
  for (const current of ["resolved", "dismissed"] as const) {
    invalid(() => transitionOpenLoop({ current, next: "open" }));
    invalid(() => transitionOpenLoop({ current, next: "deferred" }));
  }
});

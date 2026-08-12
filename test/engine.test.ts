import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

import {
  buildCandidatesPrompt,
  candidatesSchema,
  clampScore,
  createRegistry,
  CoreloopError,
  fillTemplate,
  formatAxisList,
  formatQA,
  formatTranscript,
  isRetryableError,
  normalizeAxisScores,
  pickText,
  sanitizeDeep,
  sanitizeText,
  toClientFlow,
  toClientMode,
  createModeRegistry,
  axisScoresSchema,
  visibleTurns,
  type AxisDef,
  type Flow,
  type Mode,
} from "../src/index.ts";

// ---------- text ----------

test("fillTemplate leaves unknown placeholders intact", () => {
  assert.equal(fillTemplate("a {{x}} b {{y}}", { x: "1" }), "a 1 b {{y}}");
});

test("pickText falls back to ja for unknown locales", () => {
  const t = { ja: "核", en: "core" };
  assert.equal(pickText(t, "en-US"), "core");
  assert.equal(pickText(t, "fr"), "核");
  assert.equal(pickText(t, undefined), "核");
});

// ---------- sanitize ----------

test("sanitizeText strips leaked thinking delimiters and fences", () => {
  assert.equal(sanitizeText("答え```_of_thought_end_```"), "答え");
  assert.equal(sanitizeText("```json\n{}"), "{}");
});

test("sanitizeDeep walks arrays and nested objects", () => {
  const out = sanitizeDeep({ a: ["x```", { b: "y ```_thought_end_```" }], n: 3 });
  assert.deepEqual(out, { a: ["x", { b: "y" }], n: 3 });
});

// ---------- transcript ----------

const turns = [
  { role: "assistant" as const, text: "質問です" },
  { role: "user" as const, text: "回答です" },
  { role: "user" as const, text: "途中", isFinal: false },
  { role: "system" as const, text: "instruction" },
  { role: "user" as const, text: "   " },
];

test("visibleTurns drops non-final, system and blank turns", () => {
  assert.equal(visibleTurns(turns).length, 2);
  assert.equal(visibleTurns(turns, { includeSystem: true }).length, 3);
  assert.deepEqual(visibleTurns(null), []);
});

test("formatTranscript labels and numbers turns", () => {
  assert.equal(
    formatTranscript(turns, { labels: { assistant: "面接官", user: "応募者" } }),
    "[面接官] 質問です\n[応募者] 回答です",
  );
  assert.equal(
    formatTranscript(turns, { numbered: true }),
    "[#0][assistant] 質問です\n[#1][user] 回答です",
  );
});

test("formatQA marks skipped answers", () => {
  const questions = [
    { id: "q1", text: { ja: "問1", en: "Q1" } },
    { id: "q2", text: { ja: "問2", en: "Q2" } },
  ];
  assert.equal(formatQA(questions, { q1: " 答え " }, "ja"), "Q: 問1\nA: 答え\n\nQ: 問2\nA: (skipped)");
});

// ---------- errors ----------

test("only api errors are retryable", () => {
  assert.equal(isRetryableError(new CoreloopError("api-error", "boom")), true);
  assert.equal(isRetryableError(new CoreloopError("not-configured", "no key")), false);
  assert.equal(isRetryableError(new Error("plain")), false);
});

// ---------- registry ----------

type Item = { id: string; flows: { id: string }[] };
const items: Item[] = [
  { id: "a", flows: [{ id: "f1" }, { id: "f2" }] },
  { id: "b", flows: [{ id: "f3" }] },
];

test("registry resolves by id, child id, and default", () => {
  const registry = createModeRegistry(items, { defaultId: "a" });
  assert.equal(registry.require("b").id, "b");
  assert.equal(registry.byChildId("f3")?.id, "b");
  assert.equal(registry.byChildId("nope"), undefined);
  assert.equal(registry.get("unknown")?.id, "a", "unknown ids fall back to the default");
  assert.equal(registry.has("unknown"), false);
  assert.equal(registry.all().length, 2);
});

test("registry rejects duplicate ids and unknown defaults", () => {
  assert.throws(() => createRegistry([{ id: "x" }, { id: "x" }]), /duplicate registry id/);
  assert.throws(() => createRegistry([{ id: "x" }], { defaultId: "y" }), /not registered/);
  assert.throws(
    () => createModeRegistry([{ id: "a", flows: [{ id: "dup" }] }, { id: "b", flows: [{ id: "dup" }] }]),
    /claimed by both/,
  );
});

test("registry.require throws for an unknown id with no default", () => {
  const registry = createRegistry([{ id: "x" }]);
  assert.throws(() => registry.require("y"), /unknown id/);
});

// ---------- client boundary ----------

const flow: Flow = {
  id: "f1",
  name: { ja: "名", en: "name" },
  tagline: { ja: "説明", en: "tagline" },
  questions: [{ id: "q1", text: { ja: "問", en: "q" } }],
  extractionPrompt: "SECRET INSTRUCTION",
};

const mode: Mode<{ textJa: string }> = {
  id: "m1",
  vocabulary: { coreNoun: { ja: "核", en: "core" }, digVerb: { ja: "掘る", en: "dig" } },
  locales: ["ja", "en"],
  flows: [flow],
  profileSchema: z.object({ textJa: z.string() }),
  buildProfilePrompt: () => "SECRET PROFILE PROMPT",
  toStoredProfile: (p) => ({ ...p }),
  toCoreColumns: (p) => ({ textJa: p.textJa, textEn: "", title: null, titleEn: null }),
  artifactTypes: ["song"],
  release: { enabled: true },
};

test("client views never carry prompts or schemas", () => {
  const serialized = JSON.stringify(toClientMode(mode));
  assert.ok(!serialized.includes("SECRET"), "no server-only text may reach the client view");
  assert.equal("extractionPrompt" in toClientFlow(flow), false);
  assert.equal(toClientFlow(flow).questions.length, 1);
  assert.equal(JSON.parse(serialized).flows[0].id, "f1");
});

// ---------- candidates ----------

test("candidatesSchema pins the candidate count", () => {
  const schema = candidatesSchema(3);
  const two = { candidates: [{ text: "a", angle: "x" }, { text: "b", angle: "y" }] };
  assert.equal(schema.safeParse(two).success, false);
  assert.equal(schema.safeParse({ candidates: [...two.candidates, { text: "c", angle: "z" }] }).success, true);
});

test("buildCandidatesPrompt fills placeholders and appends the refine round", () => {
  const base = buildCandidatesPrompt({
    instructions: "Rules in {{language}}.\n\n{{answers}}",
    transcript: "Q: 問\nA: 答",
    language: "Japanese",
  });
  assert.equal(base, "Rules in Japanese.\n\nQ: 問\nA: 答");

  const refined = buildCandidatesPrompt({
    instructions: "{{answers}}",
    transcript: "T",
    language: "Japanese",
    refine: { feedback: "もっと具体的に", previousCandidates: [{ text: "前案", angle: "角度" }] },
  });
  assert.ok(refined.startsWith("T"));
  assert.ok(refined.includes("1. [角度] 前案"));
  assert.ok(refined.includes("もっと具体的に"));
});

test("empty feedback does not start a refine round", () => {
  const prompt = buildCandidatesPrompt({
    instructions: "{{answers}}",
    transcript: "T",
    language: "Japanese",
    refine: { feedback: "   ", previousCandidates: [{ text: "前案", angle: "角度" }] },
  });
  assert.equal(prompt, "T");
});

// ---------- scoring ----------

const axes: AxisDef[] = [
  { key: "logic", label: "論理構成力", description: "主張→根拠→結論" },
  { key: "articulation", label: "言語化力" },
  { key: "self_awareness", label: "自己認識力" },
];

test("axisScoresSchema accepts a partial set of axes but rejects unknown keys", () => {
  const schema = axisScoresSchema(axes);
  assert.equal(schema.safeParse({ scores: [{ axisKey: "logic", score: 4 }] }).success, true);
  assert.equal(schema.safeParse({ scores: [{ axisKey: "ghost", score: 4 }] }).success, false);
  assert.equal(schema.safeParse({ scores: [{ axisKey: "logic", score: 9 }] }).success, false);
  assert.equal(schema.safeParse({ scores: [] }).success, false);
});

test("axisScoresSchema refuses an empty axis list", () => {
  assert.throws(() => axisScoresSchema([]), CoreloopError);
});

test("normalizeAxisScores drops unscored axes instead of defaulting them", () => {
  const scores = normalizeAxisScores(axes, [
    { axisKey: "self_awareness", score: 3 },
    { axisKey: "logic", score: 7 },
    { axisKey: "ghost", score: 5 },
    { axisKey: "articulation", score: "4" },
  ]);
  assert.deepEqual(
    scores.map((s) => s.axisKey),
    ["logic", "self_awareness"],
    "axis order is preserved and unscored axes are absent",
  );
  assert.equal(scores[0]?.score, 5, "out-of-range scores are clamped, not rejected");
  assert.equal(scores[0]?.label, "論理構成力");
});

test("normalizeAxisScores survives garbage input", () => {
  assert.deepEqual(normalizeAxisScores(axes, null), []);
  assert.deepEqual(normalizeAxisScores(axes, [null, 3, {}]), []);
});

test("clampScore rounds into range", () => {
  assert.equal(clampScore(0), 1);
  assert.equal(clampScore(4.6), 5);
  assert.equal(clampScore(3.2, 10), 3);
});

test("formatAxisList renders keys and descriptions", () => {
  assert.equal(
    formatAxisList(axes),
    "1. 論理構成力 (key: logic) — 主張→根拠→結論\n2. 言語化力 (key: articulation)\n3. 自己認識力 (key: self_awareness)",
  );
});

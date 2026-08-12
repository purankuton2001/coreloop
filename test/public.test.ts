import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createHandlePolicy,
  defineVisibilityPolicy,
  locateQuote,
  pickImprovedAxis,
  resolveTurnIndex,
  scoreRatio,
  type AxisScore,
} from "../src/index.ts";

// ---------- handle ----------

const handles = createHandlePolicy({ reserved: ["me", "setup", "Official"] });

test("handle policy normalizes without rewriting inner characters", () => {
  assert.equal(handles.normalize("  KoiTo "), "koito");
  assert.equal(handles.check("Koi To").violation, "invalid-characters");
});

test("reserved names are reported as reserved even when too short", () => {
  assert.equal(handles.validate("me"), "reserved");
  assert.equal(handles.validate("official"), "reserved", "reserved list is case-insensitive");
  assert.equal(handles.validate("ab"), "too-short");
  assert.equal(handles.validate("a".repeat(31)), "too-long");
  assert.equal(handles.validate("-koito"), "invalid-characters");
  assert.equal(handles.validate("koito_2001"), null);
});

test("handle limits are configurable", () => {
  const strict = createHandlePolicy({ minLength: 5, maxLength: 8 });
  assert.equal(strict.validate("abcd"), "too-short");
  assert.equal(strict.validate("abcdefghi"), "too-long");
  assert.equal(strict.validate("abcde"), null);
});

// ---------- visibility ----------

const visibility = defineVisibilityPolicy({
  displayName: { always: true },
  strengths: { defaultVisible: true },
  goals: { defaultVisible: true },
  scores: {}, // private until asked for
});

test("fields are private by default unless declared otherwise", () => {
  assert.deepEqual(visibility.defaults(), {
    displayName: true,
    strengths: true,
    goals: true,
    scores: false,
  });
});

test("always-visible fields ignore stored settings", () => {
  const resolved = visibility.resolve({ displayName: false, strengths: false });
  assert.equal(resolved.displayName, true);
  assert.equal(resolved.strengths, false);
});

test("apply drops hidden fields and fields the policy does not know", () => {
  const published = visibility.apply(
    { displayName: "こいと", strengths: ["粘り"], goals: ["春までに"], scores: [4, 5], email: "x@y.z" },
    { scores: false },
  );
  assert.deepEqual(Object.keys(published).sort(), ["displayName", "goals", "strengths"]);
  assert.equal("email" in published, false, "unknown fields are never published");
});

test("apply publishes an opted-in field", () => {
  const published = visibility.apply({ scores: [4] }, { scores: true });
  assert.deepEqual(published, { scores: [4] });
});

// ---------- quotes ----------

const turns = [
  { role: "assistant" as const, text: "学生時代に力を入れたことは？" },
  { role: "user" as const, text: "学園祭の会計を任されて、\n赤字を半年で埋めました" },
  { role: "system" as const, text: "instruction" },
];

test("locateQuote finds an exact quote in the visible turns", () => {
  const found = locateQuote(turns, "赤字を半年で埋めました");
  assert.equal(found?.turnIndex, 1, "system turns are not counted in the index");
  assert.equal(found?.exact, true);
  assert.equal(turns[1]?.text.slice(found?.start, found?.end), "赤字を半年で埋めました");
});

test("locateQuote falls back to a whitespace-insensitive match", () => {
  const found = locateQuote(turns, "学園祭の会計を任されて、 赤字を半年で埋めました");
  assert.equal(found?.turnIndex, 1);
  assert.equal(found?.exact, false, "reflowed matches are marked inexact");
});

test("locateQuote returns null for a paraphrase", () => {
  assert.equal(locateQuote(turns, "サークルの代表をしていました"), null);
  assert.equal(locateQuote(turns, "   "), null);
  assert.equal(locateQuote(null, "x"), null);
});

test("resolveTurnIndex rejects out-of-range and non-integer indexes", () => {
  assert.equal(resolveTurnIndex(turns, 1), 1);
  assert.equal(resolveTurnIndex(turns, 2), null, "system turn is not visible");
  assert.equal(resolveTurnIndex(turns, -1), null);
  assert.equal(resolveTurnIndex(turns, 1.5), null);
  assert.equal(resolveTurnIndex(turns, null), null);
});

// ---------- improvement ----------

const score = (axisKey: string, label: string, value: number): AxisScore => ({
  axisKey,
  label,
  score: value,
  maxScore: 5,
});

test("pickImprovedAxis returns the biggest gain", () => {
  const best = pickImprovedAxis(
    [score("logic", "論理構成力", 4), score("articulation", "言語化力", 5)],
    [
      { axisKey: "logic", score: 3 },
      { axisKey: "articulation", score: 3 },
    ],
  );
  assert.equal(best?.axisKey, "articulation");
  assert.equal(best?.delta, 2);
  assert.equal(best?.from, 3);
});

test("ties go to the higher current score", () => {
  const best = pickImprovedAxis(
    [score("logic", "論理構成力", 3), score("articulation", "言語化力", 4)],
    [
      { axisKey: "logic", score: 2 },
      { axisKey: "articulation", score: 3 },
    ],
  );
  assert.equal(best?.axisKey, "articulation");
});

test("no improvement, no first run, and unmatched axes yield null", () => {
  const flat = [score("logic", "論理構成力", 3)];
  assert.equal(pickImprovedAxis(flat, [{ axisKey: "logic", score: 3 }]), null);
  assert.equal(pickImprovedAxis(flat, [{ axisKey: "logic", score: 4 }]), null);
  assert.equal(pickImprovedAxis(flat, null), null, "a first session has nothing to compare");
  assert.equal(
    pickImprovedAxis(flat, [{ axisKey: "case_structure", score: 1 }]),
    null,
    "axes from another mode are not comparable",
  );
});

test("scoreRatio clamps to 0..1", () => {
  assert.equal(scoreRatio(4), 0.8);
  assert.equal(scoreRatio(9), 1);
  assert.equal(scoreRatio(-1), 0);
  assert.equal(scoreRatio(50, 100), 0.5);
});

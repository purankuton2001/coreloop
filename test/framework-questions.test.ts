import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CIRCLE_QUESTIONS,
  JOHARI_QUESTIONS,
  LIFE_CHART_QUESTIONS,
  NINE_BOX_QUESTIONS,
  PERSPECTIVE_QUESTIONS,
  PERSPECTIVE_VIEWPOINTS,
  pickTurningPoints,
  questionList,
  renderQuestion,
  type QuestionTemplate,
} from "../src/frameworks.ts";
import { pickText } from "../src/index.ts";

const SETS: Record<string, Record<string, QuestionTemplate>> = {
  LIFE_CHART_QUESTIONS,
  NINE_BOX_QUESTIONS,
  JOHARI_QUESTIONS,
  CIRCLE_QUESTIONS,
  PERSPECTIVE_QUESTIONS,
};

test("every question exists in both languages, and neither is a stub", () => {
  for (const [setName, set] of Object.entries(SETS)) {
    for (const [key, template] of Object.entries(set)) {
      assert.equal(template.id, key, `${setName}.${key} carries the key it is filed under`);
      for (const locale of ["ja", "en"] as const) {
        assert.ok(template.text[locale]?.trim(), `${setName}.${key}.text.${locale}`);
        if (template.hint) assert.ok(template.hint[locale]?.trim(), `${setName}.${key}.hint.${locale}`);
      }
    }
  }
});

test("a template's declared placeholders are the ones it actually contains", () => {
  for (const [setName, set] of Object.entries(SETS)) {
    for (const template of Object.values(set)) {
      for (const locale of ["ja", "en"] as const) {
        const found = [...template.text[locale].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
        assert.deepEqual(
          [...new Set(found)].sort(),
          [...(template.vars ?? [])].sort(),
          `${setName}.${template.id} (${locale})`,
        );
      }
    }
  }
});

test("both languages of a template take the same placeholders", () => {
  for (const set of Object.values(SETS)) {
    for (const template of Object.values(set)) {
      const names = (locale: "ja" | "en") =>
        [...new Set([...template.text[locale].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))].sort();
      assert.deepEqual(names("ja"), names("en"), template.id);
    }
  }
});

test("rendering fills the placeholders and picks the language", () => {
  const asked = renderQuestion(LIFE_CHART_QUESTIONS.turningPoint, "ja", { at: "12歳" });
  assert.ok(asked.text.includes("12歳"));
  assert.ok(!asked.text.includes("{{"));
  assert.equal(asked.id, "turningPoint");

  assert.ok(renderQuestion(LIFE_CHART_QUESTIONS.turningPoint, "en-US", { at: "12" }).text.startsWith("The line"));
});

test("an unfilled placeholder is left standing rather than blanked", () => {
  // A question that lost its context should be visible, not quietly arrive at a
  // person as "The line moves a long way at ."
  assert.ok(renderQuestion(LIFE_CHART_QUESTIONS.turningPoint, "en").text.includes("{{at}}"));
});

test("a hint comes through only when the template has one", () => {
  assert.ok(renderQuestion(LIFE_CHART_QUESTIONS.trough, "ja").hint);
  assert.equal(renderQuestion(LIFE_CHART_QUESTIONS.event, "ja", { at: "12" }).hint, undefined);
});

test("a set lists in written order", () => {
  assert.deepEqual(
    questionList(LIFE_CHART_QUESTIONS).map((q) => q.id),
    ["draw", "event", "turningPoint", "trough", "recovery", "flat"],
  );
});

test("the viewpoints of the eulogy exercise are relationships, in both languages", () => {
  assert.ok(PERSPECTIVE_VIEWPOINTS.length >= 4);
  for (const viewpoint of PERSPECTIVE_VIEWPOINTS) {
    assert.ok(viewpoint.who.ja.trim() && viewpoint.who.en.trim(), viewpoint.id);
  }
  const asked = renderQuestion(PERSPECTIVE_QUESTIONS.statement, "ja", {
    who: pickText(PERSPECTIVE_VIEWPOINTS[0]!.who, "ja"),
  });
  assert.equal(asked.text, "家族には、あなたのことを何と言われたいですか。");
});

test("a signal from the mechanics drops straight into its question", () => {
  const [turning] = pickTurningPoints([
    { id: "a", at: 6, score: 2 },
    { id: "b", at: 12, score: -4 },
    { id: "c", at: 18, score: 0 },
  ]);
  assert.equal(turning?.kind, "trough");
  const asked = renderQuestion(LIFE_CHART_QUESTIONS.turningPoint, "ja", { at: String(turning!.point.at) });
  assert.equal(asked.text, "12で線が大きく動いています。何が起きて、そのときあなたは何を考えていましたか。");
});

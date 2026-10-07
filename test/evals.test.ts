import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInterviewEvalPrompt,
  normalizeInterviewEvaluation,
  type InterviewEvalCriterion,
  type TranscriptTurn,
} from "../src/index.ts";

const transcript: TranscriptTurn[] = [
  { role: "assistant", text: "それを他の人にも広げたい？" },
  { role: "user", text: "いや、そこまでは思ってない。自分が自由ならいい。" },
  { role: "assistant", text: "何が一番自由を感じる？" },
  { role: "user", text: "面白いと思ったらすぐ作り始められること。" },
];

const criteria: InterviewEvalCriterion[] = [
  {
    id: "fidelity",
    description: "The interviewer does not turn its own hypothesis into the person's belief.",
    weight: 2,
    failureBelow: 0.7,
  },
  {
    id: "depth",
    description: "The interviewer finds a more specific formulation grounded in the person's words.",
    weight: 1,
  },
  {
    id: "expansion",
    description: "When a grounded opening exists, the interviewer tests it without requiring adoption.",
    weight: 1,
    failureBelow: 0.5,
  },
];

test("evaluation drops unknown criteria and hallucinated evidence", () => {
  const report = normalizeInterviewEvaluation({
    raw: {
      scores: [
        {
          criterionId: "fidelity",
          score: 0.9,
          rationale: "The rejection was respected.",
          evidence: [{ source: "transcript", turnIndex: 1, quote: "そこまでは思ってない" }],
        },
        {
          criterionId: "depth",
          score: 0.8,
          rationale: "Invented quote should invalidate this score.",
          evidence: [{ source: "transcript", turnIndex: 3, quote: "世界を変えたい" }],
        },
        {
          criterionId: "ghost",
          score: 1,
          rationale: "Unknown criterion.",
          evidence: [{ source: "transcript", turnIndex: 3, quote: "すぐ作り始められる" }],
        },
      ],
    },
    criteria,
    transcript,
  });

  assert.deepEqual(report.scores.map((score) => score.criterionId), ["fidelity"]);
  assert.equal(report.overallScore, 0.9);
  assert.deepEqual(report.failureTags, []);
});

test("artifact evidence is allowed only against the named caller artifact", () => {
  const report = normalizeInterviewEvaluation({
    raw: {
      scores: [
        {
          criterionId: "depth",
          score: 0.8,
          rationale: "Candidate preserves a specific phrase.",
          evidence: [{ source: "core", turnIndex: null, quote: "すぐ作り始められる" }],
        },
        {
          criterionId: "expansion",
          score: 0.2,
          rationale: "Wrong artifact name must not validate.",
          evidence: [{ source: "other", turnIndex: null, quote: "すぐ作り始められる" }],
        },
      ],
    },
    criteria,
    transcript,
    artifacts: [{ id: "core", text: "面白いと思ったら、すぐ作り始められる自由がほしい。" }],
  });

  assert.deepEqual(report.scores.map((score) => score.criterionId), ["depth"]);
  assert.equal(report.overallScore, 0.8);
});

test("overall score is weighted over scored criteria only and failure tags use valid scores", () => {
  const report = normalizeInterviewEvaluation({
    raw: {
      scores: [
        {
          criterionId: "fidelity",
          score: 0.6,
          rationale: "The interviewer introduced a direction before it was adopted.",
          evidence: [{ source: "transcript", turnIndex: 0, quote: "他の人にも広げたい" }],
        },
        {
          criterionId: "depth",
          score: 0.9,
          rationale: "The later question produced a concrete definition.",
          evidence: [{ source: "transcript", turnIndex: 3, quote: "すぐ作り始められること" }],
        },
      ],
    },
    criteria,
    transcript,
  });

  assert.ok(report.overallScore != null);
  assert.equal(Number(report.overallScore?.toFixed(4)), 0.7);
  assert.deepEqual(report.failureTags, ["fidelity"]);
  assert.equal(report.scores.some((score) => score.criterionId === "expansion"), false);
});

test("eval prompt explicitly avoids rewarding grand conclusions by default", () => {
  const prompt = buildInterviewEvalPrompt({
    criteria,
    transcript,
    artifacts: [{ id: "core", text: "自由に作りたい。" }],
    instructions: "Prefer evidence over polish.",
  });

  assert.match(prompt, /Do not reward bigger, more social, more altruistic/);
  assert.match(prompt, /Distinguish an idea introduced by the interviewer/);
  assert.match(prompt, /Prefer evidence over polish/);
  assert.match(prompt, /artifact:core/);
});

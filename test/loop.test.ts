import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNextQuestionPrompt,
  createEventRecorder,
  pendingProbes,
  pickShareMoment,
  summarizeFunnel,
  type CoreloopEvent,
  type Probe,
} from "../src/index.ts";

// ---------- interview ----------

const probes: Probe[] = [
  { id: "origin", goal: "the moment they first refused to quit" },
  { id: "retort", goal: "what they never said back" },
  { id: "today", goal: "how it shows up now", required: false },
];

const turns = [
  { role: "assistant" as const, text: "嗤われてもやめなかったことは？" },
  { role: "user" as const, text: "中学のとき、ずっと曲を作っていました" },
];

test("the prompt carries the probes, the transcript and the remaining budget", () => {
  const prompt = buildNextQuestionPrompt({
    instructions: "Keep the tone sharp but warm.",
    probes,
    transcript: turns,
    language: "Japanese",
    maxQuestions: 5,
  });
  assert.ok(prompt.includes("origin: the moment they first refused to quit"));
  assert.ok(prompt.includes("today (optional)"), "optional probes are marked as such");
  assert.ok(prompt.includes("中学のとき"));
  assert.ok(prompt.includes("Keep the tone sharp but warm."));
  assert.ok(prompt.includes("Questions remaining: 4"), "one assistant turn already counted");
  assert.ok(prompt.includes("Ask in Japanese"));
});

test("an instruction that places the transcript itself is not duplicated", () => {
  const prompt = buildNextQuestionPrompt({
    instructions: "Probes:\n{{probes}}\n\nSo far:\n{{transcript}}",
    probes,
    transcript: turns,
    language: "Japanese",
  });
  assert.equal(prompt.split("中学のとき").length - 1, 1, "transcript appears exactly once");
  assert.ok(!prompt.includes("Conversation so far:"), "the default block is skipped");
});

test("an empty transcript is stated, not left blank", () => {
  const prompt = buildNextQuestionPrompt({
    instructions: "x",
    probes,
    transcript: [],
    language: "English",
  });
  assert.ok(prompt.includes("(nothing said yet)"));
  assert.ok(prompt.includes("Questions remaining: unlimited"));
});

test("pendingProbes ignores optional probes", () => {
  assert.deepEqual(
    pendingProbes(probes, ["origin"]).map((p) => p.id),
    ["retort"],
  );
  assert.deepEqual(pendingProbes(probes, ["origin", "retort"]), []);
});

// ---------- share moments ----------

const improvement = {
  axisKey: "articulation",
  label: "言語化力",
  from: 3,
  to: 5,
  delta: 2,
  maxScore: 5,
};

test("the first result outranks a jump, which outranks a milestone", () => {
  const first = pickShareMoment({ isFirstResult: true, improvement, milestone: "10回目" });
  assert.equal(first?.kind, "first-result");

  const jump = pickShareMoment({ improvement, milestone: "10回目" });
  assert.equal(jump?.kind, "improved");
  assert.equal(jump?.reason, "言語化力: 3 → 5");

  const milestone = pickShareMoment({ improvement: null, milestone: "10回目" });
  assert.equal(milestone?.kind, "milestone");
});

test("a moment already offered is not offered again", () => {
  const moment = pickShareMoment({
    isFirstResult: true,
    improvement,
    alreadyOffered: ["first-result"],
  });
  assert.equal(moment?.kind, "improved");
  assert.equal(
    pickShareMoment({ isFirstResult: true, alreadyOffered: ["first-result"] }),
    null,
  );
});

test("no moment means no prompt", () => {
  assert.equal(pickShareMoment({}), null);
  assert.equal(pickShareMoment({ improvement: null, milestone: null }), null);
});

// ---------- events ----------

test("the recorder stamps events with an injectable clock", () => {
  let tick = 0;
  const recorder = createEventRecorder({ now: () => ++tick });
  recorder.emit({ type: "question.asked", probeId: "origin", index: 0 });
  recorder.emit({ type: "interview.ended", questionsAsked: 1, probesFilled: 1, probesPending: 1 });
  assert.deepEqual(
    recorder.events().map((e) => e.at),
    [1, 2],
  );
  recorder.clear();
  assert.deepEqual(recorder.events(), []);
});

test("the funnel summary answers what a question set is judged by", () => {
  const events: CoreloopEvent[] = [
    { type: "question.asked", probeId: "origin", index: 0 },
    { type: "answer.received", probeId: "origin", index: 0, length: 40, skipped: false },
    { type: "question.asked", probeId: "retort", index: 1 },
    { type: "answer.received", probeId: "retort", index: 1, length: 0, skipped: true },
    { type: "question.asked", probeId: "origin", index: 2 },
    { type: "answer.received", probeId: "origin", index: 2, length: 20, skipped: false },
    { type: "interview.ended", questionsAsked: 3, probesFilled: 1, probesPending: 1 },
    { type: "candidates.generated", round: 1, count: 3 },
    { type: "candidates.rejected", round: 1, feedbackLength: 22 },
    { type: "candidates.generated", round: 2, count: 3 },
    { type: "result.confirmed", rounds: 2 },
    { type: "scores.generated", scored: 5, unscored: ["industry_insight"] },
    { type: "share.offered", kind: "improved" },
    { type: "share.accepted", kind: "improved" },
    { type: "share.offered", kind: "milestone" },
    { type: "generation.failed", stage: "verbalize", reason: "api-error" },
  ];

  const summary = summarizeFunnel(events);
  assert.equal(summary.interviews, 1);
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.meanRefineRounds, 2);
  assert.deepEqual(summary.shares, {
    improved: { offered: 1, accepted: 1 },
    milestone: { offered: 1, accepted: 0 },
  });
  assert.deepEqual(summary.unscoredAxes, { industry_insight: 1 });
  assert.deepEqual(summary.failures, { "api-error": 1 });

  const origin = summary.probes.find((p) => p.probeId === "origin");
  assert.equal(origin?.asked, 2);
  assert.equal(origin?.answered, 2);
  assert.equal(origin?.meanAnswerLength, 30);

  const retort = summary.probes.find((p) => p.probeId === "retort");
  assert.equal(retort?.skipped, 1, "a skipped question is the signal the question is wrong");
  assert.equal(retort?.meanAnswerLength, 0);
});

test("an empty event list summarizes to zeroes, not NaN", () => {
  const summary = summarizeFunnel([]);
  assert.equal(summary.meanRefineRounds, 0);
  assert.deepEqual(summary.probes, []);
});

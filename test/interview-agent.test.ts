import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInterviewAnalysisPrompt,
  buildInterviewPlanPrompt,
  buildInterviewQuestionPrompt,
  normalizeInterviewAnalysis,
  resolveInterviewPlan,
  runInterviewAgent,
  type InterviewAnalysis,
  type InterviewLens,
  type InterviewPlan,
  type Probe,
  type TranscriptTurn,
} from "../src/index.ts";

const probes: Probe[] = [
  { id: "vision", goal: "what future they want" },
  { id: "reason", goal: "what draws them to it" },
  { id: "optional", goal: "extra color", required: false },
];

const lenses: InterviewLens[] = [
  {
    id: "beyond",
    goal: "whether the desire naturally extends beyond the person",
    trigger: "the person mentions other people or a change they want others to experience",
    guard: "do not imply that helping others is better",
  },
  {
    id: "scale",
    goal: "whether the same desire survives at larger scope",
    trigger: "the person spontaneously talks about many people, an industry, or a repeated structural problem",
  },
];

const transcript: TranscriptTurn[] = [
  { role: "assistant", text: "どんな未来がいい？" },
  { role: "user", text: "自由に作っていたい。会社に時間を決められたくない。" },
  { role: "assistant", text: "自由になったら？" },
  { role: "user", text: "同じように作りたいのに技術がなくて諦める人は減ってほしい。" },
];

test("analysis keeps grounded openings and rejects unknown or invented evidence", () => {
  const analysis: InterviewAnalysis = {
    filled: ["vision", "ghost"],
    openings: [
      {
        lensId: "beyond",
        status: "signal",
        hypothesis: "Their wish may extend to other makers.",
        confidence: 0.8,
        evidence: [{ turnIndex: 3, quote: "諦める人は減ってほしい" }],
      },
      {
        lensId: "scale",
        status: "signal",
        hypothesis: "Could be a structural ambition.",
        confidence: 0.6,
        evidence: [{ turnIndex: 3, quote: "100万人を救いたい" }],
      },
      {
        lensId: "unknown",
        status: "adopted",
        hypothesis: "Invented.",
        confidence: 1,
        evidence: [{ turnIndex: 3, quote: "諦める人は減ってほしい" }],
      },
      {
        lensId: "beyond",
        status: "signal",
        hypothesis: "Assistant evidence must not count.",
        confidence: 1,
        evidence: [{ turnIndex: 2, quote: "自由になったら？" }],
      },
    ],
    unresolved: ["  「自由」の具体像  ", "「自由」の具体像"],
  };

  const normalized = normalizeInterviewAnalysis({
    analysis,
    probes,
    lenses,
    transcript,
    knownFilled: ["reason"],
  });

  assert.deepEqual(normalized.filled, ["reason", "vision"]);
  assert.equal(normalized.openings.length, 1);
  assert.equal(normalized.openings[0]?.lensId, "beyond");
  assert.deepEqual(normalized.unresolved, ["「自由」の具体像"]);
});

test("a rejected lens cannot be selected even if another opening says signal", () => {
  const analysis: InterviewAnalysis = {
    filled: ["vision"],
    openings: [
      {
        lensId: "beyond",
        status: "signal",
        hypothesis: "Maybe.",
        confidence: 0.8,
        evidence: [{ turnIndex: 3, quote: "減ってほしい" }],
      },
      {
        lensId: "beyond",
        status: "rejected",
        hypothesis: "They later rejected this direction.",
        confidence: 1,
        evidence: [{ turnIndex: 1, quote: "自由に作っていたい" }],
      },
    ],
    unresolved: [],
  };
  const plan: InterviewPlan = {
    action: "explore_lens",
    probeId: null,
    lensId: "beyond",
    objective: "test the social extension",
    rationale: "opening exists",
  };

  const resolved = resolveInterviewPlan({ plan, analysis, probes, lenses });
  assert.equal(resolved.action, "cover_probe");
  assert.equal(resolved.probeId, "reason");
});

test("invalid planner targets fall back to grounded work, not a made-up lens", () => {
  const analysis: InterviewAnalysis = {
    filled: ["vision", "reason"],
    openings: [],
    unresolved: ["what freedom means on an ordinary Tuesday"],
  };
  const plan: InterviewPlan = {
    action: "explore_lens",
    probeId: null,
    lensId: "beyond",
    objective: "make it social",
    rationale: "try",
  };

  const resolved = resolveInterviewPlan({ plan, analysis, probes, lenses });
  assert.equal(resolved.action, "deepen");
  assert.equal(resolved.objective, "what freedom means on an ordinary Tuesday");
});

test("prompts encode hypothesis testing rather than bigger-is-better", () => {
  const analysis: InterviewAnalysis = {
    filled: ["vision"],
    openings: [{
      lensId: "beyond",
      status: "signal",
      hypothesis: "Their desire might extend to other makers.",
      confidence: 0.8,
      evidence: [{ turnIndex: 3, quote: "諦める人は減ってほしい" }],
    }],
    unresolved: [],
  };
  const plan: InterviewPlan = {
    action: "explore_lens",
    probeId: null,
    lensId: "beyond",
    objective: "test whether this concern matters beyond the user's own freedom",
    rationale: "grounded signal",
  };

  const analysisPrompt = buildInterviewAnalysisPrompt({
    instructions: "Stay curious.",
    probes,
    lenses,
    transcript,
    language: "Japanese",
  });
  const planPrompt = buildInterviewPlanPrompt({
    instructions: "Stay curious.",
    probes,
    lenses,
    transcript,
    language: "Japanese",
    analysis,
    maxQuestions: 10,
  });
  const questionPrompt = buildInterviewQuestionPrompt({
    instructions: "Stay curious.",
    probes,
    lenses,
    transcript,
    language: "Japanese",
    analysis,
    plan,
  });

  assert.match(analysisPrompt, /A lens is NOT a quota/);
  assert.match(planPrompt, /Never revisit a rejected lens/);
  assert.match(questionPrompt, /TESTS the\s+hypothesis/);
  assert.match(questionPrompt, /more scalable desire/);
});

test("explicit stop ends before model use and does not fake completed probes", async () => {
  const events: Array<{ type: string; probesPending?: number }> = [];
  const step = await runInterviewAgent({
    model: undefined as never,
    instructions: "x",
    probes,
    lenses,
    transcript,
    language: "Japanese",
    knownFilled: ["vision"],
    userRequestedStop: true,
    onEvent: (event) => events.push(event),
  });

  assert.equal(step.done, true);
  assert.deepEqual(step.filled, ["vision"]);
  assert.equal(step.question, null);
  assert.equal(step.plan.action, "finish");
  const ended = events.find((event) => event.type === "interview.ended");
  assert.equal(ended?.probesPending, 1);
});

test("question budget ends without pretending unanswered required probes are filled", async () => {
  const step = await runInterviewAgent({
    model: undefined as never,
    instructions: "x",
    probes,
    transcript,
    language: "Japanese",
    knownFilled: [],
    askedCount: 2,
    maxQuestions: 2,
  });

  assert.equal(step.done, true);
  assert.deepEqual(step.filled, []);
});

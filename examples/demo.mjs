// The loop, running.
//
// Every line this prints comes out of the package. The model is a scripted
// fake — canned answers in call order — so the demo runs with no key, no
// network and the same output every time, which is what makes it safe to
// record. Everything AROUND the model is the real thing: the turning point is
// computed, the schema is enforced, the unscored axis is dropped, the style
// prompt is measured against Suno's limit, the failure is typed.
//
//   npm run build && node examples/demo.mjs
//
// The recording in the README is this output, rendered by scripts/render-demo.mjs.

import {
  CoreloopError,
  askNextQuestion,
  candidatesSchema,
  createEngine,
  createHandlePolicy,
  isRetryableError,
  normalizeAxisScores,
  pickImprovedAxis,
  pickShareMoment,
} from "../dist/index.js";
import { LIFE_CHART_QUESTIONS, pickTurningPoints, renderQuestion } from "../dist/frameworks.js";
import { SUNO_LIMITS, formatStylePrompt } from "../dist/suno.js";

// ---------------------------------------------------------------------------
// A model that answers from a script, in call order.
// ---------------------------------------------------------------------------

function scriptedModel(replies) {
  let call = 0;
  return {
    specificationVersion: "v3",
    provider: "demo",
    modelId: "scripted",
    supportedUrls: {},
    doGenerate: async () => {
      const reply = replies[call++];
      if (reply === undefined) throw new Error("the script ran out of answers");
      return {
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        content: [{ type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply) }],
        warnings: [],
      };
    },
  };
}

const engine = createEngine({
  model: scriptedModel([
    // 1. the next question, chosen against what was just said
    {
      filled: ["origin"],
      probeId: "retort",
      question: "What did you want to say back?",
      rationale: "They went quiet at the exact point that still moves the line.",
      done: false,
    },
    // 2. three candidate statements
    {
      candidates: [
        { text: "I keep going after the room stops watching.", angle: "endurance" },
        { text: "I turn being underestimated into fuel.", angle: "defiance" },
        { text: "I finish what I start, quietly.", angle: "consistency" },
      ],
    },
    // 3. the refine round, after all three were rejected
    {
      candidates: [
        { text: "I never said it back. I just kept showing up.", angle: "the unsaid" },
        { text: "Silence, then twelve years of turning up.", angle: "time" },
        { text: "I answered them with attendance.", angle: "proof" },
      ],
    },
    // 4. the style prompt for the song
    "indie folk, 92 BPM, close-mic male vocal, brushed drums, tape hiss, restrained until the last chorus, quietly defiant",
  ]),
});

// ---------------------------------------------------------------------------
// Printing. Plain text, fixed label column — the renderer styles it from that.
// ---------------------------------------------------------------------------

const WIDTH = 92; // wrapped here so a recording of this never needs a sideways scroll

const out = [];
const line = (label, text) => {
  if (text === undefined) return out.push(label);
  const indent = "  " + " ".repeat(11);
  const words = String(text).split(" ");
  const rows = [];
  let row = "";
  for (const word of words) {
    if (row && `${row} ${word}`.length > WIDTH - indent.length) {
      rows.push(row);
      row = word;
    } else {
      row = row ? `${row} ${word}` : word;
    }
  }
  rows.push(row);
  out.push(`  ${label.padEnd(10)} ${rows[0]}`);
  for (const rest of rows.slice(1)) out.push(`${indent}${rest}`);
};
const rule = (title) => {
  out.push("");
  out.push(`  ── ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`);
};

line("  coreloop  ·  dig → verbalize → brand → share → loop");

// ---------------------------------------------------------------------------

rule("dig");

const chart = [
  { id: "p1", at: 6, score: 3, label: "picked up a guitar" },
  { id: "p2", at: 12, score: -3, label: "played in front of the class" },
  { id: "p3", at: 15, score: 0 },
  { id: "p4", at: 18, score: 2, label: "first song finished" },
  { id: "p5", at: 24, score: 4 },
];

const [turning] = pickTurningPoints(chart, { count: 1, scale: { min: -5, max: 5 } });
line("chart", `5 points · biggest move ${turning.delta} at ${turning.point.at} (${turning.kind})`);

const asked = renderQuestion(LIFE_CHART_QUESTIONS.turningPoint, "en", {
  at: String(turning.point.at),
});
line("ask", `"${asked.text}"`);
line("answer", `"everyone laughed. i said nothing back."`);

const turns = [
  { role: "assistant", text: asked.text },
  { role: "user", text: "everyone laughed. i said nothing back." },
];

const step = await engine.askNextQuestion({
  instructions: "YOUR_INTERVIEW_STYLE",
  probes: [
    { id: "origin", goal: "the moment it started" },
    { id: "retort", goal: "what they never said back" },
  ],
  transcript: turns,
  language: "English",
  maxQuestions: 6,
});
line("next", `"${step.question}"`);
line("", `why: ${step.rationale}`);
line("answer", `"that i'd still be doing this when they quit."`);

// ---------------------------------------------------------------------------

rule("verbalize");

const first = await engine.generateStructured({
  schema: candidatesSchema(3),
  prompt: "YOUR_EXTRACTION_PROMPT",
});
first.candidates.forEach((c, i) => line(i === 0 ? "candidates" : "", `${i + 1}. ${c.text}`));

line("rejected", `"none of these — too polished"`);

const refined = await engine.generateStructured({
  schema: candidatesSchema(3),
  prompt: "YOUR_EXTRACTION_PROMPT + the rejection",
});
refined.candidates.forEach((c, i) => line(i === 0 ? "refined" : "", `${i + 1}. ${c.text}`));
line("accepted", `"${refined.candidates[0].text}"`);

// ---------------------------------------------------------------------------

rule("brand");

const axes = [
  { key: "specificity", label: "specificity" },
  { key: "ownership", label: "ownership" },
  { key: "reach", label: "reach" },
];
// The model scored two axes and skipped one. The third stays missing.
const scores = normalizeAxisScores(axes, [
  { axisKey: "specificity", score: 4 },
  { axisKey: "ownership", score: 5 },
]);
line("scored", scores.map((s) => `${s.label} ${s.score}/${s.maxScore}`).join(" · "));
line("", `${axes.length - scores.length} axis unscored — dropped, never filled with a neutral 3`);

const handles = createHandlePolicy({ reserved: ["me", "admin"] });
const checked = handles.check("Koi To");
line("handle", `"Koi To" → ${checked.violation}`);

// ---------------------------------------------------------------------------

rule("share");

const previous = [
  { axisKey: "specificity", label: "specificity", score: 2, maxScore: 5 },
  { axisKey: "ownership", label: "ownership", score: 5, maxScore: 5 },
];
const improvement = pickImprovedAxis(scores, previous);
const moment = pickShareMoment({ isFirstResult: false, improvement, alreadyOffered: [] });
line("moment", `${moment.kind}: ${improvement.label} +${improvement.delta} → offer the card`);
line("", "no improvement, no offer. asking every time is how a prompt gets ignored");

const style = formatStylePrompt(
  await engine.generateProse({ prompt: "YOUR_STYLE_PROMPT" }),
);
line("suno", `"${style}"`);
line("", `${style.length} chars, inside Suno's ${SUNO_LIMITS.style} — overflow drops whole fragments`);

// ---------------------------------------------------------------------------

rule("when it fails");

// Two different failures, and the only difference that matters to a UI.
for (const [label, prompt] of [["thrown", "   "], ["", "the script has run out of answers"]]) {
  try {
    await engine.generateStructured({ schema: candidatesSchema(3), prompt });
  } catch (err) {
    const reason = err instanceof CoreloopError ? err.reason : "?";
    const verdict = isRetryableError(err)
      ? "retryable: true  → show the retry button"
      : "retryable: false → no retry button, it fails the same way every time";
    line(label, `CoreloopError · ${reason.padEnd(12)} ${verdict}`);
  }
}

out.push("");
line("  no prompts of its own. bring your own questions.");
out.push("");

console.log(out.join("\n"));

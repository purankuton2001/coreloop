// Asking the next question.
//
// A fixed questionnaire gets fixed answers: the person recites the summary they
// always give. What produces material worth publishing is a question aimed at
// what THIS person just said — the thin spot, the thing they skipped past, the
// word they used twice.
//
// So the engine does not hold a script. It holds PROBES — what each question is
// trying to get out of the person — and asks the model to pick the next single
// question given everything said so far, or to declare the material sufficient.
// The wording of the probes, like every other instruction, belongs to the product.

import { z } from "zod";
import { formatTranscript, type TranscriptLabels, type TranscriptTurn } from "./transcript.ts";
import { generateStructured, type ModelLike } from "./generate.ts";
import { fillTemplate, joinSections } from "./text.ts";
import type { CoreloopEventHandler } from "./events.ts";

export type Probe = {
  id: string;
  /**
   * What this probe is after, in the interviewer's own words — not the question
   * text. SERVER ONLY: the probe list is the product's method.
   */
  goal: string;
  /** An unfilled required probe keeps the interview going. Default: true. */
  required?: boolean;
};

export type InterviewStep = {
  /** Probes the answers now cover — including ones filled incidentally. */
  filled: string[];
  /** The probe this question serves, if any. */
  probeId: string | null;
  /** The question to ask, in the person's language. null once done. */
  question: string | null;
  /** Why this question, given what was said. For logs and for tuning probes. */
  rationale: string;
  /** True when the material is enough — no more questions. */
  done: boolean;
};

export const interviewStepSchema = z.object({
  filled: z.array(z.string()).describe("ids of probes the answers now cover"),
  probeId: z.string().nullable().describe("id of the probe this question serves, or null"),
  question: z.string().nullable().describe("the single next question, or null when done"),
  rationale: z.string().describe("one sentence: why this question, given what was said"),
  done: z.boolean().describe("true when there is enough material"),
});

export type AskNextQuestionArgs = {
  model: ModelLike;
  /**
   * The product's interviewing instruction: tone, what counts as depth, what to
   * avoid. May contain {{probes}}, {{transcript}}, {{language}}, {{remaining}}.
   */
  instructions: string;
  probes: readonly Probe[];
  transcript: readonly TranscriptTurn[];
  /** Language to ask in, e.g. "Japanese". */
  language: string;
  /** Stop after this many questions even if probes remain. */
  maxQuestions?: number;
  /** Questions already asked (defaults to counting assistant turns). */
  askedCount?: number;
  labels?: TranscriptLabels;
  vars?: Record<string, string>;
  temperature?: number;
  /** Receives question.asked / interview.ended as they happen. */
  onEvent?: CoreloopEventHandler;
};

function formatProbes(probes: readonly Probe[]): string {
  return probes
    .map((p) => `- ${p.id}${p.required === false ? " (optional)" : ""}: ${p.goal}`)
    .join("\n");
}

const DEFAULT_RULES = `You are conducting an interview. Ask exactly ONE next question.

Rules:
- Aim the question at what this person actually said. Quote or echo their own
  words when it makes the question sharper.
- Never re-ask something they already answered. If an answer was thin or evasive,
  dig into that instead of moving on.
- One question at a time. No preamble, no stacked sub-questions.
- Prefer a concrete question ("what did you say back?") over an abstract one
  ("what are your values?"). Concrete answers carry the texture that abstractions
  cannot.
- Mark a probe as filled the moment the material is there, even if it came out
  while answering something else.
- Set done: true when the remaining probes are optional or already covered, or
  when further questions would only produce repetition. Ending early with real
  material beats filling a quota with recitations.`;

export function buildNextQuestionPrompt(
  args: Omit<AskNextQuestionArgs, "model" | "temperature">,
): string {
  const transcript = formatTranscript(args.transcript, { labels: args.labels });
  const asked =
    args.askedCount ?? args.transcript.filter((t) => t.role === "assistant").length;
  const remaining =
    args.maxQuestions != null ? String(Math.max(0, args.maxQuestions - asked)) : "unlimited";

  const instructions = fillTemplate(args.instructions, {
    probes: formatProbes(args.probes),
    transcript: transcript || "(nothing said yet)",
    language: args.language,
    remaining,
    ...args.vars,
  });

  // When the instruction already places the material itself, trust it and add
  // nothing — a product that wants full control of the prompt gets it.
  const placed = args.instructions.includes("{{transcript}}");

  return joinSections(
    DEFAULT_RULES,
    instructions,
    placed
      ? null
      : `Probes to fill:\n${formatProbes(args.probes)}`,
    placed ? null : `Conversation so far:\n${transcript || "(nothing said yet)"}`,
    `Ask in ${args.language}. Questions remaining: ${remaining}.`,
  );
}

/**
 * Pick the next question — or decide the interview is done.
 *
 * The hard stop at maxQuestions is enforced here rather than left to the model:
 * a model asked to judge its own budget will keep finding one more thing worth
 * asking, and the person is the one paying for it in time.
 */
export async function askNextQuestion(args: AskNextQuestionArgs): Promise<InterviewStep> {
  const asked =
    args.askedCount ?? args.transcript.filter((t) => t.role === "assistant").length;

  const ended = (step: InterviewStep) => {
    args.onEvent?.({
      type: "interview.ended",
      questionsAsked: asked,
      probesFilled: step.filled.length,
      probesPending: pendingProbes(args.probes, step.filled).length,
      at: Date.now(),
    });
    return step;
  };

  if (args.maxQuestions != null && asked >= args.maxQuestions) {
    return ended({
      filled: args.probes.filter((p) => p.required !== false).map((p) => p.id),
      probeId: null,
      question: null,
      rationale: "Question budget reached.",
      done: true,
    });
  }

  const step = await generateStructured({
    model: args.model,
    schema: interviewStepSchema,
    prompt: buildNextQuestionPrompt(args),
    stage: "dig",
    ...(args.onEvent ? { onEvent: args.onEvent } : {}),
    ...(args.temperature != null ? { temperature: args.temperature } : {}),
  });

  const known = new Set(args.probes.map((p) => p.id));
  const filled = step.filled.filter((id) => known.has(id));
  const probeId = step.probeId && known.has(step.probeId) ? step.probeId : null;
  const question = step.question?.trim() ? step.question.trim() : null;

  // A step with no question is finished whatever the flag says, and a step with
  // a question is not — otherwise the caller ends up with a dead end or with a
  // question it was told to ignore.
  const resolved: InterviewStep = {
    filled,
    probeId,
    question,
    rationale: step.rationale,
    done: question === null,
  };

  if (resolved.question === null) return ended(resolved);

  args.onEvent?.({
    type: "question.asked",
    probeId: resolved.probeId,
    index: asked,
    rationale: resolved.rationale,
    at: Date.now(),
  });
  return resolved;
}

/** Probes still unfilled and required — what an interview is still waiting for. */
export function pendingProbes(
  probes: readonly Probe[],
  filled: readonly string[],
): Probe[] {
  const done = new Set(filled);
  return probes.filter((p) => p.required !== false && !done.has(p.id));
}

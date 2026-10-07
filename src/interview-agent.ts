// Multi-stage adaptive interviewing.
//
// Existing askNextQuestion() remains the cheap one-call path. This module is the
// higher-control path for products that want to separate:
//   1) what the person actually said,
//   2) which direction is worth exploring,
//   3) how to ask the next single question.
//
// Product-specific lenses stay with the caller. coreloop only provides the
// evidence boundary and orchestration.

import { z } from "zod";
import { generateStructured, type ModelLike } from "./generate.ts";
import { pendingProbes, type InterviewStep, type Probe } from "./interview.ts";
import { formatTranscript, visibleTurns, type TranscriptLabels, type TranscriptTurn } from "./transcript.ts";
import { fillTemplate, joinSections } from "./text.ts";
import type { CoreloopEventHandler } from "./events.ts";
import type { PerspectiveMoveTemplate } from "./perspective.ts";

export type InterviewLens = {
  id: string;
  /** The direction this lens may explore. This is not a required quota. */
  goal: string;
  /** What user-provided signal makes this lens worth testing. */
  trigger: string;
  /** Optional boundary that keeps the exploration from becoming leading. */
  guard?: string;
};

export type InterviewEvidence = {
  /** Index into visibleTurns(transcript), not the raw input array. */
  turnIndex: number;
  /** Verbatim or whitespace-equivalent quote from that USER turn. */
  quote: string;
};

export type InterviewOpeningStatus = "signal" | "adopted" | "rejected";

export type InterviewOpening = {
  lensId: string;
  status: InterviewOpeningStatus;
  /** A private hypothesis to test, never a fact about the person. */
  hypothesis: string;
  confidence: number;
  evidence: InterviewEvidence[];
};

export type InterviewAnalysis = {
  /** Probe ids the transcript already covers. */
  filled: string[];
  /** Opportunistic directions supported by the person's own words. */
  openings: InterviewOpening[];
  /** Concrete unresolved tensions/details worth deepening without a lens. */
  unresolved: string[];
};

export const interviewEvidenceSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  quote: z.string().min(1).max(800),
}).strict();

export const interviewOpeningSchema = z.object({
  lensId: z.string().min(1).max(120),
  status: z.enum(["signal", "adopted", "rejected"]),
  hypothesis: z.string().min(1).max(1200),
  confidence: z.number().min(0).max(1),
  evidence: z.array(interviewEvidenceSchema).min(1).max(6),
}).strict();

export const interviewAnalysisSchema = z.object({
  filled: z.array(z.string().min(1).max(120)).max(64),
  openings: z.array(interviewOpeningSchema).max(24),
  unresolved: z.array(z.string().min(1).max(1200)).max(16),
}).strict();

export type InterviewPlanAction = "deepen" | "cover_probe" | "explore_lens" | "finish";

export type InterviewPlan = {
  action: InterviewPlanAction;
  probeId: string | null;
  lensId: string | null;
  /** Optional generic vantage-shift tactic for this one question. */
  perspectiveMoveId: string | null;
  /** Server-side intent handed to the question writer. */
  objective: string | null;
  rationale: string;
};

export const interviewPlanSchema = z.object({
  action: z.enum(["deepen", "cover_probe", "explore_lens", "finish"]),
  probeId: z.string().min(1).max(120).nullable(),
  lensId: z.string().min(1).max(120).nullable(),
  perspectiveMoveId: z.string().min(1).max(120).nullable(),
  objective: z.string().min(1).max(1600).nullable(),
  rationale: z.string().min(1).max(1600),
}).strict();

const interviewQuestionSchema = z.object({
  question: z.string().min(1).max(1600),
}).strict();

export type AnalyzeInterviewArgs = {
  model: ModelLike;
  instructions: string;
  probes: readonly Probe[];
  lenses?: readonly InterviewLens[];
  /** Generic one-step vantage shifts the director may choose from. No moves are used unless supplied. */
  perspectiveMoves?: readonly PerspectiveMoveTemplate[];
  transcript: readonly TranscriptTurn[];
  language: string;
  knownFilled?: readonly string[];
  labels?: TranscriptLabels;
  vars?: Record<string, string>;
  temperature?: number;
  onEvent?: CoreloopEventHandler;
};

export type PlanInterviewArgs = Omit<AnalyzeInterviewArgs, "knownFilled"> & {
  analysis: InterviewAnalysis;
  maxQuestions?: number;
  askedCount?: number;
};

export type WriteInterviewQuestionArgs = Omit<AnalyzeInterviewArgs, "knownFilled"> & {
  analysis: InterviewAnalysis;
  plan: InterviewPlan;
};

export type InterviewAgentModels = {
  analyst?: ModelLike;
  director?: ModelLike;
  interviewer?: ModelLike;
};

export type RunInterviewAgentArgs = Omit<AnalyzeInterviewArgs, "model"> & {
  model: ModelLike;
  models?: InterviewAgentModels;
  maxQuestions?: number;
  askedCount?: number;
  userRequestedStop?: boolean;
};

export type AgentInterviewStep = InterviewStep & {
  lensId: string | null;
  analysis: InterviewAnalysis;
  plan: InterviewPlan;
};

function uniq(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatProbes(probes: readonly Probe[]): string {
  return probes
    .map((probe) => `- ${probe.id}${probe.required === false ? " (optional)" : ""}: ${probe.goal}`)
    .join("\n");
}

function formatLenses(lenses: readonly InterviewLens[]): string {
  if (!lenses.length) return "(none)";
  return lenses
    .map((lens) => [
      `- ${lens.id}: ${lens.goal}`,
      `  trigger: ${lens.trigger}`,
      ...(lens.guard ? [`  guard: ${lens.guard}`] : []),
    ].join("\n"))
    .join("\n");
}

function formatPerspectiveMoves(moves: readonly PerspectiveMoveTemplate[]): string {
  if (!moves.length) return "(none)";
  return moves.map((move) => [
    `- ${move.id}: ${move.goal}`,
    `  question hint: ${move.questionHint}`,
    `  guard: ${move.guard}`,
  ].join("\n")).join("\n");
}

function evidenceBelongsToUserTurn(
  transcript: readonly TranscriptTurn[],
  evidence: InterviewEvidence,
): boolean {
  const turns = visibleTurns(transcript);
  const turn = turns[evidence.turnIndex];
  if (!turn || turn.role !== "user") return false;
  const quote = evidence.quote.trim();
  if (!quote) return false;
  return turn.text.includes(quote)
    || collapseWhitespace(turn.text).includes(collapseWhitespace(quote));
}

/**
 * Remove model inventions before analysis becomes planner state.
 *
 * A lens opening without a quote in an actual user turn does not exist. An
 * unknown lens/probe also does not become real merely because the model named it.
 */
export function normalizeInterviewAnalysis(input: {
  analysis: InterviewAnalysis;
  probes: readonly Probe[];
  lenses?: readonly InterviewLens[];
  transcript: readonly TranscriptTurn[];
  knownFilled?: readonly string[];
}): InterviewAnalysis {
  const probeIds = new Set(input.probes.map((probe) => probe.id));
  const lensIds = new Set((input.lenses ?? []).map((lens) => lens.id));

  const filled = uniq([
    ...(input.knownFilled ?? []),
    ...input.analysis.filled,
  ].filter((id) => probeIds.has(id)));

  const openings: InterviewOpening[] = [];
  for (const opening of input.analysis.openings) {
    if (!lensIds.has(opening.lensId)) continue;
    const evidence = opening.evidence.filter((item) =>
      evidenceBelongsToUserTurn(input.transcript, item));
    if (!evidence.length) continue;
    openings.push({
      lensId: opening.lensId,
      status: opening.status,
      hypothesis: opening.hypothesis.trim(),
      confidence: clamp01(opening.confidence),
      evidence,
    });
  }

  return {
    filled,
    openings,
    unresolved: uniq(input.analysis.unresolved.map((item) => item.trim()).filter(Boolean)),
  };
}

const ANALYST_RULES = `You are the analyst behind an interview. Separate what the
person actually said from hypotheses about what may be worth exploring.

Rules:
- Mark probes filled when the person's answers already contain the requested material.
- A lens is NOT a quota. Only create an opening when the person's own words match
  that lens's trigger.
- Every opening needs at least one quote from a USER turn and its visible turn index.
- "signal" means there is evidence worth testing, but the person has not explicitly
  adopted the hypothesis.
- "adopted" means the person THEMSELVES clearly endorsed that interpretation.
- "rejected" means the person explicitly declined or contradicted that direction.
- Never upgrade an attractive interpretation into a fact. A bigger, more social,
  more altruistic or more impressive ambition is not inherently better.
- unresolved contains concrete tensions, skipped details or repeated words that
  could produce a sharper next question without inventing a lens.`;

export function buildInterviewAnalysisPrompt(
  args: Omit<AnalyzeInterviewArgs, "model" | "temperature" | "onEvent">,
): string {
  const transcript = formatTranscript(args.transcript, {
    labels: args.labels,
    numbered: true,
  });
  const instructions = fillTemplate(args.instructions, {
    probes: formatProbes(args.probes),
    lenses: formatLenses(args.lenses ?? []),
    transcript: transcript || "(nothing said yet)",
    language: args.language,
    ...args.vars,
  });

  return joinSections(
    ANALYST_RULES,
    instructions,
    `Probes:\n${formatProbes(args.probes)}`,
    `Exploration lenses:\n${formatLenses(args.lenses ?? [])}`,
    args.knownFilled?.length
      ? `Already accepted filled probes from caller state: ${uniq(args.knownFilled).join(", ")}`
      : null,
    `Conversation (visible-turn indexes):\n${transcript || "(nothing said yet)"}`,
  );
}

export async function analyzeInterview(args: AnalyzeInterviewArgs): Promise<InterviewAnalysis> {
  const raw = await generateStructured({
    model: args.model,
    schema: interviewAnalysisSchema,
    prompt: buildInterviewAnalysisPrompt(args),
    stage: "dig",
    ...(args.temperature != null ? { temperature: args.temperature } : {}),
    ...(args.onEvent ? { onEvent: args.onEvent } : {}),
  });
  return normalizeInterviewAnalysis({
    analysis: raw,
    probes: args.probes,
    lenses: args.lenses,
    transcript: args.transcript,
    knownFilled: args.knownFilled,
  });
}

function rejectedLensIds(analysis: InterviewAnalysis): Set<string> {
  return new Set(
    analysis.openings
      .filter((opening) => opening.status === "rejected")
      .map((opening) => opening.lensId),
  );
}

function availableOpeningIds(analysis: InterviewAnalysis): Set<string> {
  const rejected = rejectedLensIds(analysis);
  return new Set(
    analysis.openings
      .filter((opening) => opening.status !== "rejected" && !rejected.has(opening.lensId))
      .map((opening) => opening.lensId),
  );
}

/**
 * Resolve invalid planner output without inventing a product-specific direction.
 * Required probes are the safest fallback; otherwise deepen an existing unresolved
 * point, and if neither exists, finish.
 */
export function resolveInterviewPlan(input: {
  plan: InterviewPlan;
  analysis: InterviewAnalysis;
  probes: readonly Probe[];
  lenses?: readonly InterviewLens[];
}): InterviewPlan {
  const probes = new Map(input.probes.map((probe) => [probe.id, probe]));
  const lenses = new Map((input.lenses ?? []).map((lens) => [lens.id, lens]));
  const perspectiveMoves = new Set((input.perspectiveMoves ?? []).map((move) => move.id));
  const validMove = (id: string | null) => id && perspectiveMoves.has(id) ? id : null;
  const pending = pendingProbes(input.probes, input.analysis.filled);
  const openings = availableOpeningIds(input.analysis);
  const plan = input.plan;

  const finish = (reason = plan.rationale): InterviewPlan => ({
    action: "finish",
    probeId: null,
    lensId: null,
    perspectiveMoveId: null,
    objective: null,
    rationale: reason,
  });

  const fallback = (): InterviewPlan => {
    const required = pending[0];
    if (required) {
      return {
        action: "cover_probe",
        probeId: required.id,
        lensId: null,
        perspectiveMoveId: null,
        objective: required.goal,
        rationale: "Planner target was invalid; cover the next required probe.",
      };
    }
    const unresolved = input.analysis.unresolved[0];
    if (unresolved) {
      return {
        action: "deepen",
        probeId: null,
        lensId: null,
        perspectiveMoveId: validMove(plan.perspectiveMoveId),
        objective: unresolved,
        rationale: "Planner target was invalid; deepen an existing unresolved point.",
      };
    }
    return finish("Planner target was invalid and no grounded direction remains.");
  };

  if (plan.action === "finish") return finish();

  if (plan.action === "cover_probe") {
    if (!plan.probeId || !probes.has(plan.probeId)) return fallback();
    if (input.analysis.filled.includes(plan.probeId)) return fallback();
    return {
      action: "cover_probe",
      probeId: plan.probeId,
      lensId: null,
      perspectiveMoveId: null,
      objective: plan.objective ?? probes.get(plan.probeId)!.goal,
      rationale: plan.rationale,
    };
  }

  if (plan.action === "explore_lens") {
    if (!plan.lensId || !lenses.has(plan.lensId) || !openings.has(plan.lensId)) return fallback();
    return {
      action: "explore_lens",
      probeId: null,
      lensId: plan.lensId,
      perspectiveMoveId: validMove(plan.perspectiveMoveId),
      objective: plan.objective?.trim() || lenses.get(plan.lensId)!.goal,
      rationale: plan.rationale,
    };
  }

  if (!plan.objective?.trim()) return fallback();
  return {
    action: "deepen",
    probeId: null,
    lensId: null,
    perspectiveMoveId: validMove(plan.perspectiveMoveId),
    objective: plan.objective.trim(),
    rationale: plan.rationale,
  };
}

const DIRECTOR_RULES = `You are the director of an adaptive interview. Choose the
next interviewing MOVE, not the wording of the question.

Rules:
- Required probes matter, but do not mechanically march through them when a
  transcript-specific opening is unusually valuable and there is budget.
- "explore_lens" is allowed only for a lens with a grounded non-rejected opening.
- A signal is a hypothesis to TEST. Never act as though the person has already
  adopted it.
- Never revisit a rejected lens.
- Lenses are optional and are not a checklist. The person may have a small,
  private, individual desire and the interview may end there.
- "deepen" follows a concrete unresolved tension/detail already present.
- A perspective move is optional. Use at most ONE, only when it sharpens a grounded objective.
  It changes the vantage, not the answer the person is supposed to reach.
- Prefer an adjacent shift over a leap: nearby stakeholder before "society", a later horizon
  before "your whole legacy", owning one decision before "you are the CEO".
- Finish when required probes are covered and another question would mostly
  repeat the material, or when no grounded opening remains.
- Do not reward scale, social impact, altruism, status or eloquence by default.`;

export function buildInterviewPlanPrompt(
  args: Omit<PlanInterviewArgs, "model" | "temperature" | "onEvent">,
): string {
  const asked = args.askedCount
    ?? args.transcript.filter((turn) => turn.role === "assistant").length;
  const remaining = args.maxQuestions == null
    ? "unlimited"
    : String(Math.max(0, args.maxQuestions - asked));
  const transcript = formatTranscript(args.transcript, {
    labels: args.labels,
    numbered: true,
  });

  return joinSections(
    DIRECTOR_RULES,
    fillTemplate(args.instructions, {
      probes: formatProbes(args.probes),
      lenses: formatLenses(args.lenses ?? []),
      transcript: transcript || "(nothing said yet)",
      language: args.language,
      remaining,
      ...args.vars,
    }),
    `Probes:\n${formatProbes(args.probes)}`,
    `Exploration lenses:\n${formatLenses(args.lenses ?? [])}`,
    `Optional perspective moves:\n${formatPerspectiveMoves(args.perspectiveMoves ?? [])}`,
    `Grounded analysis:\n${JSON.stringify(args.analysis)}`,
    `Conversation:\n${transcript || "(nothing said yet)"}`,
    `Questions remaining: ${remaining}.`,
  );
}

export async function planInterview(args: PlanInterviewArgs): Promise<InterviewPlan> {
  const raw = await generateStructured({
    model: args.model,
    schema: interviewPlanSchema,
    prompt: buildInterviewPlanPrompt(args),
    stage: "dig",
    ...(args.temperature != null ? { temperature: args.temperature } : {}),
    ...(args.onEvent ? { onEvent: args.onEvent } : {}),
  });
  return resolveInterviewPlan({
    plan: raw,
    analysis: args.analysis,
    probes: args.probes,
    lenses: args.lenses,
  });
}

const QUESTION_RULES = `You write exactly ONE interview question for the person.

Rules:
- Use the director's objective, but ground the wording in what the person actually said.
- Ask in the requested language.
- One question only. No stacked sub-questions, no advice, no diagnosis, no praise.
- If exploring a lens whose status is "signal", ask a question that TESTS the
  hypothesis. Do not smuggle the hypothesis into the premise.
- If the person adopted a lens, you may deepen it, but still preserve their wording.
- If a perspective move is selected, use it as a QUESTION SHAPE only:\n  stance = nearby stakeholder/decision seat; time_horizon = one horizon outward;\n  scope = one adjacent circle wider; responsibility = own one decision/tradeoff;\n  assumption = suspend one explicit premise. Never jump several levels at once.
- Never imply that a bigger, more social, more altruistic or more scalable desire
  is the mature/correct answer.
- Do not mention probes, lenses, analysis, scoring or the director.`;

export function buildInterviewQuestionPrompt(
  args: Omit<WriteInterviewQuestionArgs, "model" | "temperature" | "onEvent">,
): string {
  const transcript = formatTranscript(args.transcript, {
    labels: args.labels,
    numbered: true,
  });
  const relevantOpening = args.plan.lensId
    ? args.analysis.openings.filter((opening) => opening.lensId === args.plan.lensId)
    : [];
  const selectedMove = args.plan.perspectiveMoveId
    ? (args.perspectiveMoves ?? []).find((move) => move.id === args.plan.perspectiveMoveId)
    : undefined;

  return joinSections(
    QUESTION_RULES,
    fillTemplate(args.instructions, {
      probes: formatProbes(args.probes),
      lenses: formatLenses(args.lenses ?? []),
      transcript: transcript || "(nothing said yet)",
      language: args.language,
      ...args.vars,
    }),
    `Director plan:\n${JSON.stringify(args.plan)}`,
    selectedMove ? `Selected perspective move:\n${JSON.stringify(selectedMove)}` : null,
    relevantOpening.length
      ? `Relevant grounded opening:\n${JSON.stringify(relevantOpening)}`
      : null,
    `Conversation:\n${transcript || "(nothing said yet)"}`,
  );
}

export async function writeInterviewQuestion(
  args: WriteInterviewQuestionArgs,
): Promise<string> {
  const result = await generateStructured({
    model: args.model,
    schema: interviewQuestionSchema,
    prompt: buildInterviewQuestionPrompt(args),
    stage: "dig",
    ...(args.temperature != null ? { temperature: args.temperature } : {}),
    ...(args.onEvent ? { onEvent: args.onEvent } : {}),
  });
  return result.question.trim();
}

function emptyAnalysis(knownFilled: readonly string[] | undefined, probes: readonly Probe[]): InterviewAnalysis {
  const known = new Set(probes.map((probe) => probe.id));
  return {
    filled: uniq((knownFilled ?? []).filter((id) => known.has(id))),
    openings: [],
    unresolved: [],
  };
}

function finishPlan(rationale: string): InterviewPlan {
  return {
    action: "finish",
    probeId: null,
    lensId: null,
    perspectiveMoveId: null,
    objective: null,
    rationale,
  };
}

/**
 * Three-stage interview agent. Use askNextQuestion() when one model call is the
 * right latency/cost tradeoff; use this when discovery quality matters enough
 * to separate evidence, strategy and wording.
 */
export async function runInterviewAgent(
  args: RunInterviewAgentArgs,
): Promise<AgentInterviewStep> {
  const asked = args.askedCount
    ?? args.transcript.filter((turn) => turn.role === "assistant").length;

  const stopped = args.userRequestedStop === true;
  const budgetReached = args.maxQuestions != null && asked >= args.maxQuestions;
  if (stopped || budgetReached) {
    const analysis = emptyAnalysis(args.knownFilled, args.probes);
    const plan = finishPlan(stopped ? "The person requested to stop." : "Question budget reached.");
    args.onEvent?.({
      type: "interview.ended",
      questionsAsked: asked,
      probesFilled: analysis.filled.length,
      probesPending: pendingProbes(args.probes, analysis.filled).length,
      at: Date.now(),
    });
    return {
      filled: analysis.filled,
      probeId: null,
      lensId: null,
      question: null,
      rationale: plan.rationale,
      done: true,
      analysis,
      plan,
    };
  }

  const analysis = await analyzeInterview({
    ...args,
    model: args.models?.analyst ?? args.model,
  });

  const plan = await planInterview({
    ...args,
    model: args.models?.director ?? args.model,
    analysis,
  });

  if (plan.action === "finish") {
    args.onEvent?.({
      type: "interview.ended",
      questionsAsked: asked,
      probesFilled: analysis.filled.length,
      probesPending: pendingProbes(args.probes, analysis.filled).length,
      at: Date.now(),
    });
    return {
      filled: analysis.filled,
      probeId: null,
      lensId: null,
      question: null,
      rationale: plan.rationale,
      done: true,
      analysis,
      plan,
    };
  }

  const question = await writeInterviewQuestion({
    ...args,
    model: args.models?.interviewer ?? args.model,
    analysis,
    plan,
  });

  const probeId = plan.action === "cover_probe" ? plan.probeId : null;
  const lensId = plan.action === "explore_lens" ? plan.lensId : null;
  args.onEvent?.({
    type: "question.asked",
    probeId,
    index: asked,
    rationale: plan.rationale,
    at: Date.now(),
  });

  return {
    filled: analysis.filled,
    probeId,
    lensId,
    question,
    rationale: plan.rationale,
    done: false,
    analysis,
    plan,
  };
}

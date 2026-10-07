// Evidence-grounded evaluation for interviews.
//
// This module intentionally brings no "good interview" rubric of its own.
// Products define the criteria. coreloop validates evidence, preserves missing
// scores as missing, and computes a weighted aggregate over what was actually
// judged.

import { z } from "zod";
import { generateStructured, type ModelLike } from "./generate.ts";
import { formatTranscript, visibleTurns, type TranscriptLabels, type TranscriptTurn } from "./transcript.ts";
import { joinSections } from "./text.ts";
import type { CoreloopEventHandler } from "./events.ts";

export type InterviewEvalCriterion = {
  id: string;
  description: string;
  /** Relative weight in overallScore. Default: 1. Non-positive values become 1. */
  weight?: number;
  /** If present and score is lower than this threshold, criterion id becomes a failure tag. */
  failureBelow?: number;
};

export type InterviewEvalArtifact = {
  /** "transcript" is reserved for the conversation itself. */
  id: string;
  text: string;
};

export type InterviewEvalEvidence = {
  /** "transcript" or one caller-supplied artifact id. */
  source: string;
  /** Required for transcript evidence; null for artifacts. */
  turnIndex: number | null;
  quote: string;
};

export type InterviewEvalScore = {
  criterionId: string;
  score: number;
  rationale: string;
  evidence: InterviewEvalEvidence[];
};

export type InterviewEvalReport = {
  scores: InterviewEvalScore[];
  /** Weighted mean over SCORED criteria only. null when no valid scores remain. */
  overallScore: number | null;
  failureTags: string[];
};

const evalEvidenceSchema = z.object({
  source: z.string().min(1).max(160),
  turnIndex: z.number().int().nonnegative().nullable(),
  quote: z.string().min(1).max(1200),
}).strict();

const evalScoreSchema = z.object({
  criterionId: z.string().min(1).max(160),
  score: z.number(),
  rationale: z.string().min(1).max(1600),
  evidence: z.array(evalEvidenceSchema).min(1).max(8),
}).strict();

export const interviewEvalOutputSchema = z.object({
  scores: z.array(evalScoreSchema).max(64),
}).strict();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function quoteMatches(haystack: string, quote: string): boolean {
  const needle = quote.trim();
  if (!needle) return false;
  return haystack.includes(needle)
    || collapseWhitespace(haystack).includes(collapseWhitespace(needle));
}

function validEvidence(
  evidence: InterviewEvalEvidence,
  transcript: readonly TranscriptTurn[],
  artifacts: readonly InterviewEvalArtifact[],
): boolean {
  if (evidence.source === "transcript") {
    if (evidence.turnIndex == null) return false;
    const turn = visibleTurns(transcript)[evidence.turnIndex];
    return !!turn && quoteMatches(turn.text, evidence.quote);
  }

  if (evidence.turnIndex != null) return false;
  const artifact = artifacts.find((item) => item.id === evidence.source);
  return !!artifact && quoteMatches(artifact.text, evidence.quote);
}

function criterionWeight(criterion: InterviewEvalCriterion): number {
  return typeof criterion.weight === "number"
    && Number.isFinite(criterion.weight)
    && criterion.weight > 0
    ? criterion.weight
    : 1;
}

/**
 * Normalize judge output. Unknown criteria and scores with no valid evidence are
 * dropped rather than defaulted.
 */
export function normalizeInterviewEvaluation(input: {
  raw: z.infer<typeof interviewEvalOutputSchema>;
  criteria: readonly InterviewEvalCriterion[];
  transcript: readonly TranscriptTurn[];
  artifacts?: readonly InterviewEvalArtifact[];
}): InterviewEvalReport {
  const artifacts = input.artifacts ?? [];
  const known = new Map(input.criteria.map((criterion) => [criterion.id, criterion]));
  const seen = new Set<string>();
  const scores: InterviewEvalScore[] = [];

  for (const item of input.raw.scores) {
    if (seen.has(item.criterionId)) continue;
    const criterion = known.get(item.criterionId);
    if (!criterion) continue;
    const evidence = item.evidence.filter((value) =>
      validEvidence(value, input.transcript, artifacts));
    if (!evidence.length) continue;
    seen.add(item.criterionId);
    scores.push({
      criterionId: item.criterionId,
      score: clamp01(item.score),
      rationale: item.rationale.trim(),
      evidence,
    });
  }

  let weighted = 0;
  let weights = 0;
  for (const score of scores) {
    const criterion = known.get(score.criterionId)!;
    const weight = criterionWeight(criterion);
    weighted += score.score * weight;
    weights += weight;
  }

  const byId = new Map(scores.map((score) => [score.criterionId, score]));
  const failureTags = input.criteria.flatMap((criterion) => {
    const score = byId.get(criterion.id);
    return score
      && typeof criterion.failureBelow === "number"
      && score.score < criterion.failureBelow
      ? [criterion.id]
      : [];
  });

  return {
    scores,
    overallScore: weights > 0 ? weighted / weights : null,
    failureTags,
  };
}

function formatCriteria(criteria: readonly InterviewEvalCriterion[]): string {
  return criteria.map((criterion) => [
    `- ${criterion.id}: ${criterion.description}`,
    ...(criterion.weight != null ? [`  weight: ${criterion.weight}`] : []),
  ].join("\n")).join("\n");
}

function formatArtifacts(artifacts: readonly InterviewEvalArtifact[]): string {
  if (!artifacts.length) return "(none)";
  return artifacts.map((artifact) =>
    `--- artifact:${artifact.id} ---\n${artifact.text}`).join("\n\n");
}

const EVAL_RULES = `You are evaluating an interview, not judging the worth of the
person answering it.

Rules:
- Score only the caller-provided criteria, from 0 to 1.
- A missing score is better than a fabricated score. Omit a criterion if the
  available evidence is insufficient.
- Every score needs at least one exact or whitespace-equivalent quote.
- Transcript evidence uses source "transcript" and the visible turn index shown
  below. Artifact evidence uses the artifact id and turnIndex null.
- Distinguish an idea introduced by the interviewer from an interpretation the
  person actually adopted.
- Do not reward bigger, more social, more altruistic, more ambitious or more
  eloquent answers unless a criterion explicitly asks you to.
- Judge whether the interviewer noticed and tested grounded opportunities, not
  whether the person ended with a grand conclusion.
- Do not infer hidden motives, diagnoses or life facts beyond the material.`;

export type BuildInterviewEvalPromptArgs = {
  criteria: readonly InterviewEvalCriterion[];
  transcript: readonly TranscriptTurn[];
  artifacts?: readonly InterviewEvalArtifact[];
  instructions?: string;
  labels?: TranscriptLabels;
};

export function buildInterviewEvalPrompt(args: BuildInterviewEvalPromptArgs): string {
  const transcript = formatTranscript(args.transcript, {
    labels: args.labels,
    numbered: true,
  });
  return joinSections(
    EVAL_RULES,
    args.instructions?.trim() || null,
    `Criteria:\n${formatCriteria(args.criteria)}`,
    `Transcript (visible-turn indexes):\n${transcript || "(nothing said yet)"}`,
    `Artifacts:\n${formatArtifacts(args.artifacts ?? [])}`,
  );
}

export type EvaluateInterviewArgs = BuildInterviewEvalPromptArgs & {
  model: ModelLike;
  temperature?: number;
  onEvent?: CoreloopEventHandler;
};

export async function evaluateInterview(
  args: EvaluateInterviewArgs,
): Promise<InterviewEvalReport> {
  const raw = await generateStructured({
    model: args.model,
    schema: interviewEvalOutputSchema,
    prompt: buildInterviewEvalPrompt(args),
    stage: "eval",
    ...(args.temperature != null ? { temperature: args.temperature } : {}),
    ...(args.onEvent ? { onEvent: args.onEvent } : {}),
  });
  return normalizeInterviewEvaluation({
    raw,
    criteria: args.criteria,
    transcript: args.transcript,
    artifacts: args.artifacts,
  });
}

// Scoring a transcript against a set of axes.
//
// The axes themselves belong to the product. What belongs here is the handling
// of what comes back: a model that skips an axis must leave it UNSCORED, never
// filled with a neutral default. A stored 3/5 that nobody measured is
// indistinguishable from one that was, and it silently corrupts every average
// built on top of it.

import { z } from "zod";
import { DigError } from "./errors.ts";

export type AxisDef = {
  key: string;
  label: string;
  description?: string;
};

export type AxisScore = {
  axisKey: string;
  label: string;
  score: number;
  maxScore: number;
};

export type AxisScoreOptions = {
  /** Top of the scale. Default: 5. */
  maxScore?: number;
};

/**
 * Schema for a scores array over the given axes. The length is deliberately
 * NOT pinned to the axis count: requiring all of them means one missing axis
 * fails validation and throws away the whole scoring run. Missing axes are
 * dropped by normalizeAxisScores instead.
 *
 * Returns a ZodObject so callers can `.extend({ comment: ... })`.
 */
export function axisScoresSchema(axes: readonly AxisDef[], options: AxisScoreOptions = {}) {
  if (axes.length === 0) {
    throw new DigError("invalid-contract", "Cannot build a scoring schema with no axes.");
  }
  const max = options.maxScore ?? 5;
  const keys = axes.map((a) => a.key) as [string, ...string[]];

  return z.object({
    scores: z
      .array(
        z.object({
          axisKey: z.enum(keys),
          score: z.number().int().min(1).max(max),
        }),
      )
      .min(1),
  });
}

export function clampScore(value: number, maxScore = 5): number {
  return Math.max(1, Math.min(maxScore, Math.round(value)));
}

/**
 * Resolve raw model scores against the axis definitions: keep axis order,
 * attach labels, clamp values, drop unknown keys and unscored axes.
 */
export function normalizeAxisScores(
  axes: readonly AxisDef[],
  raw: unknown,
  options: AxisScoreOptions = {},
): AxisScore[] {
  const max = options.maxScore ?? 5;
  const entries = Array.isArray(raw) ? raw : [];
  const byKey = new Map<string, number>();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { axisKey, score } = entry as { axisKey?: unknown; score?: unknown };
    if (typeof axisKey !== "string" || typeof score !== "number" || !Number.isFinite(score)) continue;
    byKey.set(axisKey, score);
  }

  return axes
    .filter((axis) => byKey.has(axis.key))
    .map((axis) => ({
      axisKey: axis.key,
      label: axis.label,
      score: clampScore(byKey.get(axis.key) as number, max),
      maxScore: max,
    }));
}

/** 0..1 position of a score on its scale, for meters and colour ramps. */
export function scoreRatio(score: number, maxScore = 5): number {
  if (maxScore <= 0) return 0;
  return Math.max(0, Math.min(1, score / maxScore));
}

export type ComparableScore = { axisKey: string; score: number };

export type AxisImprovement = {
  axisKey: string;
  label: string;
  from: number;
  to: number;
  delta: number;
  maxScore: number;
};

/**
 * The axis that improved most since a previous run, or null if none did.
 *
 * This is the judgement behind "offer to share this result": prompting after
 * every session trains people to ignore the prompt, so a product should only
 * offer when there is something to show. Growth, not absolute score — a person
 * scoring 2 who reached 3 has more to celebrate than one flat at 4.
 *
 * Axes missing from `previous` are skipped: a different mode scores different
 * axes, and comparing across them is meaningless. Ties go to the higher
 * current score.
 */
export function pickImprovedAxis(
  current: readonly AxisScore[] | null | undefined,
  previous: readonly ComparableScore[] | null | undefined,
): AxisImprovement | null {
  if (!current?.length || !previous?.length) return null;
  const previousByAxis = new Map(previous.map((s) => [s.axisKey, s.score]));

  let best: AxisImprovement | null = null;
  for (const score of current) {
    const from = previousByAxis.get(score.axisKey);
    if (typeof from !== "number") continue;
    const delta = score.score - from;
    if (delta <= 0) continue;
    if (!best || delta > best.delta || (delta === best.delta && score.score > best.to)) {
      best = {
        axisKey: score.axisKey,
        label: score.label,
        from,
        to: score.score,
        delta,
        maxScore: score.maxScore,
      };
    }
  }
  return best;
}

/** Numbered axis list for a prompt: "1. Label (key: logic) — description". */
export function formatAxisList(axes: readonly AxisDef[]): string {
  return axes
    .map((a, i) => `${i + 1}. ${a.label} (key: ${a.key})${a.description ? ` — ${a.description}` : ""}`)
    .join("\n");
}

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

/** Numbered axis list for a prompt: "1. Label (key: logic) — description". */
export function formatAxisList(axes: readonly AxisDef[]): string {
  return axes
    .map((a, i) => `${i + 1}. ${a.label} (key: ${a.key})${a.description ? ` — ${a.description}` : ""}`)
    .join("\n");
}

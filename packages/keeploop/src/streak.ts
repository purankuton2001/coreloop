// Consecutive days, with a way to rest.
//
// A streak is the cheapest retention mechanic and the easiest to get wrong in
// the direction that hurts: a person who missed one day after forty loses
// everything, and the product loses the person. So a day has three effects,
// not two. It can COUNT (the person did the thing), KEEP (they rested — the
// streak survives but does not grow), or BREAK. What maps a product's own day
// record onto those three is the product's rule: a "win" counts, a "freeze"
// keeps, an unreported day breaks. This file never sees the record.
//
// Two things the product does not have to decide:
//   - Today is not over. A day with no entry yet is pending, not broken, so a
//     morning reminder can still say "your 12 days" instead of "your 0 days".
//   - A rest day never adds. Otherwise resting becomes the fastest way to grow.

import { addDays, diffDays, type DayKey } from "./days.ts";

export type StreakEffect = "count" | "keep" | "break";

export type StreakEntry = { day: DayKey; effect: StreakEffect };

export type StreakOptions = {
  /**
   * Whether a day with no entry between two entries breaks the streak.
   * Default true — the natural reading of "consecutive". A product that
   * writes an entry for every day (settling missed days as "break" itself)
   * can turn it off and keep the gap semantics it already has.
   */
  gapBreaks?: boolean;
};

export type StreakView = {
  /** Days in the streak as of `through`, treating a missing `through` as still open. */
  current: number;
  /** The streak as it stood at the end of the day before `through` — what is at stake today. */
  previous: number;
  /** Longest run on record, including the current one. */
  longest: number;
  /** What `through` itself recorded, or "pending" when nothing has yet. */
  today: StreakEffect | "pending";
  /** There is a streak to lose and today has not yet saved it. */
  atRisk: boolean;
};

const RANK: Record<StreakEffect, number> = { count: 3, keep: 2, break: 1 };

/** One entry per day; the strongest effect wins when a day was recorded twice. */
function normalize(entries: readonly StreakEntry[], through: DayKey): StreakEntry[] {
  const byDay = new Map<DayKey, StreakEffect>();
  for (const entry of entries) {
    if (entry.day > through) continue;
    const seen = byDay.get(entry.day);
    if (!seen || RANK[entry.effect] > RANK[seen]) byDay.set(entry.day, entry.effect);
  }
  return [...byDay].map(([day, effect]) => ({ day, effect })).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

function run(sorted: readonly StreakEntry[], through: DayKey, gapBreaks: boolean, pendingOk: boolean) {
  let current = 0;
  let longest = 0;
  let last: DayKey | null = null;
  for (const entry of sorted) {
    if (entry.day > through) break;
    if (gapBreaks && last !== null && diffDays(last, entry.day) > 1) current = 0;
    if (entry.effect === "count") current++;
    else if (entry.effect === "break") current = 0;
    longest = Math.max(longest, current);
    last = entry.day;
  }
  if (gapBreaks && last !== null && last < through) {
    // No entry on `through` itself. Pending if only today is missing; broken if
    // yesterday is missing too.
    if (diffDays(last, through) > (pendingOk ? 1 : 0)) current = 0;
  }
  return { current, longest };
}

export function streak(entries: readonly StreakEntry[], through: DayKey, options: StreakOptions = {}): StreakView {
  const gapBreaks = options.gapBreaks ?? true;
  const sorted = normalize(entries, through);
  const now = run(sorted, through, gapBreaks, true);
  const before = run(sorted, addDays(through, -1), gapBreaks, false);
  const today = sorted.find((e) => e.day === through)?.effect ?? "pending";
  return {
    current: now.current,
    previous: before.current,
    longest: now.longest,
    today,
    atRisk: before.current > 0 && today !== "count" && today !== "keep",
  };
}

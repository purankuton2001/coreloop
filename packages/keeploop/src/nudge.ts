// The one message worth sending today, or none.
//
// A retention notification is a withdrawal from a small account. Send one
// every evening and they are muted by Thursday; send two in one evening and
// the second one is the reason. So this file decides at most one per day, in
// a fixed order of what matters most to the person right now, and returns a
// REASON, never text. The words are the product's voice; the restraint is
// shared.
//
// Order, most urgent first:
//   1. A streak about to end tonight — with the league situation attached if
//      there is one, because that is one message, not two.
//   2. A league change: in the demotion zone, or overtaken since last told.
//   3. Coming back after a rest day, or after a broken day. Only while today
//      is still open — once it is decided there is nothing to come back to.

import type { Zone } from "./league.ts";

export type TodayState =
  /** Counted or kept — today is safe. */
  | "done"
  /** Nothing decided yet; the person can still act. */
  | "pending"
  /** Decided against, and final. */
  | "missed";

export type NudgeSignals = {
  streak: {
    /** The streak at stake — as of yesterday. */
    previous: number;
    today: TodayState;
    /** What yesterday recorded, when known. */
    yesterday?: "count" | "keep" | "break" | null;
  };
  /** The member's live league standing, if in a league. */
  league?: { period: string; rank: number; zone: Zone } | null;
  /** The standing the person was last told about, to notice a drop. */
  lastTold?: { period: string; rank: number } | null;
};

export type LeagueChange =
  | { kind: "demotion"; rank: number }
  | { kind: "drop"; from: number; to: number };

export type Nudge =
  | { reason: "streak-at-risk"; days: number; league: LeagueChange | null }
  | { reason: "league"; league: LeagueChange; todayDone: boolean }
  | { reason: "after-keep" }
  | { reason: "after-break" };

export function pickNudge(signals: NudgeSignals): Nudge | null {
  const { streak, league, lastTold } = signals;
  const change: LeagueChange | null = !league
    ? null
    : league.zone === "demotion"
      ? { kind: "demotion", rank: league.rank }
      : lastTold && lastTold.period === league.period && league.rank > lastTold.rank
        ? { kind: "drop", from: lastTold.rank, to: league.rank }
        : null;

  if (streak.previous > 0 && streak.today !== "done") return { reason: "streak-at-risk", days: streak.previous, league: change };
  if (change) return { reason: "league", league: change, todayDone: streak.today === "done" };
  if (streak.today === "pending" && streak.yesterday === "keep") return { reason: "after-keep" };
  if (streak.today === "pending" && streak.yesterday === "break") return { reason: "after-break" };
  return null;
}

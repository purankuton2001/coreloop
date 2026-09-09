// Who is ahead, without lying about ties.
//
// Competition ranking (1, 2, 2, 4): a tie shares the rank and the next rank
// skips. The alternative — breaking ties by an id so every row has its own
// number — turns "we did the same" into "you lost by your user id", and people
// can tell. Ties are only ever broken for display ORDER, never for rank.

export type Ranked<T> = T & { rank: number; tied: boolean };

/** A score is a number, or several compared in order (streak first, then win rate). */
export type Score = number | readonly number[];

export function compareScores(a: Score, b: Score): number {
  const as = typeof a === "number" ? [a] : a;
  const bs = typeof b === "number" ? [b] : b;
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const d = (as[i] ?? 0) - (bs[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export type RankOptions<T> = {
  /** Display order among equal scores. Does not affect rank. */
  tiebreak?: (a: T, b: T) => number;
};

/** Rows in descending score, each with its competition rank. Input is not mutated. */
export function rank<T>(rows: readonly T[], score: (row: T) => Score, options: RankOptions<T> = {}): Ranked<T>[] {
  const scored = rows.map((row) => ({ row, score: score(row) }));
  scored.sort((a, b) => compareScores(b.score, a.score) || (options.tiebreak?.(a.row, b.row) ?? 0));
  const ranked: Ranked<T>[] = [];
  for (let i = 0; i < scored.length; i++) {
    const entry = scored[i]!;
    const previous = scored[i - 1];
    const next = scored[i + 1];
    const rankValue = previous && compareScores(previous.score, entry.score) === 0 ? ranked[i - 1]!.rank : i + 1;
    const tied =
      (previous != null && compareScores(previous.score, entry.score) === 0) ||
      (next != null && compareScores(next.score, entry.score) === 0);
    ranked.push({ ...entry.row, rank: rankValue, tied });
  }
  return ranked;
}

/** One row's competition rank among `rows` — 1 + how many score strictly higher. */
export function rankOf<T>(rows: readonly T[], score: (row: T) => Score, own: Score): number {
  return 1 + rows.filter((row) => compareScores(score(row), own) > 0).length;
}

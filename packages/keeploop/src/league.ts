// A league: a small group, a fixed period, and a ladder to climb or fall down.
//
// A global leaderboard tells almost everybody they are nowhere. A league puts
// twenty people of the same tier in one room for one week, so the person in
// 4th place is genuinely close to 3rd, and the person in 18th genuinely has
// something to defend. At the end of the period the top few go up a tier, the
// bottom few go down, and everyone gets a new room.
//
// What this file does not know: what a point is, when the period ends, who is
// allowed in, or what the tiers are called. The product scores its members and
// keys its periods; this file only keeps the rooms fair.
//
// Fair means:
//   - Ties share a rank and a fate. Two people on 7 points are both promoted
//     or both not — a boundary never falls between equals.
//   - A room stays a room. Membership is appended, never reshuffled, so a
//     person's rivals do not change under them mid-week.
//   - The ladder does not move with fewer than five. Promoting 1 of 3 is not
//     a competition, it is a coin toss with a ceremony.

export type Zone = "promotion" | "stay" | "demotion";

/** The part of a member this file manages. Products add their own identity fields. */
export type LeagueMember = {
  /** 0 = lowest tier. */
  tier: number;
  /** Room within the tier. */
  group: number;
  /** ISO time. Earlier joiners rank first among equals and enroll first. */
  joinedAt: string;
};

export type Standing = {
  rank: number;
  zone: Zone;
  /** Tier at the start of the next period, if the period closed now. */
  nextTier: number;
};

export type LeagueRow<M extends LeagueMember> = M & { score: number } & Standing;

export type LeaguePeriod<M extends LeagueMember> = {
  /** The period key — a week key, usually. Periods compare as strings. */
  period: string;
  members: M[];
  /** Frozen standings, set when the period closes. */
  results?: LeagueRow<M>[];
  closedAt?: string;
};

export type LeagueOptions<M extends LeagueMember> = {
  /** How many tiers the ladder has. */
  tiers: number;
  /** Identity of a member across periods. */
  key: (member: M) => string;
  /** Room size. Default 20. */
  groupSize?: number;
  /**
   * How many move up and how many down in a room of `size`. Default: none
   * under five, otherwise a quarter of the room, at most five.
   */
  slots?: (size: number) => number;
};

/**
 * What a member scored this period. `null` means the member has left the
 * league — they keep their seat (a seat freed mid-week would move everybody
 * else) but are not ranked.
 */
export type ScoreMember<M extends LeagueMember> = (member: M) => number | null;

export type LeagueView<M extends LeagueMember> = {
  period: string;
  self: LeagueRow<M>;
  /** Everyone in the same room, ranked. */
  rows: LeagueRow<M>[];
  /** Points needed to pass the next person up, or null at the top. */
  pointsToNext: number | null;
  /** How the last closed period ended for this member. */
  previous: { period: string; rank: number; zone: Zone; tier: number; nextTier: number } | null;
};

export type League<M extends LeagueMember> = {
  /** Rank one room. Exported for tests and for products that keep their own rooms. Extra fields on a row survive. */
  rankRoom<R extends M & { score: number }>(rows: readonly R[]): (R & Standing)[];
  /**
   * Seat every candidate not already in the period, in the order given. A
   * candidate's tier is where its last closed period sent it, or the bottom.
   * Returns how many were added. Does nothing to a closed period.
   */
  enroll(period: LeaguePeriod<M>, candidates: readonly Omit<M, "tier" | "group">[], history: readonly LeaguePeriod<M>[]): number;
  /** Live standings for every room in the period. */
  standings(period: LeaguePeriod<M>, score: ScoreMember<M>): LeagueRow<M>[];
  /** Freeze the standings. Returns false if already closed. */
  close(period: LeaguePeriod<M>, score: ScoreMember<M>, closedAt: string): boolean;
  /** One member's room, as they should see it. Null if they are not seated or not ranked. */
  describe(period: LeaguePeriod<M>, key: string, score: ScoreMember<M>, history?: readonly LeaguePeriod<M>[]): LeagueView<M> | null;
};

const DEFAULT_GROUP_SIZE = 20;
const defaultSlots = (size: number) => (size >= 5 ? Math.min(5, Math.floor(size / 4)) : 0);

export function createLeague<M extends LeagueMember>(options: LeagueOptions<M>): League<M> {
  const { tiers, key } = options;
  const groupSize = options.groupSize ?? DEFAULT_GROUP_SIZE;
  const slots = options.slots ?? defaultSlots;
  if (!(tiers >= 1)) throw new Error("keeploop: a league needs at least one tier");

  const lastResult = (history: readonly LeaguePeriod<M>[], before: string, id: string) =>
    [...history]
      .filter((h) => h.period < before && h.closedAt)
      .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0))
      .flatMap((h) => (h.results ?? []).map((r) => ({ ...r, period: h.period })))
      .find((r) => key(r) === id);

  const rankRoom = <R extends M & { score: number }>(rows: readonly R[]): (R & Standing)[] => {
    const sorted = [...rows].sort(
      (a, b) => b.score - a.score || a.joinedAt.localeCompare(b.joinedAt) || key(a).localeCompare(key(b)),
    );
    const moving = slots(sorted.length);
    return sorted.map((row) => {
      const better = sorted.filter((r) => r.score > row.score).length;
      const worse = sorted.filter((r) => r.score < row.score).length;
      // Zones are decided by strictly-better and strictly-worse counts, so a tie
      // straddling a boundary is treated as one block.
      const zone: Zone =
        moving && row.score > 0 && better < moving && row.tier < tiers - 1
          ? "promotion"
          : moving && worse < moving && better > 0 && row.tier > 0
            ? "demotion"
            : "stay";
      return { ...row, rank: better + 1, zone, nextTier: row.tier + (zone === "promotion" ? 1 : zone === "demotion" ? -1 : 0) };
    });
  };

  const standings: League<M>["standings"] = (period, score) => {
    const scored = period.members.flatMap((m) => {
      const s = score(m);
      return s == null ? [] : [{ ...m, score: s }];
    });
    return [...new Set(scored.map((r) => r.group))].flatMap((group) => rankRoom(scored.filter((r) => r.group === group)));
  };

  return {
    rankRoom,
    standings,

    enroll(period, candidates, history) {
      if (period.closedAt) return 0;
      let added = 0;
      for (const candidate of candidates) {
        const id = key(candidate as M);
        if (period.members.some((m) => key(m) === id)) continue;
        const tier = lastResult(history, period.period, id)?.nextTier ?? 0;
        const rooms = [...new Set(period.members.filter((m) => m.tier === tier).map((m) => m.group))];
        const group =
          rooms.find((g) => period.members.filter((m) => m.group === g).length < groupSize) ??
          Math.max(-1, ...period.members.map((m) => m.group)) + 1;
        period.members.push({ ...candidate, tier, group } as M);
        added++;
      }
      return added;
    },

    close(period, score, closedAt) {
      if (period.closedAt) return false;
      period.results = standings(period, score);
      period.closedAt = closedAt;
      return true;
    },

    describe(period, id, score, history = []) {
      const seat = period.members.find((m) => key(m) === id);
      if (!seat) return null;
      const rows = standings(period, score).filter((r) => r.group === seat.group);
      const self = rows.find((r) => key(r) === id);
      if (!self) return null;
      const last = lastResult(history, period.period, id);
      const next = rows.filter((r) => r.score > self.score).at(-1);
      return {
        period: period.period,
        self,
        rows,
        pointsToNext: next ? next.score - self.score + 1 : null,
        previous: last ? { period: last.period, rank: last.rank, zone: last.zone, tier: last.tier, nextTier: last.nextTier } : null,
      };
    },
  };
}

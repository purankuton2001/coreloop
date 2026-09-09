import test from "node:test";
import assert from "node:assert/strict";
import { createLeague, type LeagueMember, type LeaguePeriod } from "../src/league.ts";

type Member = LeagueMember & { owner: string; seasonId: string };
const league = createLeague<Member>({ tiers: 5, key: (m) => m.owner + ":" + m.seasonId });
const joined = "2026-09-01T00:00:00+09:00";
const candidate = (id: string) => ({ owner: id, seasonId: id, joinedAt: joined });

test("rooms cap at 20, seats are appended once, and enrollment order is stable", () => {
  const period: LeaguePeriod<Member> = { period: "2026-09-07", members: [] };
  const players = Array.from({ length: 41 }, (_, i) => candidate("p" + String(i).padStart(2, "0")));
  assert.equal(league.enroll(period, players, []), 41);
  assert.deepEqual([...new Set(period.members.map((m) => m.group))].map((g) => period.members.filter((m) => m.group === g).length), [20, 20, 1]);
  const seats = JSON.stringify(period.members);
  assert.equal(league.enroll(period, [...players].reverse(), []), 0);
  assert.equal(JSON.stringify(period.members), seats);
  const view = league.describe(period, "p00:p00", () => 0)!;
  assert.equal(view.rows.length, 20);
  assert.equal(view.self.rank, 1);
});

test("ties share rank and zone; fewer than five never move", () => {
  const rows = [7, 7, 5, 4, 3, 2, 0, 0].map((score, i) => ({ ...candidate(String(i)), tier: 1, group: 0, score }));
  const ranked = league.rankRoom(rows);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 1, 3, 4, 5, 6, 7, 7]);
  assert.deepEqual(ranked.map((r) => r.zone), ["promotion", "promotion", "stay", "stay", "stay", "stay", "demotion", "demotion"]);
  assert.deepEqual(ranked.map((r) => r.nextTier), [2, 2, 1, 1, 1, 1, 0, 0]);
  assert.ok(league.rankRoom(rows.slice(0, 4)).every((r) => r.zone === "stay"));
});

test("the bottom tier cannot be demoted, the top cannot be promoted, and zero points never promote", () => {
  const room = (tier: number) => [5, 4, 3, 2, 1].map((score, i) => ({ ...candidate(String(i)), tier, group: 0, score }));
  assert.deepEqual(league.rankRoom(room(0)).map((r) => r.zone), ["promotion", "stay", "stay", "stay", "stay"]);
  assert.deepEqual(league.rankRoom(room(4)).map((r) => r.zone), ["stay", "stay", "stay", "stay", "demotion"]);
  const idle = [0, 0, 0, 0, 0].map((score, i) => ({ ...candidate(String(i)), tier: 1, group: 0, score }));
  assert.ok(league.rankRoom(idle).every((r) => r.zone === "stay"));
});

test("closing freezes results, the next period seats members at their new tier, and members who left are unranked", () => {
  const first: LeaguePeriod<Member> = { period: "2026-09-07", members: [] };
  league.enroll(first, [candidate("a"), candidate("b"), candidate("c"), candidate("d"), candidate("e"), candidate("f")], []);
  const score = (m: Member) => (m.owner === "a" ? 3 : m.owner === "e" ? null : 1);
  assert.equal(league.close(first, score, "2026-09-14T00:00:00Z"), true);
  assert.equal(league.close(first, score, "later"), false);
  assert.equal(first.results!.length, 5);
  assert.equal(first.results!.find((r) => r.owner === "a")!.zone, "promotion");
  const second: LeaguePeriod<Member> = { period: "2026-09-14", members: [] };
  league.enroll(second, [candidate("a"), candidate("b")], [first]);
  assert.equal(second.members.find((m) => m.owner === "a")!.tier, 1);
  assert.equal(second.members.find((m) => m.owner === "b")!.tier, 0);
  const view = league.describe(second, "a:a", () => 0, [first])!;
  assert.deepEqual(view.previous, { period: "2026-09-07", rank: 1, zone: "promotion", tier: 0, nextTier: 1 });
  assert.equal(league.describe(second, "e:e", () => 0), null);
  assert.equal(league.enroll(first, [candidate("z")], []), 0);
});

test("points to next is the gap to the nearest better score plus one", () => {
  const period: LeaguePeriod<Member> = { period: "2026-09-07", members: [] };
  league.enroll(period, [candidate("a"), candidate("b"), candidate("c")], []);
  const scores: Record<string, number> = { a: 5, b: 2, c: 5 };
  const view = league.describe(period, "b:b", (m) => scores[m.owner]!)!;
  assert.equal(view.pointsToNext, 4);
  assert.equal(league.describe(period, "a:a", (m) => scores[m.owner]!)!.pointsToNext, null);
});

test("a tiebreak only orders equals for display; rank and zone are untouched", () => {
  const ordered = createLeague<Member>({ tiers: 5, key: (m) => m.owner + ":" + m.seasonId, tiebreak: (a, b) => a.seasonId.localeCompare(b.seasonId) });
  const rows = [
    { owner: "b", seasonId: "s1", joinedAt: joined, tier: 0, group: 0, score: 1 },
    { owner: "a", seasonId: "s2", joinedAt: joined, tier: 0, group: 0, score: 1 },
  ];
  assert.deepEqual(league.rankRoom(rows).map((r) => r.seasonId), ["s2", "s1"]);
  assert.deepEqual(ordered.rankRoom(rows).map((r) => r.seasonId), ["s1", "s2"]);
  assert.deepEqual(ordered.rankRoom(rows).map((r) => r.rank), [1, 1]);
});

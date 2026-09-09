import test from "node:test";
import assert from "node:assert/strict";
import { rank, rankOf } from "../src/ranking.ts";

test("ties share a rank and the next rank skips", () => {
  const rows = [7, 7, 5, 4, 3, 2, 0, 0].map((xp, i) => ({ id: String(i), xp }));
  const ranked = rank(rows, (r) => r.xp);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 1, 3, 4, 5, 6, 7, 7]);
  assert.deepEqual(ranked.map((r) => r.tied), [true, true, false, false, false, false, true, true]);
  assert.deepEqual(rows.map((r) => r.xp), [7, 7, 5, 4, 3, 2, 0, 0]);
});

test("tiebreak orders equals for display without changing their rank", () => {
  const rows = [{ id: "b", xp: 5 }, { id: "a", xp: 5 }];
  const ranked = rank(rows, (r) => r.xp, { tiebreak: (x, y) => x.id.localeCompare(y.id) });
  assert.deepEqual(ranked.map((r) => r.id), ["a", "b"]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 1]);
});

test("multi-part scores compare in order", () => {
  const rows = [
    { id: "x", streak: 3, winRate: 50 },
    { id: "y", streak: 3, winRate: 80 },
    { id: "z", streak: 4, winRate: 10 },
  ];
  assert.deepEqual(rank(rows, (r) => [r.streak, r.winRate]).map((r) => r.id), ["z", "y", "x"]);
  assert.equal(rankOf(rows, (r) => [r.streak, r.winRate], [3, 80]), 2);
  assert.equal(rankOf(rows, (r) => [r.streak, r.winRate], [3, 50]), 3);
  assert.equal(rankOf(rows, (r) => [r.streak, r.winRate], [9, 0]), 1);
});

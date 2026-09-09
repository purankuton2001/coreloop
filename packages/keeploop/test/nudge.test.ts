import test from "node:test";
import assert from "node:assert/strict";
import { pickNudge } from "../src/nudge.ts";

test("a streak at risk comes first and carries the league change with it", () => {
  assert.deepEqual(pickNudge({ streak: { previous: 7, today: "pending" } }), { reason: "streak-at-risk", days: 7, league: null });
  assert.deepEqual(
    pickNudge({ streak: { previous: 7, today: "missed" }, league: { period: "w", rank: 18, zone: "demotion" } }),
    { reason: "streak-at-risk", days: 7, league: { kind: "demotion", rank: 18 } },
  );
});

test("league changes speak only when there is something new to say", () => {
  const league = { period: "w", rank: 5, zone: "stay" as const };
  assert.equal(pickNudge({ streak: { previous: 0, today: "done" }, league }), null);
  assert.equal(pickNudge({ streak: { previous: 0, today: "done" }, league, lastTold: { period: "w", rank: 5 } }), null);
  assert.equal(pickNudge({ streak: { previous: 0, today: "done" }, league, lastTold: { period: "v", rank: 2 } }), null);
  assert.deepEqual(
    pickNudge({ streak: { previous: 0, today: "done" }, league, lastTold: { period: "w", rank: 2 } }),
    { reason: "league", league: { kind: "drop", from: 2, to: 5 }, todayDone: true },
  );
  assert.deepEqual(
    pickNudge({ streak: { previous: 0, today: "pending" }, league: { ...league, zone: "demotion" }, lastTold: { period: "w", rank: 2 } }),
    { reason: "league", league: { kind: "demotion", rank: 5 }, todayDone: false },
  );
});

test("comebacks are offered only while today is still open", () => {
  assert.deepEqual(pickNudge({ streak: { previous: 0, today: "pending", yesterday: "keep" } }), { reason: "after-keep" });
  assert.deepEqual(pickNudge({ streak: { previous: 0, today: "pending", yesterday: "break" } }), { reason: "after-break" });
  assert.equal(pickNudge({ streak: { previous: 0, today: "missed", yesterday: "break" } }), null);
  assert.equal(pickNudge({ streak: { previous: 0, today: "done", yesterday: "keep" } }), null);
  assert.equal(pickNudge({ streak: { previous: 0, today: "pending", yesterday: "count" } }), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { addDays, dayKey, diffDays, isDayKey, weekKey } from "../src/days.ts";

test("day arithmetic is exact across month, year and DST boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(diffDays("2026-03-28", "2026-03-30"), 2);
  assert.equal(diffDays("2026-03-30", "2026-03-28"), -2);
});

test("week keys start on Monday by default and can start elsewhere", () => {
  assert.equal(weekKey("2026-09-09"), "2026-09-07");
  assert.equal(weekKey("2026-09-07"), "2026-09-07");
  assert.equal(weekKey("2026-09-13"), "2026-09-07");
  assert.equal(weekKey("2026-09-13", 0), "2026-09-13");
  assert.equal(weekKey("2026-09-09", 0), "2026-09-06");
});

test("day keys are cut in the product's zone, UTC when none", () => {
  const at = new Date("2026-09-08T20:00:00Z");
  assert.equal(dayKey(at), "2026-09-08");
  assert.equal(dayKey(at, "Asia/Tokyo"), "2026-09-09");
  assert.ok(isDayKey("2026-02-28"));
  assert.ok(!isDayKey("2026-2-28"));
  assert.ok(!isDayKey("2026-13-01"));
  assert.throws(() => addDays("today", 1), /day key/);
});

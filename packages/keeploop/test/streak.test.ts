import test from "node:test";
import assert from "node:assert/strict";
import { streak, type StreakEntry } from "../src/streak.ts";

const count = (...days: string[]): StreakEntry[] => days.map((day) => ({ day, effect: "count" }));

test("a missing today is pending, a missing yesterday is a break", () => {
  assert.equal(streak(count("2026-09-08", "2026-09-07", "2026-09-07", "2026-09-06"), "2026-09-08").current, 3);
  const open = streak(count("2026-09-07", "2026-09-06"), "2026-09-08");
  assert.equal(open.current, 2);
  assert.equal(open.previous, 2);
  assert.equal(open.today, "pending");
  assert.equal(open.atRisk, true);
  const gone = streak(count("2026-09-06"), "2026-09-08");
  assert.equal(gone.current, 0);
  assert.equal(gone.previous, 0);
  assert.equal(gone.atRisk, false);
  assert.equal(streak(count("2025-12-31", "2025-12-30"), "2026-01-01").current, 2);
});

test("a kept day preserves the count without adding, a break resets it", () => {
  const entries: StreakEntry[] = [
    { day: "2026-09-01", effect: "count" },
    { day: "2026-09-02", effect: "count" },
    { day: "2026-09-03", effect: "keep" },
    { day: "2026-09-04", effect: "count" },
  ];
  const view = streak(entries, "2026-09-04");
  assert.equal(view.current, 3);
  assert.equal(view.today, "count");
  assert.equal(view.atRisk, false);
  const broken = streak([...entries, { day: "2026-09-05", effect: "break" }], "2026-09-05");
  assert.equal(broken.current, 0);
  assert.equal(broken.previous, 3);
  assert.equal(broken.atRisk, true);
  assert.equal(broken.longest, 3);
});

test("the strongest effect wins when a day is recorded twice", () => {
  const view = streak([{ day: "2026-09-01", effect: "break" }, { day: "2026-09-01", effect: "count" }], "2026-09-01");
  assert.equal(view.current, 1);
  assert.equal(view.today, "count");
});

test("products that settle every day themselves can keep gaps from breaking", () => {
  const sparse = count("2026-09-01", "2026-09-05");
  assert.equal(streak(sparse, "2026-09-05").current, 1);
  assert.equal(streak(sparse, "2026-09-05", { gapBreaks: false }).current, 2);
  assert.equal(streak(sparse, "2026-09-09", { gapBreaks: false }).previous, 2);
});

test("entries after the day asked about are ignored", () => {
  const view = streak(count("2026-09-01", "2026-09-02", "2026-09-03"), "2026-09-02");
  assert.equal(view.current, 2);
  assert.equal(view.longest, 2);
});

import test from "node:test";
import assert from "node:assert/strict";
import { dailyReward, grant, levelProgress, type Ledger } from "../src/progress.ts";

test("grants are idempotent by key and capped, even after the balance was spent", () => {
  const ledger: Ledger = { balance: 0, grants: [] };
  assert.equal(grant(ledger, "wins:7"), true);
  assert.equal(grant(ledger, "wins:7"), false);
  assert.equal(ledger.balance, 1);
  assert.equal(grant(ledger, "paid", 2, { cap: 2 }), true);
  assert.equal(ledger.balance, 2);
  ledger.balance--;
  assert.equal(grant(ledger, "paid", 2, { cap: 2 }), false);
  assert.equal(ledger.balance, 1);
});

test("daily rewards stop paying at the limit", () => {
  const rule = { points: 15, limit: 2 };
  assert.equal(dailyReward(rule, 0), 15);
  assert.equal(dailyReward(rule, 1), 15);
  assert.equal(dailyReward(rule, 2), 0);
});

test("level boundaries preserve accumulated XP without progress overflow", () => {
  for (const [xp, level] of [[0, 1], [99, 1], [100, 2], [299, 2], [300, 3], [600, 4], [1000, 5]] as const) {
    const result = levelProgress(xp);
    assert.equal(result.level, level);
    assert.ok(result.progress >= 0 && result.progress < 1);
    assert.ok(result.levelXp <= xp && xp < result.nextLevelXp);
  }
  assert.equal(levelProgress(-5).level, 1);
  assert.equal(levelProgress(50, { step: 50 }).level, 2);
});

// Things a person accumulates: grants, points, levels.
//
// The arithmetic is trivial. What is worth encoding is idempotence, because
// every grant in a retention loop is reached from more than one path — a
// webhook that retries, a daily job that runs twice, a settle that re-reads
// the same day. A reward granted on every path is a reward granted twice, and
// a "7 wins" freeze that arrives every time the count is re-checked is not a
// reward, it is a bug the person notices first.
//
// So a grant has a key, and the ledger remembers keys, not amounts.

export type Ledger = {
  balance: number;
  /** Keys already granted. The dedup record — never trimmed. */
  grants: string[];
};

export type GrantOptions = {
  /** Balance never exceeds this. Extra is dropped, not banked — the key is still recorded. */
  cap?: number;
};

/**
 * Add `amount` to the ledger under `key`, once. Returns whether anything
 * happened. A second call with the same key is a no-op even after the balance
 * was spent — that is the point.
 */
export function grant(ledger: Ledger, key: string, amount = 1, options: GrantOptions = {}): boolean {
  if (ledger.grants.includes(key)) return false;
  ledger.grants.push(key);
  const next = ledger.balance + amount;
  ledger.balance = options.cap == null ? next : Math.min(options.cap, next);
  return true;
}

export type RewardRule = {
  /** Points one occurrence is worth. */
  points: number;
  /** Occurrences per day that still pay. */
  limit: number;
};

/**
 * Points for the next occurrence of an action today, given how many already
 * paid. Zero once the daily limit is reached. The dedup of the occurrence
 * itself (same action, same source) is the product's — it usually lives in a
 * unique index.
 */
export function dailyReward(rule: RewardRule, earnedToday: number): number {
  return earnedToday < rule.limit ? rule.points : 0;
}

export type LevelProgress = {
  level: number;
  /** XP where this level began. */
  levelXp: number;
  /** XP where the next one begins. */
  nextLevelXp: number;
  /** 0 ≤ progress < 1 through the current level. */
  progress: number;
};

export type LevelOptions = {
  /**
   * How much more XP each level needs than the one before. Level 2 needs
   * `step`, level 3 needs `2 · step` more, and so on — a curve that keeps
   * early levels quick and later ones earned. Default 100.
   */
  step?: number;
};

/** Level 1 at 0 XP. XP never decays, so this never goes down. */
export function levelProgress(xp: number, options: LevelOptions = {}): LevelProgress {
  const step = options.step ?? 100;
  const safe = Math.max(0, xp);
  // Cumulative XP to reach level n is (step / 2) · n · (n − 1); invert it.
  const level = Math.floor((1 + Math.sqrt(1 + (8 * safe) / step)) / 2);
  const levelXp = (step / 2) * level * (level - 1);
  const nextLevelXp = (step / 2) * level * (level + 1);
  return { level, levelXp, nextLevelXp, progress: (safe - levelXp) / (nextLevelXp - levelXp) };
}

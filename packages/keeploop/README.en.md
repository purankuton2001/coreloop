# keeploop

**Retention mechanics for products people come back to every day.** Streaks with rest days, capped grants, XP and levels, rankings that are honest about ties, weekly leagues with promotion and demotion, and the one nudge worth sending today.

It brings no copy, no storage and no delivery. What counts as a point, which time zone cuts a day, and which channel carries a notification are the product's decisions. This package holds only the **fairness and restraint** that sit on top.

[日本語](README.md)

```sh
npm install keeploop
```

Zero dependencies. Runs in Node and in the browser.

## What is inside

| Module | Functions | The decision it holds |
|---|---|---|
| `days` | `dayKey` `addDays` `diffDays` `weekKey` | Days are `YYYY-MM-DD` strings; the product cuts them in its own zone |
| `streak` | `streak(entries, through)` | A day can `count`, `keep` or `break`. A missing today is pending, not broken. Rest preserves, never adds |
| `progress` | `grant` `dailyReward` `levelProgress` | Grants are idempotent by key and capped. Daily limits. A level curve that gets 100 XP heavier per level |
| `ranking` | `rank` `rankOf` | Competition ranking (1, 2, 2, 4). Ties are never split by an id |
| `league` | `createLeague({ tiers, key })` | Rooms of 20, one period, top and bottom quarter (max 5) move. Nothing moves under five. Ties share a fate |
| `nudge` | `pickNudge(signals)` | One per day. Streak at risk > league change > the day after a rest or a miss. Returns a reason, never text |

## Usage

```ts
import { streak, grant, rank, createLeague, pickNudge, weekKey } from "keeploop";

// Streak: map your own day records onto three effects.
const view = streak(days.map((d) => ({ day: d.date, effect: d.won ? "count" : d.rested ? "keep" : "break" })), today);
// { current, previous, longest, today: "pending" | "count" | ..., atRisk }

// Grants: once per key, capped.
grant(user.freeze, "wins:7", 1, { cap: 2 });

// Ranking: ties share a rank.
rank(rows, (r) => r.xp);

// League: the product scores members; the package keeps rooms fair.
const league = createLeague<Member>({ tiers: 5, key: (m) => m.id });
const period = { period: weekKey(today), members: [] };
league.enroll(period, candidates, history);
league.describe(period, "alice", (m) => pointsThisWeek(m), history);

// Nudge: at most one reason per day; you write the words and send them.
const nudge = pickNudge({ streak: { previous: view.previous, today: "pending" }, league: standing, lastTold: user.lastTold });
```

## Principles

1. **No copy.** Reasons and numbers come back; the voice is the product's.
2. **No storage.** Plain JSON in, plain JSON out.
3. **No delivery.** It knows nothing of LINE, email or push.
4. **No clock, no zone.** Days arrive as string keys.
5. **Ties are never broken by an id.** Equal work, equal treatment.
6. **No abstraction two real products have not asked for.**

## Origin

Extracted from [protagonist](https://github.com/purankuton2001/protagonist) (a 90-day challenge with LINE notifications and weekly leagues) and [corecord](https://github.com/purankuton2001/core-record) (daily conversations, XP and an all-time ranking), where the same mechanics had been written twice. Its sibling [coreloop](https://github.com/purankuton2001/coreloop) handles the dig → verbalize → share loop; keeploop handles the come-back-tomorrow loop.

## License

MIT

// Calendar days as strings.
//
// Every mechanic in this package counts days: a streak is consecutive days, a
// league is a week of days, a nudge is "today". Whose day, though? One product
// cuts days in Asia/Tokyo, another in UTC, a third per user. That decision
// belongs to the product, so nothing here takes a Date. The product hands over
// `YYYY-MM-DD` keys it already cut with its own zone, and the arithmetic below
// is exact on those keys — no DST, no offsets, no midnight surprises.

/** A calendar day as `YYYY-MM-DD`. Cut by the product in the zone it chose. */
export type DayKey = string;

const DAY_MS = 86_400_000;
const PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: unknown): value is DayKey {
  return typeof value === "string" && PATTERN.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
}

function ms(day: DayKey): number {
  const t = Date.parse(day + "T00:00:00Z");
  if (Number.isNaN(t)) throw new Error(`keeploop: "${day}" is not a YYYY-MM-DD day key`);
  return t;
}

/**
 * The day a moment falls on, in a time zone. When the product has no zone
 * decision yet (single-region, one user), omit it and get UTC — stable and
 * unambiguous, which is what a boundary needs first.
 */
export function dayKey(at: Date, timeZone?: string): DayKey {
  if (!timeZone) return at.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(day: DayKey, n: number): DayKey {
  return new Date(ms(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: DayKey, to: DayKey): number {
  return Math.round((ms(to) - ms(from)) / DAY_MS);
}

/**
 * The first day of the week containing `day` — the key a weekly league or a
 * weekly reset is stored under. Weeks start on Monday unless told otherwise
 * (0 = Sunday … 6 = Saturday).
 */
export function weekKey(day: DayKey, weekStartsOn = 1): DayKey {
  const weekday = new Date(ms(day)).getUTCDay();
  return addDays(day, -((weekday - weekStartsOn + 7) % 7));
}

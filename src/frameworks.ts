// The self-analysis frameworks everybody already uses, as structure.
//
// A life chart, a 3×3 goal sheet, a Johari window, Will/Can/Must, "what do you
// want said about you when you are gone" — these are public methods. They are
// not anybody's product, and every app that runs this loop rebuilds the same
// shapes to hold them: a series of scored moments, a grid with a centre, two
// sets compared, a handful of circles overlapping.
//
// So the shapes and their mechanics live here, and nothing else does. There is
// no question wording in this module, no field labels, no scale copy, no
// instruction to a model — a framework's STRUCTURE is public, and how a product
// asks someone to fill it in is still the product's own (principle 1).
//
// What each one is FOR, in one line, because it decides the shape:
//   - life chart: the flat stretches are where people recite the summary they
//     always give. The swings are where the material is. So the useful output
//     is not the line, it is the turning points.
//   - 3×3 sheet: the value is in the empty cells. Eight boxes around a centre
//     force eight angles on it, and the ones still blank are the angles nobody
//     has been made to think about yet.
//   - Johari window: what others see and you do not is a different KIND of
//     material from what you already know about yourself. Set algebra, and the
//     interesting quadrant is the one you cannot fill in alone.
//   - overlapping circles: the answer is the intersection, and the items that
//     sit in only one circle are what a person keeps mistaking for it.
//
// Imported from "coreloop/frameworks".
//
// Naming note: the 3×3 sheet is widely known in Japan under a name that is a
// REGISTERED TRADEMARK (managed by 一般社団法人マンダラチャート協会, registered
// 2006). The format is public; the name is not this package's to hand out, so
// the exports here describe the shape instead. An app that wants to use that
// name in its own UI should check the association's usage policy first.

import { CoreloopError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Life chart — also motivation graph, lifeline, 自分史
// ---------------------------------------------------------------------------

export type LifePoint = {
  id: string;
  /** Position on the line: an age, a year, a grade. The app picks the unit. */
  at: number;
  /** How it felt. The app picks the scale; -5..+5 and 0..10 are both common. */
  score: number;
  /** What happened, in the person's words. */
  label?: string;
};

/**
 * The scale a chart was drawn on. BOTH SIDES ARE OPTIONAL and there is no
 * default: -5..+5 and 0..10 are both in wide use, and a default would quietly
 * rewrite every score of a chart drawn on the other one. Given a bound, scores
 * are clamped to it; given none, they are left exactly as drawn.
 */
export type LifeChartScale = {
  min?: number;
  max?: number;
};

export type TurningKind = "rise" | "fall" | "peak" | "trough";

export type TurningPoint = {
  point: LifePoint;
  /** Height of the move into this point. Negative for a fall. */
  delta: number;
  kind: TurningKind;
};

function clampTo(value: number, min?: number, max?: number): number {
  let out = value;
  if (min != null) out = Math.max(min, out);
  if (max != null) out = Math.min(max, out);
  return out;
}

/**
 * Put a chart in order: sorted by position, points at the same position
 * collapsed to the last one given, scores clamped to the scale IF one is given.
 *
 * Out-of-scale scores are clamped rather than dropped — someone dragging a
 * point off the end of a slider means "as low as it goes", and throwing that
 * away loses the strongest point on the chart. A point with no usable score is
 * dropped, though: an unanswered field is not the bottom of someone's life, and
 * clamping it to one would rank it first.
 */
export function normalizeLifeChart(
  points: readonly LifePoint[],
  scale: LifeChartScale = {},
): LifePoint[] {
  const { min, max } = scale;
  if (min != null && max != null && min >= max) {
    throw new CoreloopError("invalid-contract", `A life chart scale needs min < max (got ${min}, ${max}).`);
  }

  const byPosition = new Map<number, LifePoint>();
  for (const point of points) {
    if (!Number.isFinite(point.at) || !Number.isFinite(point.score)) continue;
    byPosition.set(point.at, { ...point, score: clampTo(point.score, min, max) });
  }

  return [...byPosition.values()].sort((a, b) => a.at - b.at);
}

/**
 * The moments worth asking about.
 *
 * Ranked by how far the line moved, not by how high or low it sits: a person
 * who has never scored above zero still has the drop that made them stop, and
 * a ranking on absolute height would only ever surface the same happy peak.
 *
 * `peak` and `trough` mark points that reverse direction; `rise` and `fall`
 * mark moves that carry on the same way. A flat stretch is not a direction —
 * two years at the same score in the middle of a climb do not end it — so both
 * the move in and the move out are measured against the nearest DIFFERENT
 * score, not the neighbouring point.
 */
export function pickTurningPoints(
  points: readonly LifePoint[],
  options: { count?: number; minDelta?: number; scale?: LifeChartScale } = {},
): TurningPoint[] {
  const chart = normalizeLifeChart(points, options.scale ?? {});
  if (chart.length < 2) return [];

  const count = options.count ?? 3;
  const minDelta = options.minDelta ?? 0;

  const candidates: TurningPoint[] = [];
  let previousScore = chart[0]!.score;
  for (let i = 1; i < chart.length; i++) {
    const point = chart[i]!;
    const delta = point.score - previousScore;
    if (delta === 0) continue; // still on the same level: not a move yet

    let outgoing = 0;
    for (let j = i + 1; j < chart.length; j++) {
      const change = chart[j]!.score - point.score;
      if (change !== 0) {
        outgoing = change;
        break;
      }
    }
    const kind: TurningKind =
      delta > 0 && outgoing < 0 ? "peak" : delta < 0 && outgoing > 0 ? "trough" : delta > 0 ? "rise" : "fall";

    candidates.push({ point, delta, kind });
    previousScore = point.score;
  }

  return candidates
    .filter((c) => Math.abs(c.delta) >= minDelta)
    // Size first: the biggest thing that happened is the biggest thing that
    // happened, whatever shape it left behind. A reversal only breaks a tie —
    // between two moves of the same size, the point where a life stopped going
    // one way is the better question.
    .sort((a, b) => {
      const size = Math.abs(b.delta) - Math.abs(a.delta);
      if (size !== 0) return size;
      const reversal =
        Number(b.kind === "peak" || b.kind === "trough") - Number(a.kind === "peak" || a.kind === "trough");
      return reversal !== 0 ? reversal : a.point.at - b.point.at;
    })
    .slice(0, Math.max(0, count));
}

/** A chart as prompt material: one line per point, in order. */
export function formatLifeChart(points: readonly LifePoint[], scale: LifeChartScale = {}): string {
  return normalizeLifeChart(points, scale)
    .map((p) => (p.label?.trim() ? `${p.at}: ${p.score} — ${p.label.trim()}` : `${p.at}: ${p.score}`))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Nine-box grid — a centre and the eight angles around it
// ---------------------------------------------------------------------------

/** Exactly eight cells around a centre. An unfilled cell is null, not "". */
export type NineBox = {
  centre: string;
  around: (string | null)[];
};

/**
 * The full sheet: a core grid, plus one grid per cell around it. Each of those
 * eight takes its own centre FROM the core, which is what turns eight angles
 * into sixty-four concrete ones.
 */
export type NineBoxSheet = {
  core: NineBox;
  /** Eight grids, positionally matched to `core.around`. null = not opened yet. */
  branches: (NineBox | null)[];
  /**
   * Grids whose core cell was cleared, with what was written under them. Kept
   * rather than dropped: clearing one word of the centre should not silently
   * delete the eight the person wrote underneath it. The caller decides whether
   * to offer them back or discard them.
   */
  orphaned: { index: number; box: NineBox }[];
};

export type NineBoxGap = {
  /** Index in `core.around`, or null for a hole in the core grid itself. */
  branch: number | null;
  /** Index of the empty cell within that grid. */
  cell: number;
};

export const NINE_BOX_CELLS = 8;

/** Everything a fully opened sheet can hold: the core's eight, plus eight each. */
export const NINE_BOX_CAPACITY = NINE_BOX_CELLS * (NINE_BOX_CELLS + 1);

function padCells(cells: readonly (string | null | undefined)[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < NINE_BOX_CELLS; i++) {
    const cell = cells[i];
    out.push(typeof cell === "string" && cell.trim() ? cell.trim() : null);
  }
  return out;
}

/**
 * A grid from whatever the app has so far. Short input is padded with empties
 * rather than rejected — a half-filled sheet is the normal state of one, and
 * the emptiness is the part worth reading.
 */
export function createNineBox(centre: string, around: readonly (string | null | undefined)[] = []): NineBox {
  if (!centre?.trim()) {
    throw new CoreloopError("empty-input", "A nine-box grid needs something in the centre.");
  }
  if (around.length > NINE_BOX_CELLS) {
    throw new CoreloopError(
      "invalid-contract",
      `A nine-box grid holds ${NINE_BOX_CELLS} cells around the centre, not ${around.length}.`,
    );
  }
  return { centre: centre.trim(), around: padCells(around) };
}

/**
 * Open the sheet: every filled cell of the core becomes the centre of its own
 * grid. Branches already opened keep their cells, and one whose centre no
 * longer matches the core is re-centred — editing the core is a decision about
 * the branch too, and silently keeping the old heading is how a sheet ends up
 * answering a question nobody is asking any more.
 */
export function expandNineBox(core: NineBox, existing: readonly (NineBox | null)[] = []): NineBoxSheet {
  // Read the padded cells, not the raw ones: a cell holding only whitespace is
  // an empty cell everywhere else in this module, and reading it raw here would
  // open a branch under an angle the sheet does not show.
  const around = padCells(core.around);
  const branches: (NineBox | null)[] = [];
  const orphaned: { index: number; box: NineBox }[] = [];

  for (let i = 0; i < NINE_BOX_CELLS; i++) {
    const centre = around[i];
    const previous = existing[i];

    if (!centre) {
      branches.push(null);
      if (previous?.around.some((cell) => cell?.trim())) {
        orphaned.push({ index: i, box: { centre: previous.centre, around: padCells(previous.around) } });
      }
      continue;
    }
    branches.push({ centre, around: padCells(previous?.around ?? []) });
  }

  return { core: { ...core, around }, branches, orphaned };
}

/** Every empty cell, core first, then branch by branch. */
export function nineBoxGaps(sheet: NineBoxSheet): NineBoxGap[] {
  const gaps: NineBoxGap[] = [];
  sheet.core.around.forEach((cell, index) => {
    if (!cell) gaps.push({ branch: null, cell: index });
  });
  sheet.branches.forEach((branch, branchIndex) => {
    if (!branch) return;
    branch.around.forEach((cell, index) => {
      if (!cell) gaps.push({ branch: branchIndex, cell: index });
    });
  });
  return gaps;
}

/**
 * How much of the sheet exists. `total` counts only cells that can be filled
 * right now — a branch cannot be filled before its core cell names it.
 *
 * No ratio, deliberately. That denominator GROWS as the person works: naming an
 * eighth angle adds eight empty cells under it, so filled/total falls at the
 * exact moment they did something right. Against NINE_BOX_CAPACITY it only ever
 * rises, but starts at 0/72 and reads as hopeless. Which of those a product
 * shows, and whether it shows a bar at all, is the product's call — the counts
 * are here so it can make it.
 */
export function nineBoxProgress(sheet: NineBoxSheet): { filled: number; total: number } {
  let filled = 0;
  let total = NINE_BOX_CELLS;
  for (const cell of sheet.core.around) if (cell) filled++;
  for (const branch of sheet.branches) {
    if (!branch) continue;
    total += NINE_BOX_CELLS;
    for (const cell of branch.around) if (cell) filled++;
  }
  return { filled, total };
}

/** A sheet as prompt material: the centre, then each branch and its cells. */
export function formatNineBox(sheet: NineBoxSheet): string {
  const lines: string[] = [sheet.core.centre];
  sheet.core.around.forEach((cell, index) => {
    if (!cell) return;
    lines.push(`- ${cell}`);
    const branch = sheet.branches[index];
    for (const sub of branch?.around ?? []) {
      if (sub) lines.push(`  - ${sub}`);
    }
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Johari window — what you see, what they see
// ---------------------------------------------------------------------------

export type JohariWindow = {
  /** Both picked it. */
  open: string[];
  /** They picked it, you did not — the quadrant you cannot fill in alone. */
  blind: string[];
  /** You picked it, they did not. */
  hidden: string[];
  /** Nobody picked it. Empty unless the whole pool is supplied. */
  unknown: string[];
};

/**
 * Compare a self-description against how others describe the same person.
 *
 * Comparison is on the exact strings given, so pass ids or canonical terms
 * rather than free text — "決断が速い" and "決断がはやい" are the same trait to a
 * person and two traits to a Set, and the blind quadrant is exactly where that
 * mistake does the most damage.
 */
export function johariWindow(
  self: Iterable<string>,
  others: Iterable<string>,
  pool?: Iterable<string>,
): JohariWindow {
  const mine = new Set(self);
  const theirs = new Set(others);
  const everything = pool ? new Set(pool) : null;

  const open: string[] = [];
  const hidden: string[] = [];
  for (const item of mine) (theirs.has(item) ? open : hidden).push(item);

  const blind: string[] = [];
  for (const item of theirs) if (!mine.has(item)) blind.push(item);

  const unknown: string[] = [];
  if (everything) {
    for (const item of everything) if (!mine.has(item) && !theirs.has(item)) unknown.push(item);
  }

  return { open, blind, hidden, unknown };
}

// ---------------------------------------------------------------------------
// Overlapping circles — Will/Can/Must, and the four-circle diagram
// ---------------------------------------------------------------------------

export type Circle = {
  id: string;
  items: Iterable<string>;
};

export type OverlapRegion = {
  /** Circle ids this region belongs to, in the order the circles were given. */
  circles: string[];
  items: string[];
};

export type Overlaps = {
  /** Every non-empty region, most-covered first. */
  regions: OverlapRegion[];
  /** Items inside every circle — the answer the exercise is looking for. */
  core: string[];
  /** Items in exactly one circle, by circle id. What gets mistaken for the core. */
  alone: Record<string, string[]>;
};

/**
 * Work out which items fall in which overlap.
 *
 * Three circles is Will/Can/Must, four is the diagram everyone has seen; the
 * arithmetic does not care, so neither does this. What it does care about is
 * that `core` can be empty — an exercise whose answer is "nothing yet" has told
 * you something, and filling it with the nearest two-circle region would hide
 * precisely that.
 */
export function circleOverlaps(circles: readonly Circle[]): Overlaps {
  if (circles.length === 0) {
    throw new CoreloopError("invalid-contract", "Overlaps need at least one circle.");
  }
  const ids = circles.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    throw new CoreloopError("invalid-contract", "Circle ids must be unique.");
  }

  // Membership per item, in circle order, so regions come out deterministic.
  // Blank rows are dropped rather than counted: an empty field left in two
  // circles would otherwise land in every one of them and report an answer in
  // precisely the case where the honest result is "nothing yet".
  const membership = new Map<string, Set<string>>();
  for (const circle of circles) {
    for (const raw of circle.items) {
      const item = typeof raw === "string" ? raw.trim() : "";
      if (!item) continue;
      const found = membership.get(item);
      if (found) found.add(circle.id);
      else membership.set(item, new Set([circle.id]));
    }
  }

  const byRegion = new Map<string, OverlapRegion>();
  const alone: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, [] as string[]]));
  const core: string[] = [];

  for (const [item, inCircles] of membership) {
    const regionCircles = ids.filter((id) => inCircles.has(id));
    // A separator no circle id can contain, so ids with spaces in them
    // cannot collide into one region. Written as an escape: a literal control
    // character in source is invisible and makes the file read as binary.
    const key = regionCircles.join("\u0000");
    const region = byRegion.get(key) ?? { circles: regionCircles, items: [] };
    region.items.push(item);
    byRegion.set(key, region);

    if (regionCircles.length === circles.length) core.push(item);
    if (regionCircles.length === 1) alone[regionCircles[0]!]!.push(item);
  }

  const regions = [...byRegion.values()].sort(
    (a, b) => b.circles.length - a.circles.length || a.circles.join().localeCompare(b.circles.join()),
  );

  return { regions, core, alone };
}

// ---------------------------------------------------------------------------
// Perspectives — the eulogy exercise, and every other "from whose eyes" sheet
// ---------------------------------------------------------------------------

export type Perspective = {
  /** Whose eyes: a relationship, a name, a role. The person's own word for it. */
  who: string;
  /** What they would say, or what the person wants them to be able to say. */
  statement: string;
};

/**
 * Perspectives as prompt material.
 *
 * The exercise this holds — what your family, your closest people, your
 * colleagues would say about you when you are gone — works because the same
 * value said from four different mouths is the one a person actually lives by,
 * and because it is the rare question people cannot answer with their résumé.
 * Blank statements are dropped: an unanswered viewpoint is not evidence of
 * anything, and passing it to a model invites one to be invented.
 */
export function formatPerspectives(entries: readonly Perspective[]): string {
  return entries
    .filter((e) => e.who?.trim() && e.statement?.trim())
    .map((e) => `${e.who.trim()}: ${e.statement.trim()}`)
    .join("\n");
}

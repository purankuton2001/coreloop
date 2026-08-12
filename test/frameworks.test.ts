import assert from "node:assert/strict";
import { test } from "node:test";

import { CoreloopError } from "../src/index.ts";
import {
  circleOverlaps,
  createNineBox,
  expandNineBox,
  formatLifeChart,
  formatNineBox,
  formatPerspectives,
  johariWindow,
  nineBoxGaps,
  nineBoxProgress,
  normalizeLifeChart,
  pickTurningPoints,
  type LifePoint,
} from "../src/frameworks.ts";

// ---------- life chart ----------

const chart: LifePoint[] = [
  { id: "a", at: 6, score: 2, label: "started" },
  { id: "b", at: 12, score: -4, label: "the thing nobody talks about" },
  { id: "c", at: 15, score: 1 },
  { id: "d", at: 18, score: 4, label: "said it out loud" },
  { id: "e", at: 22, score: 3 },
];

test("a chart is sorted, clamped, and one point per position", () => {
  const normalized = normalizeLifeChart(
    [
      { id: "late", at: 22, score: 99 },
      { id: "early", at: 6, score: -99 },
      { id: "override", at: 22, score: 3 },
    ],
    { min: -5, max: 5 },
  );
  assert.deepEqual(
    normalized.map((p) => [p.at, p.score, p.id]),
    [
      [6, -5, "early"],
      [22, 3, "override"],
    ],
    "off-scale means as far as it goes, not discarded",
  );
});

test("no scale means no clamping — a 0..10 chart is left as drawn", () => {
  const tenPoint = [
    { id: "a", at: 10, score: 8 },
    { id: "b", at: 20, score: 10 },
    { id: "c", at: 30, score: 6 },
  ];
  assert.deepEqual(
    normalizeLifeChart(tenPoint).map((p) => p.score),
    [8, 10, 6],
    "a default scale would flatten every one of these to its own ceiling",
  );
  assert.deepEqual(
    pickTurningPoints(tenPoint, { count: 1 }).map((t) => [t.point.at, t.kind]),
    [[30, "fall"]],
  );
});

test("one open bound clamps only that side", () => {
  assert.deepEqual(
    normalizeLifeChart([{ id: "a", at: 1, score: 99 }], { min: 0 }).map((p) => p.score),
    [99],
  );
});

test("a point with no usable score is dropped, not sunk to the bottom", () => {
  const withHole = [
    { id: "a", at: 1, score: 3 },
    { id: "b", at: 2, score: Number.NaN },
    { id: "c", at: 3, score: 4 },
  ];
  assert.deepEqual(
    normalizeLifeChart(withHole, { min: -5, max: 5 }).map((p) => p.id),
    ["a", "c"],
    "an unanswered field is not the lowest point of someone's life",
  );
  assert.deepEqual(pickTurningPoints(withHole, { count: 3 }).map((t) => t.delta), [1]);
});

test("a scale that is not a scale is a contract failure", () => {
  assert.throws(
    () => normalizeLifeChart(chart, { min: 5, max: 5 }),
    (err: unknown) => err instanceof CoreloopError && err.reason === "invalid-contract",
  );
});

test("turning points rank the moves, not the heights", () => {
  const picked = pickTurningPoints(chart, { count: 2 });
  assert.deepEqual(
    picked.map((t) => [t.point.at, t.kind, t.delta]),
    [
      [12, "trough", -6],
      [15, "rise", 5],
    ],
    "the biggest moves, in order of size",
  );
});

test("the biggest move outranks a smaller reversal", () => {
  const collapse = [
    { id: "a", at: 1, score: 0 },
    { id: "b", at: 2, score: 1 },
    { id: "c", at: 3, score: 0 },
    { id: "d", at: 4, score: -5 },
  ];
  assert.deepEqual(
    pickTurningPoints(collapse, { count: 1 }).map((t) => [t.point.at, t.delta]),
    [[4, -5]],
    "a one-point wobble that happens to reverse is not the story of this chart",
  );
});

test("a reversal only breaks a tie between equal moves", () => {
  const tied = [
    { id: "a", at: 1, score: 0 },
    { id: "b", at: 2, score: 3 },
    { id: "c", at: 3, score: 6 },
    { id: "d", at: 4, score: 3 },
  ];
  const [first] = pickTurningPoints(tied, { count: 1 });
  assert.deepEqual([first?.point.at, first?.kind], [3, "peak"], "both moves are 3; the turn wins");
});

test("a flat stretch does not end the direction it sits in", () => {
  const plateau = [
    { id: "a", at: 1, score: 0 },
    { id: "b", at: 2, score: 5 },
    { id: "c", at: 3, score: 5 },
    { id: "d", at: 4, score: 0 },
  ];
  assert.deepEqual(
    pickTurningPoints(plateau, { count: 1 }).map((t) => [t.point.at, t.kind]),
    [[2, "peak"]],
    "two years at the top is still the top, not a rise that never turned",
  );
});

test("a flat chart has nothing to ask about", () => {
  const flat = [
    { id: "a", at: 1, score: 3 },
    { id: "b", at: 2, score: 3 },
    { id: "c", at: 3, score: 3 },
  ];
  assert.deepEqual(pickTurningPoints(flat), []);
  assert.deepEqual(pickTurningPoints([{ id: "only", at: 1, score: 5 }]), []);
});

test("small wobbles can be filtered out", () => {
  // The climb out of the trough is a 5-point move and survives a 4-point floor;
  // the 3-point peak at 18 does not. Reversals still sort ahead of straight moves.
  assert.deepEqual(
    pickTurningPoints(chart, { count: 5, minDelta: 4 }).map((t) => t.point.at),
    [12, 15],
  );
  assert.deepEqual(
    pickTurningPoints(chart, { count: 5, minDelta: 6 }).map((t) => t.point.at),
    [12],
  );
});

test("a chart formats as one line per point, in order", () => {
  assert.equal(
    formatLifeChart([chart[2]!, chart[0]!]),
    "6: 2 — started\n15: 1",
    "a point with no label still carries its position and score",
  );
});

// ---------- nine-box ----------

test("a grid pads to eight cells and keeps blanks blank", () => {
  const box = createNineBox("  become someone worth quoting  ", ["craft", "  ", "people"]);
  assert.equal(box.centre, "become someone worth quoting");
  assert.deepEqual(box.around, ["craft", null, "people", null, null, null, null, null]);
});

test("a grid with no centre, or too many cells, is refused", () => {
  assert.throws(
    () => createNineBox("   "),
    (err: unknown) => err instanceof CoreloopError && err.reason === "empty-input",
  );
  assert.throws(
    () => createNineBox("x", Array.from({ length: 9 }, (_, i) => `c${i}`)),
    (err: unknown) => err instanceof CoreloopError && err.reason === "invalid-contract",
  );
});

test("expanding gives one branch per filled cell, and none for the empty ones", () => {
  const sheet = expandNineBox(createNineBox("centre", ["craft", null, "people"]));
  assert.deepEqual(
    sheet.branches.map((b) => b?.centre ?? null),
    ["craft", null, "people", null, null, null, null, null],
  );
});

test("re-centring a core cell re-centres its branch", () => {
  const first = expandNineBox(createNineBox("centre", ["craft"]));
  first.branches[0]!.around[0] = "practise daily";

  const second = expandNineBox(createNineBox("centre", ["voice"]), first.branches);

  assert.equal(second.branches[0]?.centre, "voice", "the branch follows the core, not the other way round");
  assert.equal(second.branches[0]?.around[0], "practise daily", "what was written under it survives");
});

test("progress counts only what can be filled in yet", () => {
  const empty = expandNineBox(createNineBox("centre"));
  assert.deepEqual(nineBoxProgress(empty), { filled: 0, total: 8 });

  const started = expandNineBox(createNineBox("centre", ["craft", "people"]));
  started.branches[0]!.around[0] = "practise daily";
  assert.deepEqual(nineBoxProgress(started), { filled: 3, total: 24 });
});

test("clearing a core cell keeps what was written under it", () => {
  const first = expandNineBox(createNineBox("centre", ["craft"]));
  first.branches[0]!.around[0] = "practise daily";

  const cleared = expandNineBox(createNineBox("centre", []), first.branches);

  assert.equal(cleared.branches[0], null);
  assert.deepEqual(cleared.orphaned, [
    { index: 0, box: { centre: "craft", around: ["practise daily", null, null, null, null, null, null, null] } },
  ]);
});

test("an emptied branch is not worth keeping", () => {
  const first = expandNineBox(createNineBox("centre", ["craft"]));
  const cleared = expandNineBox(createNineBox("centre", []), first.branches);
  assert.deepEqual(cleared.orphaned, []);
});

test("a whitespace cell opens no branch", () => {
  const sheet = expandNineBox({ centre: "centre", around: ["   ", null, null, null, null, null, null, null] });
  assert.deepEqual(sheet.core.around[0], null);
  assert.equal(sheet.branches[0], null, "a branch under a cell the sheet does not show");
  assert.deepEqual(nineBoxProgress(sheet), { filled: 0, total: 8 });
});

test("gaps are listed core first, then branch by branch", () => {
  const sheet = expandNineBox(createNineBox("centre", ["craft"]));
  sheet.branches[0]!.around[0] = "practise daily";
  const gaps = nineBoxGaps(sheet);
  assert.deepEqual(gaps[0], { branch: null, cell: 1 }, "the core's own holes come first");
  assert.equal(gaps.filter((g) => g.branch === 0).length, 7);
});

test("a sheet formats as a centre with its angles nested under it", () => {
  const sheet = expandNineBox(createNineBox("centre", ["craft", null, "people"]));
  sheet.branches[0]!.around[0] = "practise daily";
  assert.equal(formatNineBox(sheet), "centre\n- craft\n  - practise daily\n- people");
});

// ---------- johari ----------

test("the window splits what both saw from what only one did", () => {
  const window = johariWindow(["stubborn", "quiet"], ["stubborn", "funny"], [
    "stubborn",
    "quiet",
    "funny",
    "patient",
  ]);
  assert.deepEqual(window, {
    open: ["stubborn"],
    hidden: ["quiet"],
    blind: ["funny"],
    unknown: ["patient"],
  });
});

test("without the pool, unknown stays empty rather than guessed at", () => {
  assert.deepEqual(johariWindow(["a"], ["b"]).unknown, []);
});

// ---------- circles ----------

test("regions come back most-covered first, with the intersection called out", () => {
  const { regions, core, alone } = circleOverlaps([
    { id: "will", items: ["write", "teach", "sleep"] },
    { id: "can", items: ["write", "teach"] },
    { id: "must", items: ["write", "invoice"] },
  ]);

  assert.deepEqual(core, ["write"]);
  assert.deepEqual(regions[0], { circles: ["will", "can", "must"], items: ["write"] });
  assert.deepEqual(regions[1], { circles: ["will", "can"], items: ["teach"] });
  assert.deepEqual(alone, { will: ["sleep"], can: [], must: ["invoice"] });
});

test("blank rows never become the answer", () => {
  const { core, regions } = circleOverlaps([
    { id: "will", items: ["  ", "write"] },
    { id: "can", items: ["", "  "] },
  ]);
  assert.deepEqual(core, [], "an empty field left in two circles is not something they share");
  assert.deepEqual(regions, [{ circles: ["will"], items: ["write"] }]);
});

test("an empty intersection is reported as empty, not filled in with the next best thing", () => {
  const { core, regions } = circleOverlaps([
    { id: "will", items: ["a"] },
    { id: "can", items: ["b"] },
  ]);
  assert.deepEqual(core, []);
  assert.equal(regions.length, 2, "two one-circle regions, no intersection");
});

test("circles need ids, and unique ones", () => {
  assert.throws(
    () => circleOverlaps([]),
    (err: unknown) => err instanceof CoreloopError && err.reason === "invalid-contract",
  );
  assert.throws(
    () => circleOverlaps([
      { id: "will", items: [] },
      { id: "will", items: [] },
    ]),
    (err: unknown) => err instanceof CoreloopError && err.reason === "invalid-contract",
  );
});

// ---------- perspectives ----------

test("an unanswered viewpoint is left out rather than passed on blank", () => {
  assert.equal(
    formatPerspectives([
      { who: "daughter", statement: "  he never once made me feel small  " },
      { who: "oldest friend", statement: "   " },
      { who: "", statement: "orphan" },
    ]),
    "daughter: he never once made me feel small",
  );
});

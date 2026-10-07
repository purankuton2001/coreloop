import assert from "node:assert/strict";
import test from "node:test";

import {
  SCOPE_PERSPECTIVE_LADDER,
  nextPerspectiveLevel,
  nextPerspectiveShift,
  normalizePerspectivePositions,
  type PerspectiveLadder,
  type TranscriptTurn,
} from "../src/index.ts";

const transcript: TranscriptTurn[] = [
  { role: "assistant", text: "誰かにも広げたい？" },
  { role: "user", text: "まず自分が自由でいたい。" },
  { role: "assistant", text: "同じ人には？" },
  { role: "user", text: "同じように作れず困ってる人は減ってほしい。" },
];

test("scope ladder widens exactly one adjacent level", () => {
  assert.equal(nextPerspectiveLevel(SCOPE_PERSPECTIVE_LADDER, "self")?.id, "others");
  assert.equal(nextPerspectiveLevel(SCOPE_PERSPECTIVE_LADDER, "others")?.id, "group");
  assert.equal(nextPerspectiveLevel(SCOPE_PERSPECTIVE_LADDER, "system"), null);
  assert.equal(nextPerspectiveLevel(SCOPE_PERSPECTIVE_LADDER, "missing"), null);
});

test("a rejected next step does not widen", () => {
  const position = {
    ladderId: "scope",
    levelId: "self",
    confidence: 1,
    nextStep: "rejected" as const,
    evidence: [{ turnIndex: 1, quote: "まず自分が自由でいたい" }],
  };
  assert.equal(nextPerspectiveShift({ ladder: SCOPE_PERSPECTIVE_LADDER, position }), null);
});

test("perspective positions require caller-known ids and grounded user evidence", () => {
  const custom: PerspectiveLadder = {
    id: "time",
    goal: "time horizon",
    levels: [{ id: "today", goal: "today" }, { id: "years", goal: "years" }],
  };
  const positions = normalizePerspectivePositions({
    ladders: [SCOPE_PERSPECTIVE_LADDER, custom],
    transcript,
    positions: [
      {
        ladderId: "scope",
        levelId: "others",
        confidence: 0.8,
        nextStep: "open",
        evidence: [{ turnIndex: 3, quote: "困ってる人は減ってほしい" }],
      },
      {
        ladderId: "time",
        levelId: "today",
        confidence: 0.7,
        nextStep: "open",
        evidence: [{ turnIndex: 0, quote: "誰かにも広げたい" }],
      },
      {
        ladderId: "unknown",
        levelId: "x",
        confidence: 1,
        nextStep: "open",
        evidence: [{ turnIndex: 3, quote: "減ってほしい" }],
      },
    ],
  });

  assert.equal(positions.length, 1);
  assert.equal(positions[0]?.ladderId, "scope");
  assert.equal(nextPerspectiveShift({ ladder: SCOPE_PERSPECTIVE_LADDER, position: positions[0]! })?.id, "group");
});

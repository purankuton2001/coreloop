// One-step perspective shifts for adaptive interviews.
//
// A perspective ladder is deliberately only structure. Products decide which
// ladders matter and whether to supply them at all. The engine never assumes
// that a wider scope, longer horizon or higher-responsibility view is morally
// better. It only lets a director test ONE adjacent level when the person's own
// words make that useful.

import { z } from "zod";
import { visibleTurns, type TranscriptTurn } from "./transcript.ts";

export type PerspectiveLevel = {
  id: string;
  /** What this level means to the caller. Not user-facing copy. */
  goal: string;
};

export type PerspectiveLadder = {
  id: string;
  /** What dimension changes as the ladder moves. */
  goal: string;
  /** Ordered from narrower/current-near to wider/farther. */
  levels: readonly PerspectiveLevel[];
};

export type PerspectiveEvidence = {
  turnIndex: number;
  quote: string;
};

export type PerspectivePosition = {
  ladderId: string;
  levelId: string;
  confidence: number;
  /**
   * "open" means one adjacent step may be tested. "rejected" means the person
   * has explicitly declined/contradicted broadening on this ladder.
   */
  nextStep: "open" | "rejected";
  evidence: PerspectiveEvidence[];
};

export const perspectiveEvidenceSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  quote: z.string().min(1).max(800),
}).strict();

export const perspectivePositionSchema = z.object({
  ladderId: z.string().min(1).max(120),
  levelId: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1),
  nextStep: z.enum(["open", "rejected"]),
  evidence: z.array(perspectiveEvidenceSchema).min(1).max(6),
}).strict();

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function evidenceMatchesUserTurn(
  transcript: readonly TranscriptTurn[],
  evidence: PerspectiveEvidence,
): boolean {
  const turn = visibleTurns(transcript)[evidence.turnIndex];
  if (!turn || turn.role !== "user") return false;
  const quote = evidence.quote.trim();
  if (!quote) return false;
  return turn.text.includes(quote)
    || collapseWhitespace(turn.text).includes(collapseWhitespace(quote));
}

/** Validate ids, ordering inputs and evidence before a planner may use them. */
export function normalizePerspectivePositions(input: {
  positions: readonly PerspectivePosition[];
  ladders?: readonly PerspectiveLadder[];
  transcript: readonly TranscriptTurn[];
}): PerspectivePosition[] {
  const ladders = new Map((input.ladders ?? []).map((ladder) => [ladder.id, ladder]));
  const byLadder = new Map<string, PerspectivePosition>();

  for (const position of input.positions) {
    const ladder = ladders.get(position.ladderId);
    if (!ladder || !ladder.levels.some((level) => level.id === position.levelId)) continue;
    const evidence = position.evidence.filter((item) =>
      evidenceMatchesUserTurn(input.transcript, item));
    if (!evidence.length) continue;
    const normalized: PerspectivePosition = {
      ladderId: position.ladderId,
      levelId: position.levelId,
      confidence: Math.max(0, Math.min(1, position.confidence)),
      nextStep: position.nextStep,
      evidence,
    };
    const existing = byLadder.get(position.ladderId);
    // Refusal dominates widening. Otherwise keep the higher-confidence grounded
    // position so array order from a model never decides whether we broaden.
    if (!existing
      || normalized.nextStep === "rejected"
      || (existing.nextStep !== "rejected" && normalized.confidence > existing.confidence)) {
      byLadder.set(position.ladderId, normalized);
    }
  }

  return [...byLadder.values()];
}

/** Exactly one adjacent level above current, never a jump. */
export function nextPerspectiveLevel(
  ladder: PerspectiveLadder,
  currentLevelId: string,
): PerspectiveLevel | null {
  const index = ladder.levels.findIndex((level) => level.id === currentLevelId);
  if (index < 0 || index + 1 >= ladder.levels.length) return null;
  return ladder.levels[index + 1] ?? null;
}

/**
 * Return the only legal one-step shift for this grounded position.
 * A rejected next step is terminal until the caller has new user evidence.
 */
export function nextPerspectiveShift(input: {
  ladder: PerspectiveLadder;
  position: PerspectivePosition;
}): PerspectiveLevel | null {
  if (input.position.ladderId !== input.ladder.id) return null;
  if (input.position.nextStep === "rejected") return null;
  return nextPerspectiveLevel(input.ladder, input.position.levelId);
}

/**
 * Optional convenience ladder for widening scope. It contains no question copy;
 * apps remain free to define a different ladder or none at all.
 */
export const SCOPE_PERSPECTIVE_LADDER: PerspectiveLadder = Object.freeze({
  id: "scope",
  goal: "Widen who or what is included in the desired change, one adjacent level at a time.",
  levels: Object.freeze([
    { id: "self", goal: "The person's own life, experience or outcome." },
    { id: "others", goal: "Other individual people with a related experience or need." },
    { id: "group", goal: "A community, organization, audience, customer group or category of people." },
    { id: "system", goal: "An industry, institution, market, social system or shared rule." },
  ]),
});


/**
 * Generic ways to shift vantage without hard-coding a product's question copy.
 * These are prompt hints, not a script and not a maturity ladder.
 */
export type PerspectiveMoveId =
  | "stance"
  | "time_horizon"
  | "scope"
  | "responsibility"
  | "assumption";

export type PerspectiveMoveTemplate = {
  id: PerspectiveMoveId | (string & {});
  /** What changes in the person's vantage. */
  goal: string;
  /** How an interviewer may express this move as one grounded question. */
  questionHint: string;
  /** Boundary that prevents the move from becoming leading or moralizing. */
  guard: string;
};

export const DEFAULT_PERSPECTIVE_MOVES: readonly PerspectiveMoveTemplate[] = Object.freeze([
  Object.freeze({
    id: "stance",
    goal: "Temporarily view the same issue from a nearby stakeholder or decision-maker position.",
    questionHint: "Ask what looks different from that seat or what they would notice there.",
    guard: "Do not imply that higher status is wiser, better, or what the person should want.",
  }),
  Object.freeze({
    id: "time_horizon",
    goal: "Move one time horizon outward or look back from a later point.",
    questionHint: "Ask what becomes important, small, persistent, or worth doing from that horizon.",
    guard: "Do not force a five- or ten-year ambition when the person is speaking about the present.",
  }),
  Object.freeze({
    id: "scope",
    goal: "Widen who or what is included in the desired change by one adjacent scope.",
    questionHint: "Ask whether the same desire extends to one nearby person or group, not straight to society.",
    guard: "Only widen from grounded user language; never treat social impact as the correct answer.",
  }),
  Object.freeze({
    id: "responsibility",
    goal: "Shift from observing a situation to owning a decision and its tradeoffs.",
    questionHint: "Ask what they would choose if the decision and consequences were theirs to own.",
    guard: "Do not shame, assign blame, or imply that taking more responsibility is morally superior.",
  }),
  Object.freeze({
    id: "assumption",
    goal: "Look at one explicit rule, permission, constraint, or default as something that could be redesigned.",
    questionHint: "Ask what they would design differently if that single premise did not bind the situation.",
    guard: "Do not deny real constraints or claim they can simply be ignored in reality.",
  }),
]);

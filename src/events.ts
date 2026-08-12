// Instrumentation for the loop.
//
// The questions ARE the product, and a product you cannot measure you cannot
// improve: which probe people answer in one word, which question loses them,
// how many refine rounds it takes before someone accepts their own words, which
// share moment actually gets shared. None of that is visible from model logs —
// it lives at the seams of the loop, which is where this engine sits.
//
// So the engine emits events and aggregates them. Storing them is the product's
// job: the shapes below carry no answer text, no statement, no quote — only
// what is needed to compare one version of a question set against the next.

export type DigStage = "dig" | "verbalize" | "brand" | "share";

export type DigEvent =
  | { type: "question.asked"; probeId: string | null; index: number; rationale?: string }
  | { type: "answer.received"; probeId: string | null; index: number; length: number; skipped: boolean }
  | { type: "interview.ended"; questionsAsked: number; probesFilled: number; probesPending: number }
  | { type: "candidates.generated"; round: number; count: number }
  | { type: "candidates.rejected"; round: number; feedbackLength: number }
  | { type: "result.confirmed"; rounds: number }
  | { type: "scores.generated"; scored: number; unscored: string[] }
  | { type: "share.offered"; kind: string }
  | { type: "share.accepted"; kind: string }
  | { type: "generation.failed"; stage: DigStage; reason: string };

export type DigEventHandler = (event: DigEvent & { at: number }) => void;

export type EventRecorder = {
  emit(event: DigEvent): void;
  /** Everything recorded so far, oldest first. */
  events(): (DigEvent & { at: number })[];
  clear(): void;
};

/**
 * Collect events in memory and optionally forward them. `now` is injectable so
 * a product can use its own clock (and tests can be deterministic).
 */
export function createEventRecorder(
  options: { onEvent?: DigEventHandler; now?: () => number } = {},
): EventRecorder {
  const now = options.now ?? (() => Date.now());
  let recorded: (DigEvent & { at: number })[] = [];

  return {
    emit(event) {
      const stamped = { ...event, at: now() };
      recorded.push(stamped);
      options.onEvent?.(stamped);
    },
    events: () => [...recorded],
    clear: () => {
      recorded = [];
    },
  };
}

export type ProbeStat = {
  probeId: string;
  asked: number;
  answered: number;
  skipped: number;
  /** Mean answer length in characters, over answered questions only. */
  meanAnswerLength: number;
};

export type FunnelSummary = {
  interviews: number;
  /** Interviews that reached a confirmed result. */
  confirmed: number;
  /** Mean refine rounds before confirming — how long people argue with the words. */
  meanRefineRounds: number;
  /** Share offers, and how many were taken, by moment kind. */
  shares: Record<string, { offered: number; accepted: number }>;
  /** Axes the model routinely fails to score — usually a prompt problem, not a user one. */
  unscoredAxes: Record<string, number>;
  failures: Record<string, number>;
  probes: ProbeStat[];
};

/**
 * Roll events up into the numbers a question set is judged by.
 *
 * Deliberately plain arithmetic over an event array: a product can hand this
 * one session's events or a month of them, from memory or from its own store.
 */
export function summarizeFunnel(events: readonly (DigEvent & { at?: number })[]): FunnelSummary {
  const probes = new Map<string, ProbeStat & { totalLength: number }>();
  const shares: FunnelSummary["shares"] = {};
  const unscoredAxes: Record<string, number> = {};
  const failures: Record<string, number> = {};

  let interviews = 0;
  let confirmed = 0;
  let refineRoundsTotal = 0;

  const probeStat = (id: string) => {
    let stat = probes.get(id);
    if (!stat) {
      stat = { probeId: id, asked: 0, answered: 0, skipped: 0, meanAnswerLength: 0, totalLength: 0 };
      probes.set(id, stat);
    }
    return stat;
  };

  for (const event of events) {
    switch (event.type) {
      case "question.asked":
        if (event.probeId) probeStat(event.probeId).asked++;
        break;
      case "answer.received": {
        if (!event.probeId) break;
        const stat = probeStat(event.probeId);
        if (event.skipped) stat.skipped++;
        else {
          stat.answered++;
          stat.totalLength += event.length;
        }
        break;
      }
      case "interview.ended":
        interviews++;
        break;
      case "result.confirmed":
        confirmed++;
        refineRoundsTotal += event.rounds;
        break;
      case "scores.generated":
        for (const axis of event.unscored) unscoredAxes[axis] = (unscoredAxes[axis] ?? 0) + 1;
        break;
      case "share.offered":
        shares[event.kind] ??= { offered: 0, accepted: 0 };
        (shares[event.kind] as { offered: number }).offered++;
        break;
      case "share.accepted":
        shares[event.kind] ??= { offered: 0, accepted: 0 };
        (shares[event.kind] as { accepted: number }).accepted++;
        break;
      case "generation.failed":
        failures[event.reason] = (failures[event.reason] ?? 0) + 1;
        break;
      default:
        break;
    }
  }

  return {
    interviews,
    confirmed,
    meanRefineRounds: confirmed > 0 ? refineRoundsTotal / confirmed : 0,
    shares,
    unscoredAxes,
    failures,
    probes: [...probes.values()].map(({ totalLength, ...stat }) => ({
      ...stat,
      meanAnswerLength: stat.answered > 0 ? totalLength / stat.answered : 0,
    })),
  };
}

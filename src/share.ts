// When to offer a share.
//
// Prompting after every result trains people to dismiss the prompt, and the
// dismissal generalizes — the loop dies not because the card was bad but
// because it was offered at a moment with nothing behind it. So the offer needs
// a reason, and the reason gets named: the first time something was put into
// words, a measurable jump, a milestone reached.
//
// What the card looks like belongs to the product. Whether there is a moment
// worth a card does not.

import type { AxisImprovement } from "./scoring.ts";

export type ShareMomentKind = "first-result" | "improved" | "milestone";

export type ShareMoment =
  | { kind: "first-result"; reason: string }
  | { kind: "improved"; reason: string; improvement: AxisImprovement }
  | { kind: "milestone"; reason: string; milestone: string };

export type PickShareMomentArgs = {
  /** True the first time a person has a result at all — the strongest moment. */
  isFirstResult?: boolean;
  /** From pickImprovedAxis. Null when nothing improved. */
  improvement?: AxisImprovement | null;
  /** A product milestone worth marking ("10th session", "profile published"). */
  milestone?: string | null;
  /**
   * Moments already offered, so the same one is not pushed twice. Pass the
   * kinds this person has already been shown for this result.
   */
  alreadyOffered?: readonly ShareMomentKind[];
};

/**
 * The one moment worth offering a share for, or null.
 *
 * Ordered by how much the person has to say about it: having words for the
 * first time beats a jump, which beats a count. Only one is returned — two
 * offers at once read as a campaign, not as a moment.
 */
export function pickShareMoment(args: PickShareMomentArgs): ShareMoment | null {
  const offered = new Set(args.alreadyOffered ?? []);

  if (args.isFirstResult && !offered.has("first-result")) {
    return { kind: "first-result", reason: "This is the first time it exists in words." };
  }

  if (args.improvement && !offered.has("improved")) {
    const { label, from, to } = args.improvement;
    return {
      kind: "improved",
      reason: `${label}: ${from} → ${to}`,
      improvement: args.improvement,
    };
  }

  if (args.milestone && !offered.has("milestone")) {
    return { kind: "milestone", reason: args.milestone, milestone: args.milestone };
  }

  return null;
}

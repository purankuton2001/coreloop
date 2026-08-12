// What a person is entitled to, and when it is fair to say so.
//
// The gate itself is trivial arithmetic. The part worth encoding is the timing,
// because this loop has one property that makes paywalls unusually easy to get
// wrong: the thing being sold is a person's own words about themselves. Ask for
// money before they have anything, and you charged for a promise. Interrupt the
// interview, and they leave with nothing — no result, no share, no loop.
//
// So: the first whole result is never gated, the gate never lands mid-interview,
// and it never competes with a share prompt. What IS gated is expansion —
// deeper layers, more runs, the artifact — asked for at a moment when the person
// has already seen that the free part was real.

export type Entitlement = string;

export type Plan = {
  id: string;
  /** What this plan unlocks. */
  entitlements: Entitlement[];
  /** Countable allowances, e.g. { runs: 3 }. Absent means unlimited. */
  quotas?: Record<string, number>;
};

export type Grant = {
  planId: string;
  /** Consumption so far, by quota key. */
  used?: Record<string, number>;
  /** Epoch ms. Absent means no expiry. */
  expiresAt?: number;
};

export type AccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "plan" | "quota" | "expired";
      entitlement: Entitlement;
      /** Plans that would grant it — what an upgrade prompt should offer. */
      requiredPlans: string[];
    };

export type EntitlementPolicy = {
  plans: readonly Plan[];
  planOf(grant: Grant | null | undefined): Plan | undefined;
  can(grant: Grant | null | undefined, entitlement: Entitlement, now?: number): AccessDecision;
  /** Remaining allowance, or Infinity when the plan does not cap it. */
  remaining(grant: Grant | null | undefined, quotaKey: string): number;
  /** Plans granting an entitlement, in registration order. */
  plansGranting(entitlement: Entitlement): string[];
};

/**
 * @param plans in ascending order of generosity — the order upgrade prompts
 *              will offer them in.
 * @param freePlanId the plan applied when someone has no grant at all.
 */
export function createEntitlementPolicy(
  plans: readonly Plan[],
  options: { freePlanId?: string } = {},
): EntitlementPolicy {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const free = options.freePlanId != null ? byId.get(options.freePlanId) : undefined;
  if (options.freePlanId != null && !free) {
    throw new Error(`coreloop: freePlanId "${options.freePlanId}" is not a registered plan`);
  }

  const planOf = (grant: Grant | null | undefined) =>
    (grant?.planId != null ? byId.get(grant.planId) : undefined) ?? free;

  const plansGranting = (entitlement: Entitlement) =>
    plans.filter((p) => p.entitlements.includes(entitlement)).map((p) => p.id);

  return {
    plans,
    planOf,
    plansGranting,

    can(grant, entitlement, now = Date.now()) {
      const plan = planOf(grant);
      const requiredPlans = plansGranting(entitlement);

      if (grant?.expiresAt != null && grant.expiresAt <= now) {
        return { allowed: false, reason: "expired", entitlement, requiredPlans };
      }
      if (!plan?.entitlements.includes(entitlement)) {
        return { allowed: false, reason: "plan", entitlement, requiredPlans };
      }
      const quota = plan.quotas?.[entitlement];
      if (quota != null && (grant?.used?.[entitlement] ?? 0) >= quota) {
        return { allowed: false, reason: "quota", entitlement, requiredPlans };
      }
      return { allowed: true };
    },

    remaining(grant, quotaKey) {
      const plan = planOf(grant);
      const quota = plan?.quotas?.[quotaKey];
      if (quota == null) return Infinity;
      return Math.max(0, quota - (grant?.used?.[quotaKey] ?? 0));
    },
  };
}

// ---------- when to show it ----------

export type PaywallStage =
  /** Mid-interview. Never a moment to ask. */
  | "dig"
  /** Choosing or refining the words. Still not finished. */
  | "verbalize"
  /** A whole result exists and has been seen. */
  | "result"
  /** Looking at the public/shareable side. */
  | "brand";

export type PaywallPrompt = {
  entitlement: Entitlement;
  reason: "plan" | "quota" | "expired";
  /** Plans to offer, most modest first. */
  offerPlans: string[];
};

export type PickPaywallPromptArgs = {
  decision: AccessDecision;
  stage: PaywallStage;
  /**
   * Whether this person has already received one complete result for free.
   * Before that, the answer is always "not now" — charging for a promise is how
   * a loop dies before it starts.
   */
  hasReceivedResult: boolean;
  /** A share is being offered right now. Two asks at once is one too many. */
  shareOfferPending?: boolean;
  /** Entitlements this person has already been prompted about in this session. */
  alreadyPrompted?: readonly Entitlement[];
};

/**
 * Decide whether to raise the paywall now. Null means "let them through the
 * moment" — the caller still enforces access, it just does not interrupt.
 *
 * Enforcement and prompting are separate on purpose: a blocked action can fail
 * quietly and be offered again later, and that is usually the better trade.
 */
export function pickPaywallPrompt(args: PickPaywallPromptArgs): PaywallPrompt | null {
  if (args.decision.allowed) return null;
  if (!args.hasReceivedResult) return null;
  if (args.stage === "dig" || args.stage === "verbalize") return null;
  if (args.shareOfferPending) return null;
  if (args.alreadyPrompted?.includes(args.decision.entitlement)) return null;
  if (args.decision.requiredPlans.length === 0) return null;

  return {
    entitlement: args.decision.entitlement,
    reason: args.decision.reason,
    offerPlans: args.decision.requiredPlans,
  };
}

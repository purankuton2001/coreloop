import assert from "node:assert/strict";
import { test } from "node:test";

import { createEntitlementPolicy, pickPaywallPrompt, type Grant } from "../src/index.ts";

const policy = createEntitlementPolicy(
  [
    { id: "free", entitlements: ["dig", "result"], quotas: { dig: 3 } },
    { id: "plus", entitlements: ["dig", "result", "layers"] },
    { id: "pro", entitlements: ["dig", "result", "layers", "export"] },
  ],
  { freePlanId: "free" },
);

test("no grant at all falls back to the free plan", () => {
  assert.deepEqual(policy.can(null, "result"), { allowed: true });
  assert.equal(policy.planOf(undefined)?.id, "free");
});

test("a missing entitlement names the plans that would grant it", () => {
  const decision = policy.can({ planId: "free" }, "layers");
  assert.deepEqual(decision, {
    allowed: false,
    reason: "plan",
    entitlement: "layers",
    requiredPlans: ["plus", "pro"],
  });
});

test("a spent quota is a different refusal from a missing plan", () => {
  const grant: Grant = { planId: "free", used: { dig: 3 } };
  const decision = policy.can(grant, "dig");
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.reason, "quota");
  assert.equal(policy.remaining(grant, "dig"), 0);
  assert.equal(policy.remaining({ planId: "free", used: { dig: 1 } }, "dig"), 2);
  assert.equal(policy.remaining({ planId: "plus" }, "dig"), Infinity, "no cap means unlimited");
});

test("an expired grant is refused before its plan is even read", () => {
  const decision = policy.can({ planId: "pro", expiresAt: 1000 }, "export", 2000);
  assert.equal(decision.allowed === false && decision.reason, "expired");
});

test("unknown plans and unknown free plans fail loudly", () => {
  assert.equal(policy.planOf({ planId: "ghost" })?.id, "free");
  assert.throws(() => createEntitlementPolicy([], { freePlanId: "free" }), /not a registered plan/);
});

// ---------- timing ----------

const refused = policy.can({ planId: "free" }, "layers");

test("nothing is asked for before a whole result has been given", () => {
  assert.equal(
    pickPaywallPrompt({ decision: refused, stage: "result", hasReceivedResult: false }),
    null,
  );
});

test("the interview is never interrupted by a paywall", () => {
  for (const stage of ["dig", "verbalize"] as const) {
    assert.equal(
      pickPaywallPrompt({ decision: refused, stage, hasReceivedResult: true }),
      null,
      `${stage} must not raise a wall mid-flow`,
    );
  }
});

test("a share offer and a paywall never land together", () => {
  assert.equal(
    pickPaywallPrompt({
      decision: refused,
      stage: "result",
      hasReceivedResult: true,
      shareOfferPending: true,
    }),
    null,
  );
});

test("the same entitlement is not pitched twice in a session", () => {
  assert.equal(
    pickPaywallPrompt({
      decision: refused,
      stage: "brand",
      hasReceivedResult: true,
      alreadyPrompted: ["layers"],
    }),
    null,
  );
});

test("at the right moment it offers the modest plan first", () => {
  const prompt = pickPaywallPrompt({
    decision: refused,
    stage: "result",
    hasReceivedResult: true,
  });
  assert.deepEqual(prompt, { entitlement: "layers", reason: "plan", offerPlans: ["plus", "pro"] });
});

test("an allowed action never prompts", () => {
  assert.equal(
    pickPaywallPrompt({
      decision: { allowed: true },
      stage: "result",
      hasReceivedResult: true,
    }),
    null,
  );
});

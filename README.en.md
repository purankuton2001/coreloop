# coreloop

[日本語](README.md)

Turn what a person said into words they would publish — and into the thing that
brings the next person in.

```
Dig        interview them: one question at a time, aimed at what they just said
Verbalize  propose candidates, let them reject, dig again, until they accept
Brand      layers, a public handle, per-field visibility
Share      offer a card only at a moment that earned one
Loop       someone sees it, and starts their own dig
```

coreloop implements that loop and **brings no prompts of its own**. Questions,
interviewing method, evaluation axes and result design stay yours — the engine
only ever receives them. MIT licensed.

## Install

```bash
npm install coreloop
```

Peer dependencies: `ai` (>=5) and `zod` (^3.23 || ^4). No provider is chosen for
you: the `model` is always passed in. Works in Node and in the browser.

## Why not just the AI SDK

The AI SDK (and instructor-js, zod-gpt, reforge-ai) gets you a valid object
back. Eval frameworks (autoevals, promptfoo, Braintrust) score **model** output.
Neither covers what happens when the thing being scored is a **person**, the
result is shown to them, and they are meant to want to share it. That is what
this is:

- **An unscored axis stays unscored.** A model that skips one leaves it out
  rather than getting a neutral 3 — a stored 3 nobody measured is
  indistinguishable from a real one and quietly corrupts every average built on it.
- **A quote is resolved against the transcript** before it is rendered as
  evidence. An unverified pointer underlines the wrong sentence.
- **Failures are typed and thrown**, never smoothed into a placeholder result:
  `not-configured` / `empty-input` / `invalid-contract` / `api-error`, and only
  the last one is worth a retry button.
- **Server-only prompts cannot reach a client view.** `toClientFlow` /
  `toClientMode` strip the method; for a product sold as a pack, the method is
  the product.

## Quickstart

```ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { CoreloopError, formatTranscript, generateStructured } from "coreloop";

const google = createGoogleGenerativeAI({ apiKey });

const transcript = formatTranscript(turns, {
  labels: { assistant: "interviewer", user: "candidate" },
}); // drops non-final chunks, system turns and blank text

try {
  const result = await generateStructured({
    model: google("gemini-2.5-flash"),
    schema: z.object({ summary: z.string(), nextAction: z.string() }),
    system: YOUR_INSTRUCTIONS, // yours, not ours
    prompt: transcript,
    stage: "verbalize",
  });
} catch (err) {
  if (err instanceof CoreloopError && err.retryable) showRetry();
}
```

Bind the model once instead of threading it through every route:

```ts
import { createEngine } from "coreloop";

export const engine = createEngine({
  model: google("gemini-2.5-flash"),
  onEvent: recorder.record, // every bound call reports here
});

await engine.generateStructured({ schema, prompt: transcript }); // no model argument
await engine.askNextQuestion({ instructions, probes, transcript: turns, language: "English" });

// One stage on a different model; the original engine is untouched.
await engine.with({ model: google("gemini-2.5-pro") }).generateStructured({ schema, prompt });
```

What is bound is the model handle the app already built — never a key, never a
provider choice, so design rule 2 holds. An explicit argument always wins, and an
engine with no usable model still throws `not-configured` **when it is called**,
not when it is created.

### Ask the next question, not the next item on a list

```ts
import { askNextQuestion } from "coreloop";

const step = await askNextQuestion({
  model,
  instructions: YOUR_INTERVIEW_STYLE,
  probes: [
    { id: "origin", goal: "the moment they first refused to quit" },
    { id: "retort", goal: "what they never said back" },
    { id: "today", goal: "how it shows up now", required: false },
  ],
  transcript: turns,
  language: "English",
  maxQuestions: 6,
});

step.question; // aimed at what they actually said, or null when the material is enough
step.filled;   // probes covered so far, including ones answered incidentally
```

The budget stop is enforced in code, not left to the model: a model judging its
own budget always finds one more thing worth asking, and the person pays for it
in time.

### Candidates, rejection, and digging again

```ts
import { buildCandidatesPrompt, candidatesSchema, generateStructured } from "coreloop";

const { candidates } = await generateStructured({
  model,
  schema: candidatesSchema(3, { textDescription: "The core statement, first person" }),
  prompt: buildCandidatesPrompt({
    instructions: flow.extractionPrompt, // yours, with {{answers}} / {{language}}
    transcript,
    language: "English",
    count: 3,
    refine: feedback ? { feedback, previousCandidates } : undefined,
  }),
});
```

Only words someone chose over other words feel like theirs — and only those get
shared.

### Score against axes, and keep the gaps visible

```ts
import { axisScoresSchema, formatAxisList, normalizeAxisScores, streamStructured } from "coreloop";

const schema = axisScoresSchema(axes).extend({ comment: z.string().min(1).max(800) });

const raw = await streamStructured({
  model,
  schema,
  system: `Axes:\n${formatAxisList(axes)}\n${YOUR_RULES}`,
  prompt: transcript,
  onPartial: (p) => setLiveScores(normalizeAxisScores(axes, p.scores)),
});

const scores = normalizeAxisScores(axes, raw.scores); // missing axes stay missing
```

### Offer a share only when there is a reason

```ts
import { pickImprovedAxis, pickShareMoment } from "coreloop";

const moment = pickShareMoment({
  isFirstResult,
  improvement: pickImprovedAxis(scores, previousScores),
  milestone,
  alreadyOffered,
});
// null → say nothing. Prompting every time teaches people to dismiss the prompt.
```

### Charge without breaking the loop

```ts
import { createEntitlementPolicy, pickPaywallPrompt } from "coreloop";

const plans = createEntitlementPolicy(
  [
    { id: "free", entitlements: ["dig", "result"], quotas: { dig: 3 } },
    { id: "plus", entitlements: ["dig", "result", "layers"] },
  ],
  { freePlanId: "free" },
);

const prompt = pickPaywallPrompt({
  decision: plans.can(grant, "layers"),
  stage: "result",
  hasReceivedResult: true,
  shareOfferPending: moment != null,
});
```

Never before one whole free result (that would be charging for a promise), never
mid-interview (they leave with nothing to show), never against a share offer
(two asks is one too many, and the share is what feeds the loop).

### Run the same loop inside LINE

```ts
import { toChoicesStep, toQuestionStep } from "coreloop";
import { parseLineEvent, renderLineMessages } from "coreloop/line";

const messages = renderLineMessages(toQuestionStep(step)!, { skipLabel: "Skip" });
const reply = parseLineEvent(webhookEvent); // choice | skip | reject | share | answer
```

Quick replies cap at 13, labels at 20 characters, postback data at 300 bytes —
the adapter enforces all of it. Statements go in the message body with numbers
on the buttons, because a 20-character label cannot hold a sentence someone is
meant to recognize as their own. No `@line/bot-sdk` dependency.

### Measure the questions themselves

```ts
import { createEventRecorder, summarizeFunnel } from "coreloop";

const recorder = createEventRecorder({ onEvent: (e) => yourStore.append(e) });
const summary = summarizeFunnel(recorder.events());
// skip rate per probe, refine rounds before someone accepts their own words,
// share offer → accept, axes the model keeps failing to score
```

Events carry no answer text, no statement, no quotes — only what compares one
version of a question set against the next.

## API

| Module | Exports |
|---|---|
| text | `LocalizedText` `pickText` `toLocale` `fillTemplate` `joinSections` |
| transcript | `TranscriptTurn` `visibleTurns` `formatTranscript` `formatQA` |
| sanitize | `sanitizeText` `sanitizeDeep` |
| errors | `CoreloopError` `isCoreloopError` `isRetryableError` |
| generate | `generateStructured` `streamStructured` |
| engine | `createEngine` (binds model / temperature / onEvent / sanitize; `with()` derives) |
| registry | `createRegistry` |
| flows / modes | `Flow` `ClientFlow` `toClientFlow` `Mode` `ClientMode` `toClientMode` `createModeRegistry` |
| interview | `Probe` `askNextQuestion` `buildNextQuestionPrompt` `pendingProbes` |
| candidates | `candidatesSchema` `buildCandidatesPrompt` |
| scoring | `axisScoresSchema` `normalizeAxisScores` `clampScore` `scoreRatio` `pickImprovedAxis` `formatAxisList` |
| quotes | `locateQuote` `resolveTurnIndex` |
| handle / visibility | `createHandlePolicy` `defineVisibilityPolicy` |
| share / presentation | `pickShareMoment` `toQuestionStep` `toChoicesStep` `toRevealStep` `toShareStep` |
| entitlements | `createEntitlementPolicy` `pickPaywallPrompt` |
| events | `createEventRecorder` `summarizeFunnel` |
| `coreloop/react` | `useStagedReveal` `useTypewriter` `useCountUp` |
| `coreloop/line` | `renderLineMessages` `parseLineEvent` `encodePostback` `LINE_LIMITS` |

## Design rules

1. No product vocabulary ships here — no questions, no axes, no copy
2. No provider is chosen, no API key is read, no env var is touched
3. Runs in Node and in the browser (`node:*`, `next/*`, `import.meta.env` are unused)
4. No abstraction that two real usages did not ask for

## Development

```bash
npm install && npm test && npm run build
```

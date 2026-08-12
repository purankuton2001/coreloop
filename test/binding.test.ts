import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";

import { CoreloopError, createEngine, type CoreloopEvent, type Probe } from "../src/index.ts";

// A model that records the options it was called with and answers with whatever
// JSON it was handed. Enough to see WHICH model ran and with what temperature —
// which is the whole contract of the binder.
type Call = { temperature?: number };

function answeringModel(text: string) {
  const calls: Call[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options: { temperature?: number }) => {
      calls.push({ temperature: options.temperature });
      return {
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        content: [{ type: "text", text }],
        warnings: [],
      };
    },
  } as never);
  return { model: model as never, calls };
}

const fakeModel = (reply: unknown) => answeringModel(JSON.stringify(reply));

function streamingModel(chunks: readonly string[]) {
  const calls: Call[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (options: { temperature?: number }) => {
      calls.push({ temperature: options.temperature });
      return {
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          ...chunks.map((delta) => ({ type: "text-delta", id: "1", delta })),
          { type: "text-end", id: "1" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ]),
      };
    },
  } as never);
  return { model: model as never, calls };
}

const schema = z.object({ text: z.string() });

test("the engine supplies the model every call would otherwise repeat", async () => {
  const bound = fakeModel({ text: "from the bound model" });
  const engine = createEngine({ model: bound.model });

  const out = await engine.generateStructured({ schema, prompt: "p" });

  assert.equal(out.text, "from the bound model");
  assert.equal(bound.calls.length, 1);
});

test("a call that brings its own model uses it, not the bound one", async () => {
  const bound = fakeModel({ text: "bound" });
  const perCall = fakeModel({ text: "per call" });
  const engine = createEngine({ model: bound.model });

  const out = await engine.generateStructured({ model: perCall.model, schema, prompt: "p" });

  assert.equal(out.text, "per call");
  assert.equal(bound.calls.length, 0, "the bound model must not be called too");
});

test("a bound temperature reaches the model, and a per-call one replaces it", async () => {
  const bound = fakeModel({ text: "x" });
  const engine = createEngine({ model: bound.model, temperature: 0.2 });

  await engine.generateStructured({ schema, prompt: "p" });
  await engine.generateStructured({ schema, prompt: "p", temperature: 0 });

  assert.deepEqual(
    bound.calls.map((c) => c.temperature),
    [0.2, 0],
    "temperature 0 is a real setting, not an absent one",
  );
});

test("a bound sanitize:false survives to the result", async () => {
  const bound = fakeModel({ text: "kept ```" });
  const engine = createEngine({ model: bound.model, sanitize: false });

  assert.equal((await engine.generateStructured({ schema, prompt: "p" })).text, "kept ```");
  assert.equal(
    (await engine.generateStructured({ schema, prompt: "p", sanitize: true })).text,
    "kept",
  );
});

test("failures are reported to the engine's handler without wiring it per call", async () => {
  const seen: CoreloopEvent[] = [];
  const engine = createEngine({ model: {} as never, onEvent: (e) => seen.push(e) });

  await assert.rejects(engine.generateStructured({ schema, prompt: "   ", stage: "verbalize" }));

  assert.deepEqual(
    seen.map((e) => e.type === "generation.failed" && e.reason),
    ["empty-input"],
    "the bound model got through — an unbound one would fail as not-configured first",
  );
});

test("a per-call handler replaces the bound one rather than doubling the event", async () => {
  const bound: CoreloopEvent[] = [];
  const perCall: CoreloopEvent[] = [];
  const engine = createEngine({ model: {} as never, onEvent: (e) => bound.push(e) });

  await assert.rejects(
    engine.generateStructured({ schema, prompt: "", onEvent: (e) => perCall.push(e) }),
  );

  assert.equal(perCall.length, 1);
  assert.equal(bound.length, 0);
});

test("an engine built without a usable model still fails at call time, as not-configured", async () => {
  const seen: CoreloopEvent[] = [];
  const engine = createEngine({ model: undefined as never, onEvent: (e) => seen.push(e) });

  await assert.rejects(engine.generateStructured({ schema, prompt: "p" }));
  assert.deepEqual(
    seen.map((e) => e.type === "generation.failed" && e.reason),
    ["not-configured"],
  );
});

test("with() derives an engine and leaves the original alone", async () => {
  const first = fakeModel({ text: "first" });
  const second = fakeModel({ text: "second" });
  const engine = createEngine({ model: first.model, temperature: 0.2 });
  const swapped = engine.with({ model: second.model });

  assert.equal((await swapped.generateStructured({ schema, prompt: "p" })).text, "second");
  assert.equal((await engine.generateStructured({ schema, prompt: "p" })).text, "first");
  assert.deepEqual(second.calls, [{ temperature: 0.2 }], "unmentioned defaults carry over");
});

test("prose comes back as a sanitized string, no schema in sight", async () => {
  const bound = answeringModel("[Verse]\nthe line they never said\n```");
  const engine = createEngine({ model: bound.model, temperature: 0.9 });

  const lyrics = await engine.generateProse({ prompt: "write it" });

  assert.equal(lyrics, "[Verse]\nthe line they never said");
  assert.deepEqual(bound.calls, [{ temperature: 0.9 }]);
});

test("streamed prose yields raw chunks and resolves the sanitized whole", async () => {
  const bound = streamingModel(["warm ", "analog synth", "\n```"]);
  const engine = createEngine({ model: bound.model, temperature: 0.4 });

  const stream = engine.streamProse({ prompt: "style it" });
  const seen: string[] = [];
  for await (const chunk of stream.textStream) seen.push(chunk);

  assert.deepEqual(seen, ["warm ", "analog synth", "\n```"], "partials are not trimmed mid-flight");
  assert.equal(await stream.text, "warm analog synth");
  assert.deepEqual(bound.calls, [{ temperature: 0.4 }]);
});

test("a stream can be handed straight to an HTTP response", async () => {
  const engine = createEngine({ model: streamingModel(["a", "b"]).model });

  const response = engine.streamProse({ prompt: "p" }).toTextStreamResponse();

  assert.ok(response instanceof Response);
  assert.equal(await response.text(), "ab");
});

test("a streaming failure is typed, and reported once however many consumers see it", async () => {
  const seen: CoreloopEvent[] = [];
  const model = new MockLanguageModelV3({
    doStream: async () => {
      throw new Error("provider is down");
    },
  } as never);
  const engine = createEngine({ model: model as never, onEvent: (e) => seen.push(e) });

  const stream = engine.streamProse({ prompt: "p", stage: "verbalize" });
  await assert.rejects(
    (async () => {
      for await (const _ of stream.textStream) void _;
    })(),
    (err: unknown) => err instanceof CoreloopError && err.retryable,
  );
  await assert.rejects(stream.text);

  assert.equal(
    seen.filter((e) => e.type === "generation.failed").length,
    1,
    "two consumers of one failed call is still one failure",
  );
});

test("askNextQuestion gets the same defaults, including the event handler", async () => {
  const seen: CoreloopEvent[] = [];
  const probes: Probe[] = [{ id: "turning-point", goal: "when it changed" }];
  const engine = createEngine({ model: {} as never, onEvent: (e) => seen.push(e) });

  const step = await engine.askNextQuestion({
    instructions: "x",
    probes,
    transcript: [{ role: "assistant", text: "q" }],
    language: "Japanese",
    maxQuestions: 1,
  });

  assert.equal(step.done, true);
  assert.ok(seen.some((e) => e.type === "interview.ended"));
});

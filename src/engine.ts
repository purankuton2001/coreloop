// Binding the model once, instead of at every call site.
//
// This package never picks a provider, reads an env var, or holds an API key —
// the model belongs to the app, so every entry point takes it as an argument.
// That boundary is right and the repetition it causes is not: an app threads
// the same `model` (and the same event recorder) through every route it owns,
// and the day it wants a cheaper model for one stage it edits all of them.
//
// So bind the defaults once and keep passing them explicitly wherever a call
// wants something else. What is bound is a model HANDLE the app already built —
// not a key, not a provider choice — so the boundary is unchanged.

import type { CoreloopEventHandler } from "./events.ts";
import {
  generateStructured,
  streamStructured,
  type ModelLike,
  type StreamStructuredRequest,
  type StructuredRequest,
} from "./generate.ts";
import { askNextQuestion, type AskNextQuestionArgs, type InterviewStep } from "./interview.ts";

export type EngineDefaults = {
  model: ModelLike;
  temperature?: number;
  /** Receives every event the bound calls emit, unless a call brings its own. */
  onEvent?: CoreloopEventHandler;
  sanitize?: boolean;
};

/** A request with the engine's defaults filled in — pass any of them to override. */
export type Bound<A> = Omit<A, "model"> & { model?: ModelLike };

export type Engine = {
  /** What this engine fills in. Read it when calling something it does not wrap. */
  readonly defaults: Readonly<EngineDefaults>;
  generateStructured<T>(req: Bound<StructuredRequest<T>>): Promise<T>;
  streamStructured<T>(req: Bound<StreamStructuredRequest<T>>): Promise<T>;
  askNextQuestion(args: Bound<AskNextQuestionArgs>): Promise<InterviewStep>;
  /** A second engine with some defaults replaced — a cheaper model for one stage. */
  with(overrides: Partial<EngineDefaults>): Engine;
};

type Common = { model?: ModelLike; temperature?: number; onEvent?: CoreloopEventHandler };

/**
 * An explicit argument always wins; `undefined` means "not given", so a call
 * cannot un-set a default by passing undefined for it. Temperature is compared
 * against null rather than truthiness — 0 is a temperature people actually use.
 */
function withDefaults<A extends Common>(defaults: EngineDefaults, args: A): A {
  return {
    ...args,
    model: args.model ?? defaults.model,
    ...(args.temperature == null && defaults.temperature != null
      ? { temperature: defaults.temperature }
      : {}),
    ...(args.onEvent == null && defaults.onEvent != null ? { onEvent: defaults.onEvent } : {}),
  };
}

/**
 * Bind a model (and optionally a temperature, an event handler, and the
 * sanitize setting) to the calls that take one.
 *
 * ```ts
 * const engine = createEngine({ model: google("gemini-2.5-flash"), onEvent: recorder.record });
 * await engine.generateStructured({ schema, prompt });
 * await engine.with({ model: google("gemini-2.5-pro") }).generateStructured({ schema, prompt });
 * ```
 *
 * Failures stay exactly where they were: an engine built without a usable model
 * throws `not-configured` when it is CALLED, not when it is created, so an app
 * that constructs one before it knows the key fails at the same point it does today.
 */
export function createEngine(defaults: EngineDefaults): Engine {
  const frozen: Readonly<EngineDefaults> = Object.freeze({ ...defaults });

  const forGeneration = <A extends Common & { sanitize?: boolean }>(args: A): A => ({
    ...withDefaults(frozen, args),
    ...(args.sanitize == null && frozen.sanitize != null ? { sanitize: frozen.sanitize } : {}),
  });

  return {
    defaults: frozen,
    generateStructured<T>(req: Bound<StructuredRequest<T>>) {
      return generateStructured(forGeneration(req) as StructuredRequest<T>);
    },
    streamStructured<T>(req: Bound<StreamStructuredRequest<T>>) {
      return streamStructured(forGeneration(req) as StreamStructuredRequest<T>);
    },
    askNextQuestion(args: Bound<AskNextQuestionArgs>) {
      return askNextQuestion(withDefaults(frozen, args) as AskNextQuestionArgs);
    },
    with: (overrides) => createEngine({ ...frozen, ...overrides }),
  };
}

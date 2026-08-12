// The one place the engine talks to a model.
//
// Wraps the Vercel AI SDK so that every call in an app gets the same three
// things: artifacts stripped from the output, failures typed as CoreloopError, and
// an optional stream of partial objects for UIs that fill in as they go.
//
// The model itself is always supplied by the caller — this package never picks
// a provider, reads an env var, or holds an API key.

import { generateObject, streamObject } from "ai";
import type { z } from "zod";
import { CoreloopError } from "./errors.ts";
import type { CoreloopEventHandler, EventStage } from "./events.ts";
import { sanitizeDeep } from "./sanitize.ts";

/** The AI SDK's model handle. Kept loose so any SDK v5–v7 model works. */
export type ModelLike = Parameters<typeof generateObject>[0]["model"];

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export type StructuredRequest<T> = {
  model: ModelLike;
  schema: z.ZodType<T>;
  prompt: string;
  system?: string;
  temperature?: number;
  /** Strip model artifacts from every string in the result. Default: true. */
  sanitize?: boolean;
  /**
   * Where in the loop this call sits. Only used to label failures — a product
   * tuning its prompts needs to know WHICH stage is failing, not just that
   * something did.
   */
  stage?: EventStage;
  onEvent?: CoreloopEventHandler;
};

export type StreamStructuredRequest<T> = StructuredRequest<T> & {
  /** Called for each partial object while the response streams in. */
  onPartial?: (partial: DeepPartial<T>) => void;
};

function assertUsable(req: { model: unknown; prompt: string }): void {
  if (!req.model) {
    throw new CoreloopError("not-configured", "No model was supplied to the engine.");
  }
  if (!req.prompt?.trim()) {
    throw new CoreloopError("empty-input", "The prompt is empty — nothing to generate from.");
  }
}

function asApiError(err: unknown): CoreloopError {
  if (err instanceof CoreloopError) return err;
  return new CoreloopError("api-error", "The model call failed or returned an unusable result.", {
    cause: err,
  });
}

function reportFailure(req: { stage?: EventStage; onEvent?: CoreloopEventHandler }, err: CoreloopError): CoreloopError {
  req.onEvent?.({
    type: "generation.failed",
    stage: req.stage ?? "verbalize",
    reason: err.reason,
    at: Date.now(),
  });
  return err;
}

function finish<T>(object: T, sanitize: boolean | undefined): T {
  return sanitize === false ? object : sanitizeDeep(object);
}

/** Generate one structured object. Throws CoreloopError on any failure. */
export async function generateStructured<T>(req: StructuredRequest<T>): Promise<T> {
  try {
    assertUsable(req);
  } catch (err) {
    throw reportFailure(req, asApiError(err));
  }
  try {
    // The AI SDK's own schema generics vary across major versions; the runtime
    // contract (zod schema in, validated object out) does not.
    const { object } = await generateObject({
      model: req.model,
      schema: req.schema,
      ...(req.system ? { system: req.system } : {}),
      prompt: req.prompt,
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
    } as never);
    return finish(object as T, req.sanitize);
  } catch (err) {
    throw reportFailure(req, asApiError(err));
  }
}

/**
 * Stream a structured object, reporting partials as they arrive. Resolves with
 * the same validated, sanitized object generateStructured would return.
 *
 * Partials are deliberately NOT sanitized: they are transient UI state, and
 * trimming a half-arrived string makes it jump around while it streams.
 */
export async function streamStructured<T>(req: StreamStructuredRequest<T>): Promise<T> {
  try {
    assertUsable(req);
  } catch (err) {
    throw reportFailure(req, asApiError(err));
  }
  try {
    const { partialObjectStream, object: finalObject } = streamObject({
      model: req.model,
      schema: req.schema,
      ...(req.system ? { system: req.system } : {}),
      prompt: req.prompt,
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
    } as never);

    if (req.onPartial) {
      for await (const partial of partialObjectStream) {
        req.onPartial(partial as DeepPartial<T>);
      }
    }
    return finish((await finalObject) as T, req.sanitize);
  } catch (err) {
    throw reportFailure(req, asApiError(err));
  }
}

// The one place the engine talks to a model.
//
// Wraps the Vercel AI SDK so that every call in an app gets the same three
// things: artifacts stripped from the output, failures typed as CoreloopError, and
// an optional stream of partial objects for UIs that fill in as they go.
//
// The model itself is always supplied by the caller — this package never picks
// a provider, reads an env var, or holds an API key.

import { generateObject, generateText, streamObject, streamText } from "ai";
import type { z } from "zod";
import { CoreloopError } from "./errors.ts";
import type { CoreloopEventHandler, EventStage } from "./events.ts";
import { sanitizeDeep, sanitizeText } from "./sanitize.ts";

/** The AI SDK's model handle. Kept loose so any SDK v5–v7 model works. */
export type ModelLike = Parameters<typeof generateObject>[0]["model"];

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** What every call to the model carries, schema or no schema. */
export type ModelRequest = {
  model: ModelLike;
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

export type StructuredRequest<T> = ModelRequest & {
  schema: z.ZodType<T>;
};

/**
 * A call with no schema. Lyrics, a draft, a prompt for another tool — output
 * whose whole value is that it is prose, and which a schema would only wrap in
 * a single field.
 */
export type ProseRequest = ModelRequest;

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

function callOptions(req: ModelRequest): Record<string, unknown> {
  return {
    model: req.model,
    ...(req.system ? { system: req.system } : {}),
    prompt: req.prompt,
    ...(req.temperature != null ? { temperature: req.temperature } : {}),
  };
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
      ...callOptions(req),
      schema: req.schema,
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
      ...callOptions(req),
      schema: req.schema,
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

/**
 * Generate text with no schema around it.
 *
 * Named for what it produces rather than mirroring the SDK's `generateText`,
 * because an app that imports both would otherwise have two functions of the
 * same name doing subtly different things.
 */
export async function generateProse(req: ProseRequest): Promise<string> {
  try {
    assertUsable(req);
  } catch (err) {
    throw reportFailure(req, asApiError(err));
  }
  try {
    const { text } = await generateText(callOptions(req) as never);
    return req.sanitize === false ? text : sanitizeText(text);
  } catch (err) {
    throw reportFailure(req, asApiError(err));
  }
}

export type ProseStream = {
  /**
   * Chunks as they arrive, NOT sanitized — a half-arrived line trimmed on every
   * chunk jumps around while it streams.
   */
  textStream: AsyncIterable<string>;
  /** The whole text, sanitized, once the stream ends. */
  text: Promise<string>;
  /**
   * The stream as an HTTP response, for a route that pipes straight to the
   * browser. This path never reaches `text`, so nothing sanitizes it — sanitize
   * on the way back in, when the client posts the finished text for storage.
   * A failure mid-flight ends the response early, as it does in the SDK — the
   * reader cannot tell that from a finished one, so `onEvent` is where a route
   * on this path learns it happened. It fires whether or not anyone reads the
   * result; a route that must branch on it in code reads `text`.
   */
  toTextStreamResponse: () => Response;
};

/**
 * Stream text with no schema around it.
 *
 * Returns synchronously, like the SDK does, so a route can hand the stream to a
 * Response before the first token exists. Failures still arrive as
 * CoreloopError — on the iteration or on `text`, whichever the caller reads —
 * and are reported once, not once per consumer.
 */
export function streamProse(req: ProseRequest): ProseStream {
  try {
    assertUsable(req);
  } catch (err) {
    throw reportFailure(req, asApiError(err));
  }

  let reported = false;
  const fail = (err: unknown): CoreloopError => {
    const wrapped = asApiError(err);
    if (reported) return wrapped;
    reported = true;
    return reportFailure(req, wrapped);
  };

  // The SDK does not throw a mid-stream provider failure into textStream: the
  // stream simply ends. A lyric sheet that stops after two lines then looks
  // exactly like a finished one, so catch the error here and raise it at the
  // end of the iteration instead.
  let streamError: unknown = null;
  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      ...callOptions(req),
      onError: ({ error }: { error: unknown }) => {
        streamError = error;
        // Report it the moment it happens, not when someone asks. A route that
        // pipes the stream straight to the browser reads neither `text` nor
        // `textStream`, and this handler has replaced the SDK's own — which at
        // least logged. Without this line that failure leaves no trace at all:
        // the reader sees a lyric sheet that stops, and the server sees nothing.
        fail(error);
      },
    } as never);
  } catch (err) {
    throw fail(err);
  }

  const text = (async () => {
    try {
      const whole = await result.text;
      if (streamError) throw streamError;
      return req.sanitize === false ? whole : sanitizeText(whole);
    } catch (err) {
      // Prefer the provider's own error: the SDK's "No output generated" says
      // only that nothing arrived, not why.
      throw fail(streamError ?? err);
    }
  })();
  // A caller that only pipes the stream never awaits this one; without a
  // handler its rejection would surface as an unhandled rejection and take the
  // process down. The rejection is still there for a caller that does await.
  text.catch(() => {});

  return {
    textStream: (async function* () {
      try {
        for await (const chunk of result.textStream) yield chunk;
      } catch (err) {
        throw fail(err);
      }
      if (streamError) throw fail(streamError);
    })(),
    text,
    toTextStreamResponse: () => result.toTextStreamResponse(),
  };
}

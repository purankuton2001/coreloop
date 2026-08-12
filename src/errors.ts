// One failure type for every generation call.
//
// The reason a generation failed decides what the UI may do next. Returning a
// neutral placeholder instead (all scores 3, an empty profile) is worse than
// failing: it is indistinguishable from a real result once persisted. So the
// engine throws, and the caller decides what to show.

export type CoreloopFailureReason =
  /** No model / API key configured. */
  | "not-configured"
  /** Nothing to work from: empty transcript, no answers. */
  | "empty-input"
  /** The caller's own contract is incomplete (e.g. no axes to score). */
  | "invalid-contract"
  /** The provider call failed, or returned something unusable. */
  | "api-error";

export class CoreloopError extends Error {
  readonly reason: CoreloopFailureReason;

  constructor(reason: CoreloopFailureReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CoreloopError";
    this.reason = reason;
  }

  /**
   * Whether re-running the same call could succeed. Configuration gaps and
   * empty input will not change on their own — never offer a retry for those.
   */
  get retryable(): boolean {
    return this.reason === "api-error";
  }
}

export function isCoreloopError(err: unknown): err is CoreloopError {
  return err instanceof CoreloopError;
}

export function isRetryableError(err: unknown): boolean {
  return isCoreloopError(err) && err.retryable;
}

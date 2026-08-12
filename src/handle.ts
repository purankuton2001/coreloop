// Public identifiers (the handle in /u/:handle, /@name, …).
//
// A handle policy always ends up implemented at least twice — in the form that
// validates as you type, and on the server that owns uniqueness. When the two
// drift, a name accepted by the form is rejected on save. This module is the
// shared half: normalization, the rule set, and the ORDER the rules are
// checked in. Messages stay with the app, which owns its wording and i18n.

export type HandleViolation = "too-short" | "too-long" | "invalid-characters" | "reserved";

export type HandlePolicyOptions = {
  minLength?: number;
  maxLength?: number;
  /** Allowed shape of the whole handle. Default: lowercase alnum, then alnum/-/_ */
  pattern?: RegExp;
  /** Names that must never be handed out (route names, brand names, …). */
  reserved?: Iterable<string>;
};

export type HandlePolicy = {
  minLength: number;
  maxLength: number;
  pattern: RegExp;
  reserved: ReadonlySet<string>;
  /** Trim and lowercase. Inner characters are never rewritten — a handle with a
   *  space is a rejection, not something to silently repair into another name. */
  normalize(input: string): string;
  /** First violation, or null when the handle is acceptable. */
  validate(handle: string): HandleViolation | null;
  /** normalize + validate in one step. */
  check(input: string): { handle: string; violation: HandleViolation | null };
};

const DEFAULT_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export function createHandlePolicy(options: HandlePolicyOptions = {}): HandlePolicy {
  const minLength = options.minLength ?? 3;
  const maxLength = options.maxLength ?? 30;
  const pattern = options.pattern ?? DEFAULT_PATTERN;
  const reserved = new Set([...(options.reserved ?? [])].map((r) => r.toLowerCase()));

  const normalize = (input: string) => input.trim().toLowerCase();

  const validate = (handle: string): HandleViolation | null => {
    // Reserved names are checked FIRST: a reserved word can be shorter than the
    // minimum ("me"), and reporting it as "too short" invites the person to pad
    // it and hit a second, different rejection.
    if (reserved.has(handle)) return "reserved";
    if (handle.length < minLength) return "too-short";
    if (handle.length > maxLength) return "too-long";
    if (!pattern.test(handle)) return "invalid-characters";
    return null;
  };

  return {
    minLength,
    maxLength,
    pattern,
    reserved,
    normalize,
    validate,
    check(input) {
      const handle = normalize(input);
      return { handle, violation: validate(handle) };
    },
  };
}

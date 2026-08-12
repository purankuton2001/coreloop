// Model-output cleanup.
//
// Structured-output models occasionally leak internal delimiters or stray code
// fences into string fields (e.g. a trailing "```_of_thought_end_```"). These
// strings are shown to users and persisted, so strip the artifacts before the
// value leaves the generation layer.

const ARTIFACT_PATTERNS: RegExp[] = [
  /`{2,}\s*_*(?:of_)?thought(?:_end)?_*\s*`*\{?\s*$/i, // trailing thinking delimiter
  /`{3,}[a-z]*\s*$/i, // trailing bare code fence
  /^\s*`{3,}[a-z]*\s*/i, // leading code fence
];

export function sanitizeText(s: string): string {
  let out = s;
  for (const re of ARTIFACT_PATTERNS) out = out.replace(re, "");
  return out.trim();
}

/** Recursively sanitize every string in a structured-output object. */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === "string") return sanitizeText(value) as unknown as T;
  if (Array.isArray(value)) return value.map(sanitizeDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v);
    return out as T;
  }
  return value;
}

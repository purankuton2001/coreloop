// Text primitives shared by every prompt builder: localized strings and
// {{placeholder}} substitution.

export type LocalizedText = { ja: string; en: string };

export type Locale = keyof LocalizedText;

/** Narrow an arbitrary locale string ("ja-JP", "en-US", undefined) to ja | en. */
export function toLocale(locale: string | null | undefined, fallback: Locale = "ja"): Locale {
  if (!locale) return fallback;
  const head = locale.toLowerCase().split("-")[0];
  return head === "en" ? "en" : head === "ja" ? "ja" : fallback;
}

export function pickText(text: LocalizedText, locale: string | null | undefined): string {
  return text[toLocale(locale)];
}

/**
 * Replace every {{key}} in a template. Keys absent from `vars` are left as-is
 * rather than blanked: a half-filled prompt is easier to spot in a log than a
 * silently emptied instruction.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

/** Join prompt sections, dropping empty ones, with a blank line between each. */
export function joinSections(...sections: (string | null | undefined | false)[]): string {
  return sections
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .join("\n\n");
}

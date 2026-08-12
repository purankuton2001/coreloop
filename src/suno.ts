// Suno adapter.
//
// A loop that ends in a song ends with two strings a person pastes into
// suno.com: a style field, and a lyric sheet with section tags. The prompts
// that produce those strings are the product's — what a song should sound like
// when it comes out of someone's own words is exactly the opinion a library has
// no business holding.
//
// Suno's INPUT FORMAT is not the product's: a style field that takes
// comma-separated fragments and stops reading at a couple hundred characters,
// lyrics structured with [Verse]-style tags, and the URL shape a finished song
// comes back as. Today that format tends to live inside the prompt as an
// English sentence — "Max ~200 characters (Suno style field limit)" — which
// means nothing checks it: a model that overshoots produces a style field the
// site silently cuts, and the person never learns which half was dropped.
//
// Same split as the LINE adapter: the platform's limits belong in code, the
// platform's copy does not.
//
// Imported from "coreloop/suno".

import { CoreloopError } from "./errors.ts";

/**
 * Suno's own limits.
 *
 * The style field is the one that bites: it is a single line, and everything
 * past the cut is dropped without a warning. The number has moved with Suno's
 * model versions, so every function that uses it takes an override.
 */
export const SUNO_LIMITS = {
  style: 200,
} as const;

/**
 * The section tags Suno reads as structure. A tag it does not recognize is not
 * an error on their side — it is sung, or ignored, which is the failure worth
 * catching before a person pays for a generation to find out.
 *
 * Extend it with `allow` rather than editing this list: an app that has proven
 * a tag works knows something this list does not.
 */
export const SUNO_SECTION_TAGS = [
  "Intro",
  "Verse",
  "Pre-Chorus",
  "Chorus",
  "Post-Chorus",
  "Hook",
  "Refrain",
  "Bridge",
  "Break",
  "Interlude",
  "Instrumental",
  "Solo",
  "Drop",
  "Outro",
  "End",
] as const;

// ---------- style field ----------

export type StylePromptOptions = {
  /** Character budget for the whole field. Default: SUNO_LIMITS.style. */
  limit?: number;
};

/**
 * Normalize a model-written style prompt into what the field actually takes:
 * comma-separated fragments, de-duplicated, inside the character budget.
 *
 * Overflow drops whole fragments from the end rather than cutting the string at
 * the limit. A field cut mid-fragment ends in "warm analog synth pa" — a phrase
 * the model never wrote and the person never chose, sitting in the same slot as
 * their real direction. Losing "tape hiss" entirely is honest; inventing half a
 * word is not.
 *
 * Throws (retryable) when nothing usable is left — an empty style field is not a
 * result to store, it is a generation to run again — and likewise when the whole
 * input is one unbroken fragment over the budget, where every remaining option
 * is a cut word.
 */
export function formatStylePrompt(input: string, options: StylePromptOptions = {}): string {
  // A limit read from config arrives as NaN when the variable is unset, and NaN
  // fails every comparison below — the budget would silently disappear and the
  // whole style prompt would go out at whatever length the model chose.
  const limit =
    options.limit != null && Number.isFinite(options.limit) && options.limit > 0
      ? options.limit
      : SUNO_LIMITS.style;

  const seen = new Set<string>();
  const fragments: string[] = [];
  // Newlines are a list the model wrote vertically; the field only reads commas.
  for (const raw of input.split(/[,\n]/)) {
    const fragment = raw.trim().replace(/\s+/g, " ");
    if (!fragment) continue;
    const key = fragment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fragments.push(fragment);
  }

  if (fragments.length === 0) {
    throw new CoreloopError(
      "api-error",
      "The style prompt has no usable fragments — the model returned nothing to paste.",
    );
  }

  const kept: string[] = [];
  let length = 0;
  for (const fragment of fragments) {
    const added = kept.length === 0 ? fragment.length : length + 2 + fragment.length;
    if (added > limit) break;
    kept.push(fragment);
    length = added;
  }

  // One fragment longer than the whole budget is the only case with nothing to
  // drop. Cut it at a word boundary — and when there is no boundary to cut at,
  // there is no honest answer left: half a word is exactly what this function
  // promises never to return, so treat it as nothing usable.
  if (kept.length === 0) {
    const first = fragments[0] ?? "";
    const boundary = first.slice(0, limit).lastIndexOf(" ");
    if (boundary <= 0) {
      throw new CoreloopError(
        "api-error",
        `The style prompt is one unbroken fragment longer than the ${limit}-character budget — nothing fits without cutting a word in half.`,
      );
    }
    return first.slice(0, boundary).trim();
  }

  return kept.join(", ");
}

// ---------- lyrics ----------

export type LyricSection = {
  /** The text inside the brackets, as written: "Verse 2". Null for a lead-in. */
  tag: string | null;
  /** The section name without its number: "Verse". Null for a lead-in. */
  name: string | null;
  /** The number after the name, when there is one. */
  index: number | null;
  /** The lines under this tag, trimmed. */
  body: string;
};

export type LyricViolationKind =
  /** No tags at all — Suno reads the whole thing as one undifferentiated block. */
  | "no-sections"
  /** A tag outside the recognized set: sung aloud or dropped, never structure. */
  | "unknown-tag"
  /** A tag with nothing under it. */
  | "empty-section"
  /** Text before the first tag — usually the model's preamble, not lyrics. */
  | "untagged-lead";

export type LyricViolation = {
  kind: LyricViolationKind;
  /** The tag involved, when the violation is about one. */
  tag?: string;
};

export type LyricsOptions = {
  /** Section names to accept beyond SUNO_SECTION_TAGS. */
  allow?: Iterable<string>;
};

const TAG_LINE = /^[ \t]*\[([^\]\n]+)\][ \t]*(.*)$/;

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function splitTag(tag: string): { name: string; index: number | null } {
  const match = /^\s*(.+?)\s*(?:[#-]?\s*(\d+))?\s*$/.exec(tag);
  const name = match?.[1]?.trim() ?? tag.trim();
  const index = match?.[2] ? Number(match[2]) : null;
  return { name, index };
}

/**
 * Split a lyric sheet into its tagged sections.
 *
 * Anything before the first tag comes back as a section with a null tag rather
 * than being dropped: it is usually the model ignoring "output only the lyrics",
 * and a parser that swallows it hides the very thing worth seeing.
 */
export function parseLyricSections(lyrics: string): LyricSection[] {
  const sections: LyricSection[] = [];
  let current: { tag: string | null; name: string | null; index: number | null; lines: string[] } = {
    tag: null,
    name: null,
    index: null,
    lines: [],
  };

  const push = () => {
    const body = current.lines.join("\n").trim();
    if (current.tag === null && !body) return; // no lead-in is the normal case
    sections.push({ tag: current.tag, name: current.name, index: current.index, body });
  };

  for (const line of lyrics.split(/\r?\n/)) {
    const match = TAG_LINE.exec(line);
    if (!match?.[1]) {
      current.lines.push(line);
      continue;
    }
    push();
    const tag = match[1].trim();
    const { name, index } = splitTag(tag);
    current = { tag, name, index, lines: match[2]?.trim() ? [match[2].trim()] : [] };
  }
  push();

  return sections;
}

/**
 * Read a lyric sheet the way Suno will: which sections it found, and what will
 * not survive the paste.
 *
 * Violations are returned, not thrown. Lyrics with a stray tag are still a
 * person's lyrics — the caller decides whether to regenerate, fix, or ship.
 */
export function checkLyrics(
  lyrics: string,
  options: LyricsOptions = {},
): { sections: LyricSection[]; violations: LyricViolation[] } {
  const allowed = new Set(
    [...SUNO_SECTION_TAGS, ...(options.allow ?? [])].map((t) => normalizeName(t)),
  );
  const sections = parseLyricSections(lyrics);
  const violations: LyricViolation[] = [];

  const tagged = sections.filter((s) => s.tag !== null);
  if (tagged.length === 0) {
    violations.push({ kind: "no-sections" });
  }
  if (sections[0]?.tag === null) {
    violations.push({ kind: "untagged-lead" });
  }

  for (const section of tagged) {
    // An empty bracket is a tag Suno cannot read as structure either, so it is
    // unknown rather than exempt — skipping it here reported "[   ]" as clean.
    if (!section.name || !allowed.has(normalizeName(section.name))) {
      violations.push({ kind: "unknown-tag", tag: section.tag as string });
    }
    if (!section.body) {
      violations.push({ kind: "empty-section", tag: section.tag as string });
    }
  }

  return { sections, violations };
}

/**
 * The lyrics without their tags — for a share card, an OG description, anywhere
 * the structure is Suno's business and not the reader's.
 */
export function stripLyricTags(lyrics: string): string {
  return lyrics
    .split(/\r?\n/)
    .map((line) => {
      const match = TAG_LINE.exec(line);
      return match ? (match[2]?.trim() ?? "") : line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- the song that comes back ----------

// Case-insensitive: the scheme and host are, and a pasted "HTTPS://SUNO.COM/..."
// is the same page. The id itself stays case-sensitive, which is why the class
// spells both cases out rather than relying on the flag.
const SONG_URL = /^https:\/\/(?:www\.)?suno\.com\/song\/([A-Za-z0-9-]+)/i;
const SONG_ID = /^[A-Za-z0-9-]+$/;

/**
 * Read a suno.com song URL a person pasted back in.
 *
 * Returns null for anything else, including other suno.com pages: a link to a
 * playlist or a profile stored as "the song" plays someone else's music on the
 * person's own page.
 */
export function parseSunoUrl(url: string | null | undefined): { songId: string } | null {
  if (!url) return null;
  const songId = SONG_URL.exec(url.trim())?.[1];
  return songId ? { songId } : null;
}

export function isSunoUrl(url: string | null | undefined): boolean {
  return parseSunoUrl(url) !== null;
}

export function sunoSongUrl(songId: string): string {
  return `https://suno.com/song/${songId}`;
}

/**
 * The embeddable player for a song, from either an id or a pasted URL. Null
 * when the input is not a song — an iframe pointed at a bad id renders an error
 * inside the page.
 */
export function sunoEmbedUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  // An id has to LOOK like an id. Anything else pasted without a scheme —
  // "suno.com/song/x", or a path with .. in it — would otherwise be pasted
  // straight into the embed path and resolve to whatever page it points at,
  // which is the profile-embedding outcome parseSunoUrl exists to prevent.
  const songId = SONG_ID.test(trimmed) ? trimmed : parseSunoUrl(trimmed)?.songId;
  return songId ? `https://suno.com/embed/${songId}` : null;
}

// Putting a quote back where it came from.
//
// Both products ask a model to point at the material: "quote the lines this
// was dug from", "which turn does this feedback refer to". A model returns
// either the text or an index, and both can be wrong — a paraphrase that was
// promised to be verbatim, an index past the end of the list. Rendering an
// unverified pointer means underlining the wrong sentence, so every pointer is
// resolved against the real transcript before it is shown.

import { visibleTurns, type TranscriptTurn } from "./transcript.ts";

export type QuoteLocation = {
  /** Index into the VISIBLE turns — the same list the UI renders. */
  turnIndex: number;
  /** Character range within that turn's text. */
  start: number;
  end: number;
  /** false when the match needed whitespace-insensitive comparison. */
  exact: boolean;
};

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Find a quote in a transcript. Tries an exact substring match first, then a
 * whitespace-insensitive one (models reflow line breaks). Returns null when
 * the quote is not actually in the material — the caller should then render it
 * as plain text rather than as a link into the transcript.
 */
export function locateQuote(
  transcript: readonly TranscriptTurn[] | null | undefined,
  quote: string,
  options: { includeSystem?: boolean } = {},
): QuoteLocation | null {
  const needle = quote?.trim();
  if (!needle) return null;
  const turns = visibleTurns(transcript, options);

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const text = turns[turnIndex]?.text ?? "";
    const start = text.indexOf(needle);
    if (start >= 0) {
      return { turnIndex, start, end: start + needle.length, exact: true };
    }
  }

  const loose = collapseWhitespace(needle);
  if (!loose) return null;
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const text = turns[turnIndex]?.text ?? "";
    const start = collapseWhitespace(text).indexOf(loose);
    if (start >= 0) {
      return { turnIndex, start: 0, end: text.length, exact: false };
    }
  }

  return null;
}

/**
 * Validate a model-supplied turn index against the visible turns.
 * Out-of-range indexes become null instead of throwing: a missing pointer
 * degrades to "no link", a wrong one points at someone else's sentence.
 */
export function resolveTurnIndex(
  transcript: readonly TranscriptTurn[] | null | undefined,
  index: number | null | undefined,
  options: { includeSystem?: boolean } = {},
): number | null {
  if (index == null || !Number.isInteger(index) || index < 0) return null;
  return index < visibleTurns(transcript, options).length ? index : null;
}

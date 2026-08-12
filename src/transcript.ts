// Turning the raw material of an interview into prompt text.
//
// Two shapes exist in practice and both reduce to the same thing:
//   - a live conversation (voice or chat): a list of turns
//   - a questionnaire (one question per screen): questions + answers by id
//
// Both end up as a labelled, newline-joined transcript. Keeping the filter
// rules here (drop non-final chunks, drop system turns, drop blank text) means
// the transcript the model scores is the same one the UI renders.

import { pickText, type LocalizedText } from "./text.ts";

export type TranscriptRole = "assistant" | "user" | "system";

export type TranscriptTurn = {
  role: TranscriptRole;
  text: string;
  /** false while a speech-to-text chunk is still being revised. */
  isFinal?: boolean;
};

export type TranscriptLabels = Partial<Record<TranscriptRole, string>>;

const DEFAULT_LABELS: Required<Pick<TranscriptLabels, "assistant" | "user">> = {
  assistant: "assistant",
  user: "user",
};

export type FormatTranscriptOptions = {
  labels?: TranscriptLabels;
  /** Keep system turns (dropped by default — they are instructions, not material). */
  includeSystem?: boolean;
  /** Prefix each line with its index in the visible list, e.g. "[#3]". */
  numbered?: boolean;
};

/** The turns a transcript actually contributes, in display order. */
export function visibleTurns<T extends TranscriptTurn>(
  transcript: readonly T[] | null | undefined,
  options: { includeSystem?: boolean } = {},
): T[] {
  if (!Array.isArray(transcript)) return [];
  return transcript.filter(
    (t) =>
      t.isFinal !== false &&
      typeof t.text === "string" &&
      t.text.trim().length > 0 &&
      (options.includeSystem === true || t.role !== "system"),
  );
}

export function formatTranscript(
  transcript: readonly TranscriptTurn[] | null | undefined,
  options: FormatTranscriptOptions = {},
): string {
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  return visibleTurns(transcript, options)
    .map((t, i) => {
      const label = labels[t.role] ?? t.role;
      const index = options.numbered ? `[#${i}]` : "";
      return `${index}[${label}] ${t.text.trim()}`;
    })
    .join("\n");
}

export type TranscriptQuestion = {
  id: string;
  text: LocalizedText;
};

export type FormatQAOptions = {
  questionPrefix?: string;
  answerPrefix?: string;
  /** Rendered in place of an unanswered question. */
  skippedLabel?: string;
};

/** Format a questionnaire (one question per screen) as a Q/A transcript. */
export function formatQA(
  questions: readonly TranscriptQuestion[],
  answers: Record<string, string> | null | undefined,
  locale: string,
  options: FormatQAOptions = {},
): string {
  const q = options.questionPrefix ?? "Q";
  const a = options.answerPrefix ?? "A";
  const skipped = options.skippedLabel ?? "(skipped)";
  return questions
    .map((question) => {
      const answer = answers?.[question.id]?.trim();
      return `${q}: ${pickText(question.text, locale)}\n${a}: ${answer || skipped}`;
    })
    .join("\n\n");
}

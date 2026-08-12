// What the loop wants to show, without saying how.
//
// The same loop has to run in a web app and in a LINE official account, and
// those two share nothing visually — one has a screen it owns, the other gets a
// chat bubble and at most a row of quick replies. What they DO share is the
// sequence: ask, offer choices, reveal, offer a share.
//
// So the engine emits steps, and a channel adapter renders them. A product that
// wants full control over its own screens can ignore this module entirely and
// read the engine's outputs directly — nothing else depends on it.

import type { Candidate } from "./candidates.ts";
import type { InterviewStep } from "./interview.ts";
import type { ShareMoment } from "./share.ts";

export type StepOption = {
  id: string;
  label: string;
  /** Secondary line, shown where the channel has room for it. */
  sublabel?: string;
};

export type QuestionStep = {
  kind: "question";
  id: string;
  text: string;
  hint?: string;
  /** Whether the person may pass on this one. */
  skippable: boolean;
};

export type ChoicesStep = {
  kind: "choices";
  id: string;
  text: string;
  options: StepOption[];
  /** The "none of these" escape, which starts a refine round. */
  rejectOption?: StepOption;
};

export type RevealStep = {
  kind: "reveal";
  id: string;
  /** Layers in the order they should appear. */
  layers: { id: string; title?: string; body: string }[];
};

export type ShareStep = {
  kind: "share";
  id: string;
  /** Why this moment — shown to the person, so it must read as a reason. */
  text: string;
  url?: string;
  imageUrl?: string;
  acceptLabel: string;
  declineLabel: string;
};

export type PresentationStep = QuestionStep | ChoicesStep | RevealStep | ShareStep;

export type QuestionStepOptions = {
  id?: string;
  hint?: string;
  skippable?: boolean;
};

/** The next question as something a channel can render. Null when the interview is done. */
export function toQuestionStep(
  step: InterviewStep,
  options: QuestionStepOptions = {},
): QuestionStep | null {
  if (!step.question) return null;
  return {
    kind: "question",
    id: options.id ?? step.probeId ?? "q",
    text: step.question,
    ...(options.hint ? { hint: options.hint } : {}),
    // Skipping is the default: a question someone cannot pass on gets answered
    // with noise, and noise is worse material than an admitted blank.
    skippable: options.skippable ?? true,
  };
}

export type ChoicesStepOptions = {
  id?: string;
  text: string;
  /** Label for "none of these fit" — omit to remove the escape entirely. */
  rejectLabel?: string | null;
};

/** Candidates as a choice set, with the rejection path attached. */
export function toChoicesStep(
  candidates: readonly Candidate[],
  options: ChoicesStepOptions,
): ChoicesStep {
  const reject = options.rejectLabel === null ? undefined : options.rejectLabel ?? "None of these";
  return {
    kind: "choices",
    id: options.id ?? "candidates",
    text: options.text,
    options: candidates.map((candidate, index) => ({
      id: String(index),
      label: candidate.text,
      ...(candidate.angle ? { sublabel: candidate.angle } : {}),
    })),
    ...(reject ? { rejectOption: { id: "reject", label: reject } } : {}),
  };
}

export function toRevealStep(
  layers: readonly { id: string; title?: string; body: string }[],
  options: { id?: string } = {},
): RevealStep {
  return {
    kind: "reveal",
    id: options.id ?? "reveal",
    layers: layers.filter((l) => l.body?.trim()).map((l) => ({ ...l, body: l.body.trim() })),
  };
}

export type ShareStepOptions = {
  id?: string;
  /** The invitation itself. Receives the moment so the copy can name the reason. */
  text: string;
  url?: string;
  imageUrl?: string;
  acceptLabel?: string;
  declineLabel?: string;
};

export function toShareStep(moment: ShareMoment, options: ShareStepOptions): ShareStep {
  return {
    kind: "share",
    id: options.id ?? `share:${moment.kind}`,
    text: options.text,
    ...(options.url ? { url: options.url } : {}),
    ...(options.imageUrl ? { imageUrl: options.imageUrl } : {}),
    acceptLabel: options.acceptLabel ?? "Share",
    declineLabel: options.declineLabel ?? "Not now",
  };
}

// ---------- inbound ----------

export type StepReply =
  /** Free text — an answer to a question. */
  | { kind: "answer"; stepId: string | null; text: string }
  | { kind: "skip"; stepId: string }
  | { kind: "choice"; stepId: string; optionId: string }
  /** "None of these" — the text carries the reason, when the channel collected one. */
  | { kind: "reject"; stepId: string; feedback: string | null }
  | { kind: "share"; stepId: string; accepted: boolean };

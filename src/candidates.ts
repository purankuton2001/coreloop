// Candidates and the refine loop.
//
// The engine never hands back one answer. It proposes N wordings cut from
// different angles, the person rejects them with a reason, and the reason
// becomes the material for the next round. Only the scaffolding lives here —
// what to look for in the answers is the caller's instruction.

import { z } from "zod";
import { fillTemplate, joinSections } from "./text.ts";

export type Candidate = {
  /** The statement itself, in the person's own language. */
  text: string;
  /** Short label for the axis this candidate cuts from. */
  angle: string;
};

/** Schema for exactly `count` candidates. */
export function candidatesSchema(count = 3) {
  return z.object({
    candidates: z
      .array(
        z.object({
          text: z.string().describe("The statement, 1-2 sentences, first person"),
          angle: z.string().describe("Short label of the axis this candidate cuts from"),
        }),
      )
      .length(count),
  });
}

export type CandidatesResult = { candidates: Candidate[] };

export type RefineRound = {
  /** Why the person rejected the previous round. */
  feedback: string;
  previousCandidates: readonly Candidate[];
};

export type BuildCandidatesPromptArgs = {
  /**
   * The caller's extraction instruction. May contain {{answers}} and
   * {{language}}, plus any keys passed in `vars`.
   */
  instructions: string;
  /** The formatted interview material (see formatTranscript / formatQA). */
  transcript: string;
  /** Language the candidates must be written in, e.g. "Japanese". */
  language: string;
  vars?: Record<string, string>;
  refine?: RefineRound;
  /** Replaces the built-in refine section when a product wants its own wording. */
  buildRefineSection?: (refine: RefineRound) => string;
};

function defaultRefineSection(refine: RefineRound): string {
  const previous = refine.previousCandidates
    .map((c, i) => `${i + 1}. [${c.angle}] ${c.text}`)
    .join("\n");

  return `---
The person has already seen these candidates and rejected them:
${previous}

Their feedback:
${refine.feedback.trim()}

Generate NEW candidates that take this feedback seriously. Do not repeat the
rejected candidates or minor rewordings of them. The feedback tells you what
axis or texture was missing — dig there.`;
}

export function buildCandidatesPrompt(args: BuildCandidatesPromptArgs): string {
  const base = fillTemplate(args.instructions, {
    answers: args.transcript,
    language: args.language,
    ...args.vars,
  });

  if (!args.refine?.feedback?.trim() || args.refine.previousCandidates.length === 0) {
    return base;
  }

  const section = (args.buildRefineSection ?? defaultRefineSection)(args.refine);
  return joinSections(base, section);
}

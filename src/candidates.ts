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

export type CandidatesSchemaOptions = {
  /**
   * Field descriptions reach the model as part of the structured-output
   * contract, so they are prompt text, not documentation. Products name the
   * thing being extracted in their own vocabulary ("core statement", "axis",
   * "persona") — the default is deliberately generic.
   */
  textDescription?: string;
  angleDescription?: string;
};

/** Schema for exactly `count` candidates. */
export function candidatesSchema(count = 3, options: CandidatesSchemaOptions = {}) {
  return z.object({
    candidates: z
      .array(
        z.object({
          text: z
            .string()
            .describe(options.textDescription ?? "The statement, 1-2 sentences, first person"),
          angle: z
            .string()
            .describe(
              options.angleDescription ?? "Short label of the axis this candidate cuts from",
            ),
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
  /**
   * How many candidates the schema demands. Stated in the refine round so the
   * instruction and the schema cannot disagree — a prompt that asks for "new
   * candidates" against a schema pinned to 3 makes the model return 2 or 4 and
   * the whole call fails validation.
   */
  count?: number;
  /** Replaces the built-in refine section when a product wants its own wording. */
  buildRefineSection?: (refine: RefineRound) => string;
};

function defaultRefineSection(refine: RefineRound, count?: number): string {
  const previous = refine.previousCandidates
    .map((c, i) => `${i + 1}. [${c.angle}] ${c.text}`)
    .join("\n");
  const n = count != null ? ` ${count}` : "";

  return `---
The person has already seen these${n} candidates and rejected them:
${previous}

Their feedback:
${refine.feedback.trim()}

Generate${n} NEW candidates that take this feedback seriously. Do not repeat the
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

  const section = args.buildRefineSection
    ? args.buildRefineSection(args.refine)
    : defaultRefineSection(args.refine, args.count);
  return joinSections(base, section);
}

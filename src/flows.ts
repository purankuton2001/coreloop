// A flow is the material-gathering half of a mode: what gets asked, and the
// instruction for how to read the answers.
//
// The instruction is the part worth protecting. `extractionPrompt` is server
// only — how a product digs is its own asset, and it must never be serialized
// into a page. Pass toClientFlow(flow), never the flow itself, to the browser.

import type { LocalizedText } from "./text.ts";

export type FlowQuestion = {
  id: string;
  text: LocalizedText;
  followupHint?: LocalizedText;
};

export type Flow = {
  id: string;
  name: LocalizedText;
  tagline: LocalizedText;
  /** Optional priming screen shown before the first question. */
  prologue?: LocalizedText;
  questions: FlowQuestion[];
  /**
   * LLM instruction for reading this flow's answers. SERVER ONLY.
   * Placeholders are filled by buildCandidatesPrompt: {{answers}}, {{language}}.
   */
  extractionPrompt: string;
};

/** The client-safe view of a flow: everything except the extraction instruction. */
export type ClientFlow<F extends Flow = Flow> = Omit<F, "extractionPrompt">;

export function toClientFlow<F extends Flow>(flow: F): ClientFlow<F> {
  const { extractionPrompt: _serverOnly, ...rest } = flow;
  return rest;
}

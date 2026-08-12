// A mode is a full vertical of the engine: which flows it owns, what the
// confirmation step produces, and what that result is stored as.
//
// Flows differ in what they ASK. Modes differ in what they PRODUCE. The spine
// between them — gather material, propose candidates, refine, confirm — is the
// same for every mode and lives outside this type.

import type { z } from "zod";
import { createRegistry, type Registry } from "./registry.ts";
import { toClientFlow, type ClientFlow, type Flow } from "./flows.ts";
import type { Locale, LocalizedText } from "./text.ts";

/**
 * The columns every confirmed result carries regardless of mode: one statement
 * in each language, plus a short name for it. A mode maps its own richer
 * profile object down onto these.
 */
export type CoreColumns = {
  textJa: string;
  textEn: string;
  title: string | null;
  titleEn: string | null;
};

export type ProfilePromptArgs<F extends Flow = Flow> = {
  /** The confirmed statement the profile is generated around. */
  text: string;
  language: string;
  flow?: F;
  answers?: Record<string, string>;
};

export type Mode<TProfile = unknown, F extends Flow = Flow> = {
  id: string;

  /** Display vocabulary injected into the shared spine UI. */
  vocabulary: {
    coreNoun: LocalizedText;
    digVerb: LocalizedText;
  };
  locales: Locale[];

  /** A mode owns 1..N flows. Flow ids are unique across the whole registry. */
  flows: F[];

  // ---- Output contract. SERVER ONLY — never serialized to the browser. ----
  profileSchema: z.ZodType<TProfile>;
  buildProfilePrompt: (args: ProfilePromptArgs<F>) => string;
  /** What gets persisted as the profile blob. */
  toStoredProfile: (profile: TProfile, locale: string) => Record<string, unknown>;
  toCoreColumns: (profile: TProfile) => CoreColumns;

  // ---- Downstream ----
  /** Artifact kinds this mode can produce (a song, a draft, …). */
  artifactTypes: string[];
  /** Whether confirmed results get public pages. */
  release: { enabled: boolean };
};

/**
 * Client-safe view: vocabulary and flows only. The output contract — schema,
 * prompt builder, mapping functions — never crosses to the browser.
 */
export type ClientMode<F extends Flow = Flow> = {
  id: string;
  vocabulary: Mode["vocabulary"];
  locales: Locale[];
  flows: ClientFlow<F>[];
};

export function toClientMode<TProfile, F extends Flow>(
  mode: Mode<TProfile, F>,
): ClientMode<F> {
  return {
    id: mode.id,
    vocabulary: mode.vocabulary,
    locales: mode.locales,
    flows: mode.flows.map(toClientFlow),
  };
}

/**
 * Registry of modes, resolvable by mode id and by any flow id they own.
 * `defaultId` is what unlabelled legacy rows resolve to.
 */
export function createModeRegistry<M extends { id: string; flows: { id: string }[] }>(
  modes: readonly M[],
  options: { defaultId?: string } = {},
): Registry<M> {
  return createRegistry(modes, {
    ...options,
    childIds: (mode) => mode.flows.map((f) => f.id),
  });
}
